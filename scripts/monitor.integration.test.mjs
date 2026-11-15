import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("genera el mensaje y el JSON con ambos rangos sin llamar a Telegram", async () => {
  const RealDate = Date;
  const fixedNow = "2026-12-16T16:00:00.000Z";
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedNow]));
    }
    static now() { return RealDate.parse(fixedNow); }
  };
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "title-monitor-test-"));
  process.env.TITLE_MONITOR_TARGETS = "2026-TP1000";
  process.env.TITLE_MONITOR_STATE_DIRECTORY = stateDirectory;
  process.env.TITLE_MONITOR_DRY_RUN = "true";

  const eligibleDays = [];
  const { getExcludedReason } = await import("./forecast.mjs");
  for (let offset = 1; eligibleDays.length < 40; offset++) {
    const date = new RealDate(RealDate.UTC(2026, 11, 16 - offset));
    if (!getExcludedReason(date)) eligibleDays.push(date);
  }
  const officialDate = (date) => `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
  const row = (number) => {
    const published = number <= 800;
    const publicationDate = published ? officialDate(eligibleDays[Math.floor((number - 1) / 20)]) : "-";
    const cells = [
      `2026-TP${number}`, "15/10/2026", "TP-TITULO PROFESIONALES",
      "PERSONA DE PRUEBA", "-", "-", publicationDate, "-",
      published ? "Publicado" : "Redactado",
    ];
    return `<tr class="consulta-row">${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
  };
  const yearHtml = Array.from({ length: 1_000 }, (_, index) => row(index + 1)).join("");
  const actualFetch = globalThis.fetch;
  let telegramCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.hostname === "api.telegram.org") {
      telegramCalls++;
      throw new Error("Telegram debe estar desactivado en la prueba");
    }
    return new Response(url.searchParams.get("search") === "2026-TP" ? yearHtml : row(1_000));
  };
  const actualLog = console.log;
  const messages = [];
  console.log = (...args) => messages.push(args.join(" "));
  try {
    await import("./check-lagaceta-title.mjs");
    const output = messages.join("\n");
    assert.match(output, /Publicación estimada/);
    assert.match(output, /Ritmo:/);
    assert.match(output, /Si cierran desde el 19 dic/);
    assert.equal(telegramCalls, 0);

    const state = JSON.parse(await readFile(path.join(stateDirectory, "state.json"), "utf8"));
    const estimate = state.estimates["2026-TP1000"];
    assert.equal(estimate.pendingAhead, 199);
    assert.equal(estimate.forecast.averagePerPublicationDay, 20);
    assert.ok(estimate.forecast.range.from);
    assert.ok(estimate.forecast.extendedClosure.from);
    assert.ok(estimate.forecast.calendar.extendedClosureDates.length > 0);
  } finally {
    console.log = actualLog;
    globalThis.fetch = actualFetch;
    globalThis.Date = RealDate;
    delete process.env.TITLE_MONITOR_TARGETS;
    delete process.env.TITLE_MONITOR_STATE_DIRECTORY;
    delete process.env.TITLE_MONITOR_DRY_RUN;
  }
});

test("un título publicado no muestra cola ni estimación de otros TP", async () => {
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "title-monitor-published-"));
  process.env.TITLE_MONITOR_TARGETS = "2026-TP1000";
  process.env.TITLE_MONITOR_STATE_DIRECTORY = stateDirectory;
  process.env.TITLE_MONITOR_DRY_RUN = "true";
  const row = (number) => `<tr class="consulta-row">${[
    `2026-TP${number}`, "11/08/2026", "TP-TITULO PROFESIONALES",
    "PERSONA DE PRUEBA", number === 1000 ? "195" : "-", "-",
    number === 1000 ? "23/10/2026" : "-", "-",
    number <= 800 || number === 1000 ? "Publicado" : "Editado",
  ].map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
  const yearHtml = Array.from({ length: 1_000 }, (_, index) => row(index + 1)).join("");
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const messages = [];
  globalThis.fetch = async (input) => new Response(
    new URL(input).searchParams.get("search") === "2026-TP" ? yearHtml : row(1_000),
  );
  console.log = (...args) => messages.push(args.join(" "));
  try {
    await import("./check-lagaceta-title.mjs?published-test");
    const output = messages.join("\n");
    assert.match(output, /Tu título ya fue publicado/);
    assert.doesNotMatch(output, /TP anteriores pendientes|Avance desde el ingreso|Publicación estimada|Ventana orientativa/);
    const state = JSON.parse(await readFile(path.join(stateDirectory, "state.json"), "utf8"));
    assert.equal(state.estimates["2026-TP1000"], undefined);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    delete process.env.TITLE_MONITOR_TARGETS;
    delete process.env.TITLE_MONITOR_STATE_DIRECTORY;
    delete process.env.TITLE_MONITOR_DRY_RUN;
  }
});

test("envía una prueba al contacto de WhatsApp sin llamar a Telegram", async () => {
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "title-monitor-contact-"));
  const keys = [
    "TITLE_MONITOR_TARGETS", "TITLE_MONITOR_STATE_DIRECTORY", "TITLE_MONITOR_DRY_RUN",
    "TITLE_MONITOR_TELEGRAM_DISABLED", "WHAPI_TOKEN", "WHAPI_RECIPIENTS", "WHATSAPP_DISABLED",
    "GITHUB_EVENT_NAME",
  ];
  const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    TITLE_MONITOR_TARGETS: "2026-TP1",
    TITLE_MONITOR_STATE_DIRECTORY: stateDirectory,
    TITLE_MONITOR_DRY_RUN: "false",
    TITLE_MONITOR_TELEGRAM_DISABLED: "true",
    WHAPI_TOKEN: "token-de-prueba",
    WHAPI_RECIPIENTS: "50586793204@s.whatsapp.net",
    WHATSAPP_DISABLED: "false",
    GITHUB_EVENT_NAME: "workflow_dispatch",
  });
  const row = `<tr class="consulta-row">${[
    "2026-TP1", "15/10/2026", "TP-TITULO PROFESIONALES", "PERSONA DE PRUEBA",
    "-", "-", "-", "-", "Redactado",
  ].map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const calls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    calls.push({ url, options });
    if (url.hostname === "api.telegram.org") throw new Error("Telegram no debe recibir la prueba");
    if (url.hostname === "gate.whapi.cloud") {
      return new Response(JSON.stringify({ message: { id: `contact-test-${calls.length}` } }), { status: 200 });
    }
    return new Response(row, { status: 200 });
  };
  console.log = () => {};
  try {
    await import("./check-lagaceta-title.mjs?contact-test");
    assert.equal(calls.filter(({ url }) => url.hostname === "api.telegram.org").length, 0);
    const sent = calls.filter(({ url }) => url.hostname === "gate.whapi.cloud");
    assert.equal(sent.length, 2);
    assert.equal(sent[0].url.pathname, "/messages/text");
    const payload = JSON.parse(sent[0].options.body);
    assert.equal(payload.to, "50586793204@s.whatsapp.net");
    assert.match(payload.body, /2026-TP1/);
    assert.match(payload.body, /Primera consulta/);
    assert.equal(payload.no_link_preview, true);
    assert.equal(sent[1].url.pathname, "/messages/interactive");
    assert.equal(JSON.parse(sent[1].options.body).action.buttons.length, 1);
    const state = JSON.parse(await readFile(path.join(stateDirectory, "state.json"), "utf8"));
    assert.equal(state.lastTelegramMessage, null);
    assert.equal(Object.values(state.lastWhatsAppMessages)[0].ids.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    for (const key of keys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});
