import assert from "node:assert/strict";
import test from "node:test";
import { calculateQueue, getExcludedReason } from "./forecast.mjs";

const dayMs = 86_400_000;
const utcDate = (value) => new Date(`${value}T00:00:00Z`);
const officialDate = (date) => `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;

const fixture = (today, targetNumber = 2_000, publishedCount = 800) => {
  const sampleDays = [];
  for (let offset = 1; sampleDays.length < 40; offset++) {
    const date = new Date(today.getTime() - offset * dayMs);
    if (!getExcludedReason(date)) sampleDays.push(date);
  }
  const records = new Map();
  for (let number = 1; number < targetNumber; number++) {
    records.set(number, {
      status: number <= publishedCount ? "Publicado" : "Redactado",
      receivedAt: "01/09/2026",
      publicationDate: number <= publishedCount
        ? officialDate(sampleDays[Math.floor((number - 1) / 20)])
        : "-",
    });
  }
  records.set(targetNumber, { status: "Redactado" });
  return { records, source: "https://www.lagaceta.gob.ni/consultas?t=1&search=2026-TP" };
};

test("excluye asuetos, feriados, fines de semana y vacaciones públicas", () => {
  assert.match(getExcludedReason(utcDate("2026-11-02")), /Asueto/);
  assert.match(getExcludedReason(utcDate("2026-11-09")), /Asueto/);
  assert.match(getExcludedReason(utcDate("2026-12-08")), /Inmaculada/);
  assert.match(getExcludedReason(utcDate("2026-12-24")), /Vacaciones/);
  assert.match(getExcludedReason(utcDate("2027-01-01")), /Vacaciones/);
  assert.match(getExcludedReason(utcDate("2027-01-18")), /Rubén/);
  assert.match(getExcludedReason(utcDate("2026-11-08")), /Fin de semana/);
  assert.equal(getExcludedReason(utcDate("2027-01-04")), null);
  assert.equal(getExcludedReason(utcDate("2026-12-21")), null);
  assert.match(getExcludedReason(utcDate("2026-12-21"), true), /Escenario/);
});

test("usa TP anteriores, 40 días de publicación y guarda el calendario", () => {
  const today = utcDate("2026-10-27");
  const yearRecords = fixture(today);
  const queue = calculateQueue("2026-TP2000", "15/10/2026", yearRecords, today);
  assert.equal(queue.pendingAhead, 1_199);
  assert.equal(queue.forecast.samplePublicationDays, 40);
  assert.equal(queue.forecast.fourWeekRate, 20);
  assert.equal(queue.forecast.eightWeekRate, 20);
  assert.equal(queue.forecast.averagePerPublicationDay, 20);
  assert.ok(queue.forecast.range.from <= queue.forecast.range.expected);
  assert.ok(queue.forecast.range.expected <= queue.forecast.range.to);
  assert.equal(getExcludedReason(utcDate(queue.forecast.range.from)), null);
  assert.ok(queue.forecast.calendar.excludedDates.some(({ date }) => date === "2026-11-02"));
  assert.ok(queue.forecast.calendar.excludedDates.some(({ date }) => date === "2026-11-09"));

  yearRecords.records.set(2_100, {
    status: "Publicado",
    receivedAt: "01/09/2026",
    publicationDate: "26/10/2026",
  });
  assert.deepEqual(calculateQueue("2026-TP2000", "15/10/2026", yearRecords, today), queue);
});

test("el cierre extendido desplaza el pronóstico de fin de año", () => {
  const today = utcDate("2026-12-16");
  const queue = calculateQueue("2026-TP2000", "15/10/2026", fixture(today), today);
  assert.ok(queue.forecast.range.from < queue.forecast.extendedClosure.from);
  assert.ok(queue.forecast.range.to < queue.forecast.extendedClosure.to);
  assert.ok(queue.forecast.calendar.extendedClosureDates.some(({ date }) => date === "2026-12-21"));
  assert.equal(getExcludedReason(utcDate(queue.forecast.extendedClosure.from), true), null);
});

test("sin publicaciones recientes no inventa fechas", () => {
  const today = utcDate("2026-10-27");
  const yearRecords = fixture(today, 2_000, 0);
  const queue = calculateQueue("2026-TP2000", "15/10/2026", yearRecords, today);
  assert.equal(queue.pendingAhead, 1_999);
  assert.equal(queue.forecast.averagePerPublicationDay, 0);
  assert.deepEqual(queue.forecast.range, { from: null, expected: null, to: null });
});

test("un avance real reduce los pendientes sin cambiar por TP posteriores", () => {
  const today = utcDate("2026-10-27");
  const yearRecords = fixture(today);
  const earlier = calculateQueue("2026-TP2000", "15/10/2026", yearRecords, today);
  for (let number = 801; number <= 900; number++) {
    yearRecords.records.set(number, {
      status: "Publicado",
      receivedAt: "01/09/2026",
      publicationDate: "26/10/2026",
    });
  }
  const later = calculateQueue("2026-TP2000", "15/10/2026", yearRecords, today);
  assert.equal(later.pendingAhead, earlier.pendingAhead - 100);
  assert.ok(later.forecast.range.expected <= earlier.forecast.range.expected);
});

test("el caso de 3058 a 3252 publicaciones no proyecta sobre fines de semana", () => {
  const today = utcDate("2026-10-27");
  const recentDays = [];
  for (let offset = 2; offset <= 30; offset++) {
    const date = new Date(today.getTime() - offset * dayMs);
    if (!getExcludedReason(date)) recentDays.push(date);
  }
  const records = new Map();
  for (let number = 1; number <= 10_057; number++) {
    records.set(number, {
      status: number <= 3_058 ? "Publicado" : "Redactado",
      receivedAt: "15/10/2026",
      publicationDate: number <= 3_058
        ? officialDate(recentDays[(number - 1) % recentDays.length])
        : "-",
    });
  }
  records.set(10_058, { status: "Redactado" });
  const yearRecords = { records, source: "official fixture" };
  const before = calculateQueue("2026-TP10058", "15/10/2026", yearRecords, today);
  assert.equal(before.pendingAhead, 6_999);

  for (let number = 3_059; number <= 3_252; number++) {
    records.set(number, {
      status: "Publicado",
      receivedAt: "15/10/2026",
      publicationDate: "26/10/2026",
    });
  }
  const after = calculateQueue("2026-TP10058", "15/10/2026", yearRecords, today);
  assert.equal(after.pendingAhead, 6_805);
  assert.ok(after.forecast.range.expected <= before.forecast.range.expected);
  assert.ok(after.forecast.range.expected >= "2027-01-04");
  for (const date of [after.forecast.range.from, after.forecast.range.expected, after.forecast.range.to]) {
    assert.equal(getExcludedReason(utcDate(date)), null);
  }
});
