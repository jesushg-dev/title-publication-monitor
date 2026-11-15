import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { makePdf } from "./pdf-test-fixture.mjs";

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
    assert.match(output, /Registro:<\/b> <code>2026-TP1000<\/code> \[🟢 <b>Publicado<\/b>\]/);
    assert.match(output, /Gaceta N\.º:<\/b> 195 \[⏳ <b>Página sin verificar<\/b>\]/);
    assert.match(output, /Ingreso:<\/b> 11\/08\/2026 \| <b>Publicación:<\/b> 23\/10\/2026/);
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
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url.pathname, "/messages/interactive");
    const payload = JSON.parse(sent[0].options.body);
    assert.equal(payload.to, "50586793204@s.whatsapp.net");
    assert.match(payload.body.text, /2026-TP1/);
    assert.match(payload.body.text, /Primera consulta/);
    assert.doesNotMatch(payload.body.text, /Fuente oficial|https:\/\//);
    assert.equal(payload.action.buttons.length, 1);
    const state = JSON.parse(await readFile(path.join(stateDirectory, "state.json"), "utf8"));
    assert.equal(state.lastTelegramMessage, null);
    assert.equal(Object.values(state.lastWhatsAppMessages)[0].ids.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    for (const key of keys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});

test("dos avisos publicados adjuntan imagen y PDF; un fallo conserva los anteriores", async () => {
  const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "title-monitor-media-"));
  const keys = [
    "TITLE_MONITOR_TARGETS", "TITLE_MONITOR_STATE_DIRECTORY", "TITLE_MONITOR_DRY_RUN",
    "TITLE_MONITOR_TELEGRAM_DISABLED", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
    "WHAPI_TOKEN", "WHAPI_RECIPIENTS", "WHATSAPP_DISABLED", "GITHUB_EVENT_NAME",
  ];
  const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    TITLE_MONITOR_TARGETS: "2026-TP1",
    TITLE_MONITOR_STATE_DIRECTORY: stateDirectory,
    TITLE_MONITOR_DRY_RUN: "false",
    TITLE_MONITOR_TELEGRAM_DISABLED: "false",
    TELEGRAM_BOT_TOKEN: "token-de-prueba",
    TELEGRAM_CHAT_ID: "12345",
    WHAPI_TOKEN: "token-de-prueba",
    WHAPI_RECIPIENTS: "120363426827575325@g.us",
    WHATSAPP_DISABLED: "false",
    GITHUB_EVENT_NAME: "workflow_dispatch",
  });
  const pdfUrl = "https://www.lagaceta.gob.ni/test.pdf";
  const cells = [
    "2026-TP1", "11/08/2026", "TP-TITULO PROFESIONALES", "PERSONA DE PRUEBA",
    "195", `<a href="${pdfUrl}">PDF</a>`, "23/10/2026", "-", "Publicado",
  ];
  const row = `<tr class="consulta-row">${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
  const pdf = makePdf("PERSONA DE PRUEBA");
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const calls = [];
  let telegramId = 100;
  let whatsappId = 100;
  let pdfAvailable = true;
  const messages = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    calls.push({ url, options });
    if (url.hostname === "www.lagaceta.gob.ni") {
      return url.pathname === "/test.pdf"
        ? pdfAvailable
          ? new Response(pdf, { headers: { "content-type": "application/pdf" } })
          : new Response("No disponible", { status: 503 })
        : new Response(row);
    }
    if (url.hostname === "api.telegram.org") {
      return new Response(JSON.stringify({ ok: true, result: { message_id: ++telegramId } }));
    }
    if (url.hostname === "gate.whapi.cloud") {
      return options.method === "DELETE"
        ? new Response('{"success":true}')
        : new Response(JSON.stringify({ message: { id: `whatsapp-${++whatsappId}` } }));
    }
    throw new Error(`Solicitud inesperada: ${url}`);
  };
  console.log = (...args) => messages.push(args.join(" "));
  try {
    await import("./check-lagaceta-title.mjs?media-first");
    await import("./check-lagaceta-title.mjs?media-second");
    const sentTelegram = (method) => calls.filter(({ url }) =>
      url.hostname === "api.telegram.org" && url.pathname.endsWith(`/${method}`));
    const sentWhatsApp = (method) => calls.filter(({ url, options }) =>
      url.hostname === "gate.whapi.cloud" && url.pathname === `/messages/${method}` && options.method === "POST");
    for (const method of ["sendMessage", "sendPhoto", "sendDocument"]) {
      assert.equal(sentTelegram(method).length, 2, method);
    }
    for (const method of ["interactive", "image", "document"]) {
      assert.equal(sentWhatsApp(method).length, 2, method);
    }
    assert.equal(sentWhatsApp("text").length, 0);
    assert.equal(sentTelegram("deleteMessage").length, 3);
    assert.equal(calls.filter(({ url, options }) =>
      url.hostname === "gate.whapi.cloud" && options.method === "DELETE").length, 3);
    const interactive = JSON.parse(sentWhatsApp("interactive")[0].options.body);
    assert.match(interactive.body.text, /Gaceta N\.º:\* 195, pág\. 1/);
    assert.doesNotMatch(interactive.body.text, /Fuente oficial|https:\/\//);
    assert.equal(interactive.action.buttons.length, 2);
    assert.equal(sentTelegram("sendPhoto")[0].options.body.get("caption"),
      "Captura de la página 1 con el registro de PERSONA DE PRUEBA");
    assert.equal(JSON.parse(sentWhatsApp("image")[0].options.body).caption,
      "Captura de la página 1 con el registro de PERSONA DE PRUEBA");
    assert.match(messages.join("\n"), /Gaceta N\.º:<\/b> 195, pág\. 1 \[🟢 <b>Verificado<\/b>\]/);
    assert.doesNotMatch(messages.join("\n"), /TP anteriores pendientes|Avance desde el ingreso/);
    const state = JSON.parse(await readFile(path.join(stateDirectory, "state.json"), "utf8"));
    assert.equal(state.lastTelegramMessage.mediaByRegistry["2026-TP1"].document, 106);
    assert.equal(state.records["2026-TP1"].pdfVerification.document, undefined);

    pdfAvailable = false;
    await import("./check-lagaceta-title.mjs?media-temporary-failure");
    assert.equal(sentTelegram("sendPhoto").length, 2);
    assert.equal(sentTelegram("sendDocument").length, 2);
    assert.equal(sentWhatsApp("image").length, 2);
    assert.equal(sentWhatsApp("document").length, 2);
    const retainedState = JSON.parse(await readFile(path.join(stateDirectory, "state.json"), "utf8"));
    assert.equal(retainedState.records["2026-TP1"].pdfVerification.status, "verified");
    assert.equal(retainedState.lastTelegramMessage.mediaByRegistry["2026-TP1"].document, 106);
    assert.match(messages.at(-2), /pág\. 1 \[🟢 <b>Verificado<\/b>\]/);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    for (const key of keys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});
