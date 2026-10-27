const dayMs = 24 * 60 * 60 * 1000;
const dateKey = (date) => date.toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * dayMs);

const nationalHolidays = new Map([
  ["01-01", "Año Nuevo"],
  ["01-18", "Natalicio de Rubén Darío"],
  ["02-02", "Día de la Reconciliación y la Paz"],
  ["02-21", "Natalicio de Augusto C. Sandino"],
  ["05-01", "Día del Trabajador"],
  ["05-30", "Día de las Madres"],
  ["07-19", "Revolución Popular Sandinista"],
  ["09-14", "Batalla de San Jacinto"],
  ["09-15", "Independencia"],
  ["11-08", "Día de Carlos Fonseca"],
  ["12-08", "Inmaculada Concepción"],
  ["12-25", "Navidad"],
]);

const specialDays = new Map([
  ["2026-11-02", "Asueto del 2 de noviembre"],
  ["2026-11-09", "Asueto compensatorio del 9 de noviembre"],
]);

const easterSunday = (year) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k + 70) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
};

export const getExcludedReason = (date, extendedClosure = false) => {
  const key = dateKey(date);
  const monthDay = key.slice(5);
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return "Fin de semana";
  if (extendedClosure && key >= "2026-12-19" && key <= "2027-01-03") {
    return "Escenario: vacaciones institucionales extendidas";
  }
  if (monthDay >= "12-24" || monthDay === "01-01") {
    return "Vacaciones del sector público";
  }
  if (specialDays.has(key)) return specialDays.get(key);
  if (nationalHolidays.has(monthDay)) return nationalHolidays.get(monthDay);

  const easter = easterSunday(date.getUTCFullYear());
  if (key === dateKey(addDays(easter, -3))) return "Jueves Santo";
  if (key === dateKey(addDays(easter, -2))) return "Viernes Santo";

  if (weekday === 1) {
    const sunday = addDays(date, -1);
    const sundayHoliday = nationalHolidays.get(dateKey(sunday).slice(5));
    if (sundayHoliday) return `Compensación de ${sundayHoliday}`;
  }
  return null;
};

const parseOfficialDate = (value) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value ?? "");
  if (!match) return null;
  const date = new Date(Date.UTC(+match[3], +match[2] - 1, +match[1]));
  return date.getUTCDate() === +match[1] && date.getUTCMonth() === +match[2] - 1
    ? date
    : null;
};

const projectDate = (today, pendingAhead, rate, extendedClosure = false) => {
  if (rate <= 0 || pendingAhead <= 0) return null;
  let capacity = 0;
  for (let offset = 1; offset <= 366 * 5; offset++) {
    const date = addDays(today, offset);
    if (getExcludedReason(date, extendedClosure)) continue;
    capacity += rate;
    if (capacity >= pendingAhead) return dateKey(date);
  }
  return null;
};

const excludedDatesBetween = (start, end, extendedClosure = false) => {
  const days = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const reason = getExcludedReason(date, extendedClosure);
    if (reason) days.push({ date: dateKey(date), reason });
  }
  return days;
};

const holidayDatesInBlock = (days) => {
  const weeks = new Set(days.map((date) => {
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    return dateKey(addDays(date, -daysSinceMonday));
  }));
  const holidays = [];
  for (const monday of weeks) {
    for (let offset = 0; offset < 5; offset++) {
      const date = addDays(new Date(`${monday}T00:00:00Z`), offset);
      const reason = getExcludedReason(date);
      if (reason) holidays.push({ date: dateKey(date), reason });
    }
  }
  return holidays;
};

const calculateForecast = (today, pendingAhead, publishedDates) => {
  const sampleDays = [];
  for (let offset = 1; sampleDays.length < 40 && offset <= 120; offset++) {
    const date = addDays(today, -offset);
    if (!getExcludedReason(date)) sampleDays.push(date);
  }
  if (sampleDays.length < 40) return null;
  sampleDays.reverse();

  const counts = new Map();
  for (const date of publishedDates) {
    const key = dateKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const weeklyRates = [];
  const normalWeeklyRates = [];
  const excludedHolidayBlocks = [];
  for (let block = 0; block < 8; block++) {
    const blockDays = sampleDays.slice(block * 5, block * 5 + 5);
    const count = blockDays
      .reduce((sum, date) => sum + (counts.get(dateKey(date)) ?? 0), 0);
    const rate = count / 5;
    weeklyRates.push(rate);
    const holidays = holidayDatesInBlock(blockDays);
    if (holidays.length) {
      excludedHolidayBlocks.push({
        from: dateKey(blockDays[0]),
        to: dateKey(blockDays.at(-1)),
        holidays,
      });
    } else {
      normalWeeklyRates.push(rate);
    }
  }

  const eightWeekRate = weeklyRates.reduce((sum, rate) => sum + rate, 0) / 8;
  const recentFour = normalWeeklyRates.slice(-4);
  const recentTwo = normalWeeklyRates.slice(-2);
  const fourWeekRate = recentFour.length === 4
    ? recentFour.reduce((sum, rate) => sum + rate, 0) / 4
    : null;
  const twoWeekRate = recentTwo.length === 2
    ? recentTwo.reduce((sum, rate) => sum + rate, 0) / 2
    : null;
  const averagePerPublicationDay = fourWeekRate === null || twoWeekRate === null
    ? 0
    : (fourWeekRate + twoWeekRate) / 2;
  const slowRate = Math.min(fourWeekRate ?? 0, twoWeekRate ?? 0);
  const fastRate = Math.max(fourWeekRate ?? 0, twoWeekRate ?? 0);
  const toRange = (extendedClosure) => ({
    from: projectDate(today, pendingAhead, fastRate, extendedClosure),
    expected: projectDate(today, pendingAhead, averagePerPublicationDay, extendedClosure),
    to: projectDate(today, pendingAhead, slowRate, extendedClosure),
  });
  const range = toRange(false);
  const extendedClosure = toRange(true);
  const lastDate = [range.to, extendedClosure.to, range.expected, extendedClosure.expected]
    .filter(Boolean).sort().at(-1);
  const calendarEnd = lastDate ? new Date(`${lastDate}T00:00:00Z`) : today;

  return {
    method: "two-and-four-normal-publication-week-sensitivity-v3",
    averagePerPublicationDay,
    twoWeekRate,
    fourWeekRate,
    eightWeekRate,
    weeklyRates,
    excludedHolidayBlocks,
    samplePublicationDays: sampleDays.length,
    ratePublicationDays: recentFour.length * 5,
    sampleFrom: dateKey(sampleDays[0]),
    sampleTo: dateKey(sampleDays.at(-1)),
    range,
    extendedClosure,
    calendar: {
      timeZone: "America/Managua",
      weekendsExcluded: true,
      excludedDates: excludedDatesBetween(sampleDays[0], calendarEnd),
      extendedClosureDates: excludedDatesBetween(today, calendarEnd, true)
        .filter(({ reason }) => reason.startsWith("Escenario:")),
    },
  };
};

export const calculateQueue = (registry, receivedAt, yearRecords, today) => {
  const parts = /^(\d{4})-TP(\d+)$/i.exec(registry ?? "");
  if (!parts || !yearRecords?.records.has(Number(parts[2]))) return null;
  const targetNumber = Number(parts[2]);
  const targetRecord = yearRecords.records.get(targetNumber);
  const registrationDate = parseOfficialDate(receivedAt);
  let publishedAhead = 0;
  let pendingAhead = 0;
  let initialPending = 0;
  let publishedSinceRegistration = 0;
  let missingReceiptDates = 0;
  let missingPublicationDates = 0;
  const publishedDates = [];

  for (const [number, record] of yearRecords.records) {
    if (number >= targetNumber) continue;
    const isPublished = /^publicado$/i.test(record.status);
    const publicationDate = parseOfficialDate(record.publicationDate);
    if (isPublished) {
      publishedAhead++;
      if (publicationDate && publicationDate <= today) publishedDates.push(publicationDate);
    } else {
      pendingAhead++;
    }

    if (!registrationDate) continue;
    const priorReceivedAt = parseOfficialDate(record.receivedAt);
    if (!priorReceivedAt) {
      missingReceiptDates++;
      continue;
    }
    if (priorReceivedAt > registrationDate) continue;
    if (isPublished && !publicationDate) {
      missingPublicationDates++;
      continue;
    }
    if (!isPublished || publicationDate > registrationDate) {
      initialPending++;
      if (isPublished) publishedSinceRegistration++;
    }
  }

  return {
    registry,
    source: yearRecords.source,
    publishedAhead,
    pendingAhead,
    totalAhead: publishedAhead + pendingAhead,
    forecast: !/^publicado$/i.test(targetRecord.status) && pendingAhead > 0
      ? calculateForecast(today, pendingAhead, publishedDates)
      : null,
    registrationDate: registrationDate ? dateKey(registrationDate) : null,
    initialPending,
    publishedSinceRegistration,
    missingReceiptDates,
    missingPublicationDates,
  };
};
