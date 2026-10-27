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
