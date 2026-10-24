import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const defaultRegistries = [
  "2026-TP30799",
  "2026-TP29824",
  "DANILO JOSE ACEVEDO CISNERO",
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

const nicaraguaWeekday = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Managua",
  weekday: "short",
}).format(new Date());

if (
  nicaraguaWeekday === "Sun" &&
  process.env.GITHUB_EVENT_NAME === "schedule"
) {
  console.log(
    "Hoy es domingo (hora de Nicaragua). La Gaceta no opera ni publica actualizaciones; se omite la comprobación programada.",
  );
  process.exit(0);
}

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

const estimatePublication = (record) => {
  if (record.isPending || !record.registry) {
    return "⏳ <b>Estimación:</b> Aprox. 8-10 semanas a partir de su ingreso oficial";
  }

  if (record.status === "Publicado") {
    return "🎉 <b>Publicación:</b> ¡Ya publicado en La Gaceta oficial!";
  }

  const match = record.registry.match(/TP(\d+)/i);
  if (!match) return "⏱️ <b>Estimación:</b> En trámite";

  const registryNum = parseInt(match[1], 10);
  const currentFrontier = 23200; // Frente publicado en octubre 2026
  const diff = registryNum - currentFrontier;

  if (diff <= 0) {
    return "⚡ <b>Estimación:</b> En proceso de publicación inminente";
  }

  const weeks = Math.ceil(diff / 1500);
  const estDate = new Date();
  estDate.setDate(estDate.getDate() + weeks * 7);

  const monthsEs = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];
  const monthName = monthsEs[estDate.getMonth()];
  const year = estDate.getFullYear();
  const partOfMonth =
    estDate.getDate() <= 15 ? "Inicios/Mediados de" : "Finales de";

  return `⏱️ <b>Estimación:</b> ${partOfMonth} ${monthName} ${year} (~${diff.toLocaleString("es-NI")} en cola, ~${weeks} sem)`;
};

const loadPreviousRecords = async () => {
  try {
    const savedState = JSON.parse(await readFile(statePath, "utf8"));

    if (savedState.registry) return { [savedState.registry]: savedState };

    const records = savedState.records ?? {};
    delete records["2026-TP30796"];
    return records;
  } catch (error) {
    if (error.code === "ENOENT") return {};
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

  // If not found and target has "cisnero" or "cisneros", check alternative spelling
  if (!matchedCells && /cisneros?/i.test(target)) {
    const altTarget = /cisneros\b/i.test(target)
      ? target.replace(/cisneros\b/i, "cisnero")
      : target.replace(/cisnero\b/i, "cisneros");

    const altUrl = new URL("https://www.lagaceta.gob.ni/consultas");
    altUrl.searchParams.set("t", "1");
    altUrl.searchParams.set("search", altTarget);

    const altResponse = await fetch(altUrl, {
      headers: { "User-Agent": "title-publication-monitor/1.0" },
    });

    if (altResponse.ok) {
      const altHtml = await altResponse.text();
      const altRows = [
        ...altHtml.matchAll(/<tr class="consulta-row">([\s\S]*?)<\/tr>/gi),
      ];
      for (const m of altRows) {
        const cells = extractCells(m[0]);
        if (cells.length < 9) continue;
        const normalizedEntity = normalizeText(cells[3]);
        const altWords = normalizeText(altTarget)
          .split(" ")
          .filter((w) => w.length > 2);
        if (altWords.every((word) => normalizedEntity.includes(word))) {
          matchedCells = cells;
          break;
        }
      }
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
};

const previousRecords = await loadPreviousRecords();
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

const allChanges = results.flatMap((r) => r.changes);
const anyNewlyDiscovered = results.some((r) => r.isNewlyDiscovered);

let headerTitle = "🎓 <b>MONITOR DE TÍTULOS — LA GACETA</b>";
if (anyNewlyDiscovered) {
  headerTitle = "🎉 <b>¡NUEVO TÍTULO INGRESADO A LA GACETA!</b> 🎉\n\n" + headerTitle;
} else if (allChanges.length > 0) {
  headerTitle = "🚨 <b>¡CAMBIO DETECTADO EN TU TRÁMITE!</b> 🚨\n\n" + headerTitle;
}

const blocks = results.map((result) => {
  if (result.error) {
    return [
      `⚠️ <b>${escapeHtml(result.target)}</b>`,
      `<b>Error al consultar:</b> ${escapeHtml(result.error.message)}`,
    ].join("\n");
  }

  const { current, changes, isNewlyDiscovered } = result;

  if (current.isPending) {
    return [
      `👤 <b>${escapeHtml(current.entity || current.target)}</b>`,
      `📌 <b>Estado:</b> ⏳ <b>Pendiente de ingreso por la universidad</b>`,
      `📋 <b>Registro:</b> Pendiente de asignación`,
      `🔍 <i>Búsqueda activa por nombre</i>`,
      `${estimatePublication(current)}`,
    ].join("\n");
  }

  const lines = [
    `👤 <b>${escapeHtml(current.entity || "Titular")}</b>`,
    `📌 <b>Estado:</b> ${formatStatusBadge(current.status)}`,
    `📋 <b>Registro:</b> <code>${formatValue(current.registry)}</code>`,
    `📥 <b>Fecha de ingreso:</b> ${formatValue(current.receivedAt)}`,
    `${estimatePublication(current)}`,
  ];

  if (current.gazetteNumber !== "-") {
    lines.push(
      `📰 <b>Gaceta N.º:</b> ${formatValue(current.gazetteNumber)} | 📅 <b>Publicación:</b> ${formatValue(current.publicationDate)}`,
    );
  }

  if (isNewlyDiscovered) {
    lines.push("", "🎉 <b>¡Tu título ya fue ingresado al sistema de La Gaceta!</b>");
  } else if (changes.length > 0) {
    lines.push("", "🔄 <b>Cambios detectados:</b>", ...changes);
  }

  return lines.join("\n");
});

const footer =
  allChanges.length > 0 || anyNewlyDiscovered
    ? "Te mantendremos informado ante cualquier nueva actualización."
    : "🔔 <i>Sin cambios desde la última comprobación programada.</i>";

const dashboardMessage = [
  headerTitle,
  `📅 <i>${timeStr}</i>`,
  "───────────────────────────",
  blocks.join("\n───────────────────────────\n"),
  "───────────────────────────",
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

// Send Consolidated Dashboard via Telegram
if (process.env.TITLE_MONITOR_DRY_RUN !== "true") {
  await notifyTelegram(dashboardMessage, inlineKeyboard);
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

const cleanedPreviousRecords = { ...previousRecords };
delete cleanedPreviousRecords["2026-TP30796"];

await mkdir(stateDirectory, { recursive: true });
await writeFile(
  statePath,
  `${JSON.stringify(
    { records: { ...cleanedPreviousRecords, ...updatedRecords } },
    null,
    2,
  )}\n`,
);

console.log(dashboardMessage);
console.log("\n[Botones interactivos adjuntos]:", JSON.stringify(inlineKeyboard, null, 2));
