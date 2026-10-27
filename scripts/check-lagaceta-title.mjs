import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import path from "node:path";
import { calculateQueue } from "./forecast.mjs";

const defaultRegistries = [
  "2026-TP30799",
  "2026-TP29824",
  "DANILO JOSE ACEVEDO FLORES",
];

const targets = (
  process.env.TITLE_MONITOR_TARGETS ??
  process.env.TITLE_MONITOR_REGISTRIES ??
  defaultRegistries.join(",")
)
  .split(",")
  .map((target) => target.trim())
  .filter(Boolean);

const stateDirectory =
  process.env.TITLE_MONITOR_STATE_DIRECTORY ?? ".title-monitor-state";
const statePath = path.join(stateDirectory, "state.json");

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatValue = (value) =>
  escapeHtml(value && value !== "-" ? value : "Pendiente");

const formatStatusBadge = (status) => {
  const s = String(status ?? "").trim();
  if (/publicado/i.test(s)) return `🟢 <b>${escapeHtml(s)}</b>`;
  if (/redactado/i.test(s)) return `📝 <b>${escapeHtml(s)}</b>`;
  if (/en redacci/i.test(s)) return `✏️ <b>${escapeHtml(s)}</b>`;
  return `⏳ <b>${escapeHtml(s || "Pendiente")}</b>`;
};

const decodeHtml = (value) =>
  value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ntilde;/gi, "ñ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeText = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const isRegistryCode = (value) => /^\d{4}-/i.test(value.trim());

const extractCells = (row) =>
  [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => {
    const html = match[1];
    const linkMatch = html.match(/href="([^"]+)"/i);
    if (linkMatch) {
      try {
        return new URL(linkMatch[1], "https://www.lagaceta.gob.ni").toString();
      } catch {
        return linkMatch[1];
      }
    }
    return decodeHtml(html);
  });

const getRegistryParts = (registry) =>
  /^(\d{4})-TP(\d+)$/i.exec(registry ?? "");

const getManaguaDate = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Managua",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type) => Number(parts.find((item) => item.type === type).value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
};

const fetchYearRecords = async (year) => {
  const queryUrl = new URL("https://www.lagaceta.gob.ni/consultas");
  queryUrl.searchParams.set("t", "1");
  queryUrl.searchParams.set("search", `${year}-TP`);

  const response = await fetch(queryUrl, {
    headers: { "User-Agent": "title-publication-monitor/1.0" },
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    throw new Error(`La Gaceta respondió HTTP ${response.status}.`);
  }

  const html = await response.text();
  const records = new Map();
  let highest = 0;

  for (const row of html.matchAll(/<tr class="consulta-row">([\s\S]*?)<\/tr>/gi)) {
    const cells = extractCells(row[0]);
    const registry = getRegistryParts(cells[0]);
    if (cells.length < 9 || registry?.[1] !== year) continue;

    const number = Number(registry[2]);
    if (!Number.isSafeInteger(number) || number < 1) continue;
    records.set(number, {
      status: cells[8],
      receivedAt: cells[1],
      publicationDate: cells[6],
    });
    highest = Math.max(highest, number);
  }

  if (!highest || records.size !== highest) {
    throw new Error(`La consulta de TP ${year} devolvió datos incompletos.`);
  }

  return {
    records,
    source: queryUrl.toString(),
  };
};

const formatQueue = (queue, status) => {
  if (!queue || !queue.totalAhead) {
    return "📈 <b>Avance y fecha:</b> no disponibles";
  }

  const missingDates = queue.missingReceiptDates + queue.missingPublicationDates;
  const reliableHistory = missingDates <= Math.max(10, queue.initialPending * 0.01);
  const ratio = reliableHistory && queue.registrationDate && queue.initialPending
    ? queue.publishedSinceRegistration / queue.initialPending
    : null;
  const filled = Math.round((ratio ?? 0) * 10);
  const percentage = Math.round((ratio ?? 0) * 100);
  const count = queue.pendingAhead.toLocaleString("es-NI");
  const formatDate = (date) => date && new Intl.DateTimeFormat("es-NI", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
  const rangeText = (range) => range?.from && range?.to
    ? `${formatDate(range.from)} – ${formatDate(range.to)}`
    : null;
  const mainRange = rangeText(queue.forecast?.range);
  const alternateRange = rangeText(queue.forecast?.extendedClosure);
  const rate = queue.forecast?.averagePerPublicationDay.toLocaleString("es-NI", {
    maximumFractionDigits: 1,
  });

  return [
    ratio === null
      ? "📈 <b>Avance desde el ingreso:</b> no disponible"
      : `📈 <b>Avance desde el ingreso:</b>\n${"█".repeat(filled)}${"░".repeat(10 - filled)} ≈${percentage}%\n${queue.publishedSinceRegistration.toLocaleString("es-NI")} de ${queue.initialPending.toLocaleString("es-NI")} TP pendientes al ingresar`,
    `⏳ <b>TP anteriores pendientes:</b> ${count}`,
    /^publicado$/i.test(status)
      ? "✅ <b>Tu título ya fue publicado.</b>"
      : queue.pendingAhead === 0
        ? "🗓️ <b>Publicación estimada:</b> no quedan TP anteriores pendientes; esperando confirmación oficial"
      : mainRange
        ? [
            `🗓️ <b>Publicación estimada:</b> ${mainRange}`,
            `📊 <b>Ritmo:</b> ≈${rate} TP por día hábil`,
            alternateRange && alternateRange !== mainRange
              ? `🏖️ <b>Si cierran desde el 19 dic:</b> ${alternateRange}`
              : null,
          ].filter(Boolean).join("\n")
        : "🗓️ <b>Publicación estimada:</b> no disponible con los datos recientes",
  ].join("\n");
};

const loadPreviousState = async () => {
  try {
    const savedState = JSON.parse(await readFile(statePath, "utf8"));

    if (savedState.registry) {
      return { records: { [savedState.registry]: savedState } };
    }

    return savedState;
  } catch (error) {
    if (error.code === "ENOENT") return { records: {} };
    throw error;
  }
};

const fetchCurrentState = async (target) => {
  const isCode = isRegistryCode(target);
  const queryUrl = new URL("https://www.lagaceta.gob.ni/consultas");
  queryUrl.searchParams.set("t", "1");
  queryUrl.searchParams.set("search", target);

  const response = await fetch(queryUrl, {
    headers: { "User-Agent": "title-publication-monitor/1.0" },
  });

  if (!response.ok) {
    throw new Error(`La Gaceta respondió HTTP ${response.status}.`);
  }

  const html = await response.text();
  const rows = [...html.matchAll(/<tr class="consulta-row">([\s\S]*?)<\/tr>/gi)];

  if (isCode) {
    if (!rows.length) {
      throw new Error("No fue posible confirmar la fila del registro en La Gaceta.");
    }

    const matchingRow = rows
      .map((m) => extractCells(m[0]))
      .find(
        (cells) =>
          cells.length >= 9 && cells[0].toLowerCase() === target.toLowerCase(),
      );

    if (!matchingRow) {
      throw new Error(
        `La respuesta no contiene la fila esperada para el registro ${target}.`,
      );
    }

    return {
      target,
      isPending: false,
      registry: matchingRow[0],
      receivedAt: matchingRow[1],
      processType: matchingRow[2],
      entity: matchingRow[3],
      gazetteNumber: matchingRow[4],
      link: matchingRow[5],
      publicationDate: matchingRow[6],
      errataDate: matchingRow[7],
      status: matchingRow[8],
      checkedAt: new Date().toISOString(),
    };
  }

  // Target is a person name to monitor until it appears
  const normalizedTarget = normalizeText(target);
  const targetWords = normalizedTarget.split(" ").filter((w) => w.length > 2);

  let matchedCells = null;

  for (const m of rows) {
    const cells = extractCells(m[0]);
    if (cells.length < 9) continue;
    const normalizedEntity = normalizeText(cells[3]);
    const allWordsMatch = targetWords.every((word) =>
      normalizedEntity.includes(word),
    );
    if (allWordsMatch) {
      matchedCells = cells;
      break;
    }
  }

  if (matchedCells) {
    return {
      target,
      isPending: false,
      registry: matchedCells[0],
      receivedAt: matchedCells[1],
      processType: matchedCells[2],
      entity: matchedCells[3],
      gazetteNumber: matchedCells[4],
      link: matchedCells[5],
      publicationDate: matchedCells[6],
      errataDate: matchedCells[7],
      status: matchedCells[8],
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    target,
    isPending: true,
    registry: null,
    receivedAt: null,
    processType: "TP-TITULO PROFESIONALES",
    entity: target,
    gazetteNumber: "-",
    link: "-",
    publicationDate: "-",
    errataDate: "-",
    status: "Pendiente de ingreso",
    checkedAt: new Date().toISOString(),
  };
};

const notifyTelegram = async (message, inlineKeyboard = []) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error(
      "Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en los secretos del repositorio.",
    );
  }

  const payload = {
    chat_id: chatId,
    text: message,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };

  if (inlineKeyboard.length > 0) {
    payload.reply_markup = {
      inline_keyboard: inlineKeyboard,
    };
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(`Telegram respondió HTTP ${response.status}.`);
  }

  const sentMessage = await response.json();
  if (!sentMessage.ok || !Number.isInteger(sentMessage.result?.message_id)) {
    throw new Error("Telegram no devolvió el identificador del mensaje enviado.");
  }
  return sentMessage.result.message_id;
};

const deleteTelegramMessage = async (messageId) => {
  const response = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/deleteMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        message_id: messageId,
      }),
    },
  );
  const deletedMessage = await response.json();
  if (!response.ok || !deletedMessage.ok) {
    throw new Error(`Telegram no pudo borrar el mensaje anterior (HTTP ${response.status}).`);
  }
};

const previousState = await loadPreviousState();
const previousRecords = previousState.records ?? {};
const results = [];

for (const target of targets) {
  try {
    const resolvedTarget =
      previousRecords[target]?.registry && !previousRecords[target]?.isPending
        ? previousRecords[target].registry
        : target;

    const current = await fetchCurrentState(resolvedTarget);
    current.target = target;

    const prev =
      previousRecords[target] ??
      (current.registry ? previousRecords[current.registry] : null);

    const trackedFields = [
      ["receivedAt", "Fecha de ingreso"],
      ["processType", "Tipo de trámite"],
      ["entity", "Titular"],
      ["status", "Estado"],
      ["gazetteNumber", "N.º de Gaceta"],
      ["link", "Enlace"],
      ["publicationDate", "Fecha de publicación"],
      ["errataDate", "Fecha de fe de errata"],
    ];

    let changes = [];
    let isNewlyDiscovered = false;

    if (prev?.isPending && !current.isPending) {
      isNewlyDiscovered = true;
      changes.push(`🎉 <b>¡Registro asignado en La Gaceta:</b> ${formatValue(current.registry)}`);
    } else if (prev && !prev.isPending && !current.isPending) {
      changes = trackedFields
        .filter(([field]) => prev[field] !== current[field])
        .map(
          ([field, label]) =>
            `• <b>${label}:</b> ${formatValue(prev[field])} → ${formatValue(current[field])}`,
        );
    }

    results.push({
      target,
      current,
      prev,
      changes,
      isNewlyDiscovered,
      error: null,
    });
  } catch (error) {
    results.push({ target, current: null, prev: null, changes: [], error });
  }
}

const yearRequests = new Map();
for (const { current } of results) {
  const year = getRegistryParts(current?.registry)?.[1];
  if (year && !yearRequests.has(year)) {
    yearRequests.set(
      year,
      fetchYearRecords(year).catch((error) => {
        console.warn(`No se pudo contar los TP de ${year}: ${error.message}`);
        return null;
      }),
    );
  }
}
const today = getManaguaDate();
for (const result of results) {
  const year = getRegistryParts(result.current?.registry)?.[1];
  const yearRecords = year ? await yearRequests.get(year) : null;
  result.queue = yearRecords
    ? calculateQueue(result.current.registry, result.current.receivedAt, yearRecords, today)
    : null;
  const previousQueue = previousState.estimates?.[result.current?.registry];
  result.progressChanges = previousQueue && result.queue
    ? [
        ["pendingAhead", "TP anteriores pendientes"],
        ["publishedSinceRegistration", "TP publicados desde el ingreso"],
        ["initialPending", "TP pendientes al ingresar"],
      ]
        .filter(([field]) =>
          Number.isFinite(previousQueue[field]) &&
          Number.isFinite(result.queue[field]) &&
          previousQueue[field] !== result.queue[field],
        )
        .map(([field, label]) =>
          `• <b>${label}:</b> ${previousQueue[field].toLocaleString("es-NI")} → ${result.queue[field].toLocaleString("es-NI")}`,
        )
    : [];
}

// Build the Dashboard Message
const now = new Date();
const timeStr =
  now.toLocaleDateString("es-NI", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Managua",
  }) +
  " • " +
  now.toLocaleTimeString("es-NI", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Managua",
  }) +
  " (Managua)";

const allRecordChanges = results.flatMap((r) => r.changes);
const allProgressChanges = results.flatMap((r) => r.progressChanges);
const anyNewlyDiscovered = results.some((r) => r.isNewlyDiscovered);
const hasChanges = allRecordChanges.length > 0 || allProgressChanges.length > 0 || anyNewlyDiscovered;
const hasErrors = results.some((result) => result.error);
const localDate = today.toISOString().slice(0, 10);
const eventName = process.env.GITHUB_EVENT_NAME;
const isScheduledEvent = eventName === "schedule";
const isFinalSchedule =
  isScheduledEvent && process.env.GITHUB_EVENT_SCHEDULE?.trim() === "45 20 * * 1-5";
const priorDailyStatus = previousState.dailyStatus;
const sameDayStatus = priorDailyStatus?.date === localDate;
const dayHadChanges = sameDayStatus && priorDailyStatus.hadChanges;
const dayHadErrors = sameDayStatus && priorDailyStatus.hadErrors;
const noChangeReportAlreadySent =
  sameDayStatus && priorDailyStatus.noChangeReportSent;
const sendNotification =
  !isScheduledEvent ||
  hasChanges ||
  hasErrors ||
  (isFinalSchedule &&
    !dayHadChanges &&
    !dayHadErrors &&
    !noChangeReportAlreadySent);
const sentDailyNoChangeReport =
  sendNotification &&
  isFinalSchedule &&
  !hasChanges &&
  !hasErrors &&
  !dayHadChanges &&
  !dayHadErrors;

let headerTitle = "🎓 <b>MONITOR DE TÍTULOS — LA GACETA</b>";
if (anyNewlyDiscovered) {
  headerTitle = "🎉 <b>¡NUEVO TÍTULO INGRESADO A LA GACETA!</b> 🎉\n\n" + headerTitle;
} else if (allRecordChanges.length > 0) {
  headerTitle = "🚨 <b>¡CAMBIO DETECTADO EN TU TRÁMITE!</b> 🚨\n\n" + headerTitle;
} else if (allProgressChanges.length > 0) {
  headerTitle = "📈 <b>¡CAMBIÓ EL PROGRESO DE TU TÍTULO!</b>\n\n" + headerTitle;
}

const blocks = results.map((result) => {
  if (result.error) {
    return [
      `⚠️ <b>${escapeHtml(result.target)}</b>`,
      `<b>Error al consultar:</b> ${escapeHtml(result.error.message)}`,
    ].join("\n");
  }

  const { current, changes, progressChanges, isNewlyDiscovered } = result;

  if (current.isPending) {
    return [
      `👤 <b>${escapeHtml(current.entity || current.target)}</b>`,
      `📌 <b>Estado:</b> ⏳ <b>Pendiente de ingreso por la universidad</b>`,
      `📋 <b>Registro:</b> Pendiente de asignación`,
      `🔍 <i>Búsqueda activa por nombre</i>`,
      `📈 <i>El porcentaje y la fecha estarán disponibles al recibir su registro.</i>`,
    ].join("\n");
  }

  const lines = [
    `👤 <b>${escapeHtml(current.entity || "Titular")}</b>`,
    `📌 <b>Estado:</b> ${formatStatusBadge(current.status)}`,
    `📋 <b>Registro:</b> <code>${formatValue(current.registry)}</code>`,
    `📥 <b>Fecha de ingreso:</b> ${formatValue(current.receivedAt)}`,
    formatQueue(result.queue, current.status),
  ];

  if (current.gazetteNumber !== "-") {
    lines.push(
      `📰 <b>Gaceta N.º:</b> ${formatValue(current.gazetteNumber)} | 📅 <b>Publicación:</b> ${formatValue(current.publicationDate)}`,
    );
  }

  if (isNewlyDiscovered) {
    lines.push("", "🎉 <b>¡Tu título ya fue ingresado al sistema de La Gaceta!</b>");
  } else if (changes.length > 0 || progressChanges.length > 0) {
    lines.push("", "🔄 <b>Cambios detectados:</b>", ...changes, ...progressChanges);
  }

  return lines.join("\n");
});

const footer = hasChanges
  ? "Te avisaremos cuando haya otra actualización."
  : hasErrors
    ? "⚠️ <i>Al menos un registro no se pudo confirmar.</i>"
    : sentDailyNoChangeReport
      ? "🔔 <i>Sin cambios en los registros durante las comprobaciones de hoy.</i>"
      : "🔔 <i>Sin cambios desde la última comprobación.</i>";

const dashboardMessage = [
  headerTitle,
  `📅 <i>${timeStr}</i>`,
  "───────────────────────────",
  blocks.join("\n───────────────────────────\n"),
  "───────────────────────────",
  "<i>Rango estimado con días hábiles y ritmo reciente; algunos TP se publican fuera de orden.</i>",
  footer,
].join("\n");

// Interactive Buttons (Inline Keyboard)
const inlineKeyboard = [
  [
    {
      text: "🔍 Consultar en La Gaceta",
      url: "https://www.lagaceta.gob.ni/consultas",
    },
  ],
];

// Add direct reading button for any published edition
for (const { current } of results) {
  if (current?.link && current.link !== "-") {
    inlineKeyboard.push([
      {
        text: `📖 Leer Gaceta N.º ${current.gazetteNumber || "Oficial"} (${current.entity ? current.entity.split(" ")[0] : "Título"})`,
        url: current.link,
      },
    ]);
  }
}

// Send a new message so Telegram can notify the chat, then remove the last one.
let lastTelegramMessage = previousState.lastTelegramMessage ?? null;
if (process.env.TITLE_MONITOR_DRY_RUN !== "true" && sendNotification) {
  const messageId = await notifyTelegram(dashboardMessage, inlineKeyboard);
  const previousMessage = lastTelegramMessage;
  const chatFingerprint = createHmac("sha256", process.env.TELEGRAM_BOT_TOKEN)
    .update(String(process.env.TELEGRAM_CHAT_ID))
    .digest("hex");
  lastTelegramMessage = { messageId, sentAt: now.toISOString(), chatFingerprint };
  const previousSentAt = Date.parse(previousMessage?.sentAt);
  if (
    Number.isInteger(previousMessage?.messageId) &&
    previousMessage.messageId !== messageId &&
    previousMessage.chatFingerprint === chatFingerprint &&
    Number.isFinite(previousSentAt) &&
    now.getTime() - previousSentAt < 48 * 60 * 60 * 1000
  ) {
    try {
      await deleteTelegramMessage(previousMessage.messageId);
    } catch (error) {
      console.warn(error.message);
    }
  }
} else if (process.env.TITLE_MONITOR_DRY_RUN !== "true") {
  console.log("Sin cambios para notificar; se omite el mensaje intermedio del día.");
}

// Save Updated State
const updatedRecords = {};
for (const { target, current } of results) {
  if (!current) continue;
  if (current.registry) {
    updatedRecords[current.registry] = current;
  }
  updatedRecords[target] = current;
}

const activePreviousRecords = Object.fromEntries(
  Object.entries(previousRecords).filter(([key]) =>
    targets.includes(key) ||
    targets.some((target) => previousRecords[target]?.registry === key),
  ),
);
const activePreviousEstimates = Object.fromEntries(
  Object.entries(previousState.estimates ?? {}).filter(([registry]) =>
    targets.includes(registry) ||
    targets.some((target) => previousRecords[target]?.registry === registry),
  ),
);

await mkdir(stateDirectory, { recursive: true });
await writeFile(
  statePath,
  `${JSON.stringify(
    {
      checkedAt: now.toISOString(),
      records: { ...activePreviousRecords, ...updatedRecords },
      lastTelegramMessage,
      dailyStatus: {
        date: localDate,
        hadChanges: Boolean(dayHadChanges || hasChanges),
        hadErrors: Boolean(dayHadErrors || hasErrors),
        noChangeReportSent: Boolean(
          noChangeReportAlreadySent || sentDailyNoChangeReport,
        ),
      },
      estimates: {
        ...activePreviousEstimates,
        ...Object.fromEntries(
          results
            .filter(({ current, queue }) => current?.registry && queue)
            .map(({ current, queue }) => [current.registry, queue]),
        ),
      },
    },
    null,
    2,
  )}\n`,
);

console.log(dashboardMessage);
console.log("\n[Botones interactivos adjuntos]:", JSON.stringify(inlineKeyboard, null, 2));
