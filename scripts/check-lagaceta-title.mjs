import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const defaultRegistries = [
  "2026-TP30799",
  "2026-TP29824",
  "Danilo Jose Acevedo Cisnero",
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

const loadPreviousRecords = async () => {
  try {
    const savedState = JSON.parse(await readFile(statePath, "utf8"));

    if (savedState.registry) return { [savedState.registry]: savedState };

    const records = savedState.records ?? {};
    // Clean up outdated or invalid registries
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

const createRecordMessage = (current, previous) => {
  if (current.isPending) {
    return [
      `¡Hola, <b>${escapeHtml(current.entity || current.target)}</b>! 👋`,
      "",
      "Hemos revisado tu título profesional en La Gaceta y <b>aún no aparece ingresado en el sistema</b>.",
      "",
      `🔍 <b>Búsqueda activa:</b> ${escapeHtml(current.target)}`,
      `📌 <b>Estado:</b> Pendiente de ingreso por la universidad`,
      `📋 <b>Registro oficial:</b> Pendiente de asignación`,
      "",
      "Te mantendremos informado en cada comprobación hasta que la universidad remita tus datos y La Gaceta le asigne tu número oficial de trámite.",
    ].join("\n");
  }

  if (previous?.isPending && !current.isPending) {
    return [
      `¡Hola, <b>${escapeHtml(current.entity || "Titular")}</b>! 👋`,
      "",
      "🎉 <b>¡EXCELENTES NOTICIAS! Tu título profesional ya fue ingresado a La Gaceta.</b>",
      "",
      `📋 <b>Registro asignado:</b> ${formatValue(current.registry)}`,
      `🗂️ <b>Tipo de trámite:</b> ${formatValue(current.processType)}`,
      `📥 <b>Fecha de ingreso:</b> ${formatValue(current.receivedAt)}`,
      `📌 <b>Estado:</b> ${formatValue(current.status)}`,
      `📰 <b>N.º de Gaceta:</b> ${formatValue(current.gazetteNumber)}`,
      `🔗 <b>Enlace:</b> ${formatValue(current.link)}`,
      `📅 <b>Fecha de publicación:</b> ${formatValue(current.publicationDate)}`,
      `📝 <b>Fecha de fe de errata:</b> ${formatValue(current.errataDate)}`,
      "",
      "A partir de este momento continuaremos monitoreando su avance hasta su publicación final.",
    ].join("\n");
  }

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

  const changes =
    previous && !previous.isPending
      ? trackedFields
          .filter(([field]) => previous[field] !== current[field])
          .map(
            ([field, label]) =>
              `• <b>${label}:</b> ${formatValue(previous[field])} → ${formatValue(current[field])}`,
          )
      : [];

  const statusText =
    changes.length > 0
      ? "se detectaron cambios"
      : "no hay cambios desde la última consulta";

  const lines = [
    `¡Hola, <b>${escapeHtml(current.entity || "Titular")}</b>! 👋`,
    "",
    `Hemos revisado tu título profesional y ${statusText}.`,
    "",
    `📋 <b>Registro:</b> ${formatValue(current.registry)}`,
    `🗂️ <b>Tipo de trámite:</b> ${formatValue(current.processType)}`,
    `📥 <b>Fecha de ingreso:</b> ${formatValue(current.receivedAt)}`,
    `📌 <b>Estado:</b> ${formatValue(current.status)}`,
    `📰 <b>N.º de Gaceta:</b> ${formatValue(current.gazetteNumber)}`,
    `🔗 <b>Enlace:</b> ${formatValue(current.link)}`,
    `📅 <b>Fecha de publicación:</b> ${formatValue(current.publicationDate)}`,
    `📝 <b>Fecha de fe de errata:</b> ${formatValue(current.errataDate)}`,
  ];

  if (changes.length > 0) {
    lines.push("", "🔄 <b>Detalle de los cambios:</b>", ...changes);
  }

  lines.push("", "Te mantendremos informado sobre cualquier actualización.");

  return lines.join("\n");
};

const createFailureMessage = (target, error) =>
  [
    `⚠️ <b>Consulta: ${escapeHtml(target)}</b>`,
    "",
    "No fue posible consultar el estado del título en La Gaceta en este momento.",
    `<b>Error:</b> ${escapeHtml(error.message)}`,
    "",
    "Te mantendremos informado en la próxima comprobación.",
  ].join("\n");

const notifyTelegram = async (message) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error(
      "Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en los secretos del repositorio.",
    );
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      }),
    },
  );

  if (!response.ok)
    throw new Error(`Telegram respondió HTTP ${response.status}.`);
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

    results.push({
      target,
      current,
      error: null,
    });
  } catch (error) {
    results.push({ target, current: null, error });
  }
}

const messages = results.map((result) => {
  if (result.current) {
    const prev =
      previousRecords[result.target] ??
      (result.current.registry
        ? previousRecords[result.current.registry]
        : null);
    return createRecordMessage(result.current, prev);
  }
  return createFailureMessage(result.target, result.error);
});

for (const msg of messages) {
  if (process.env.TITLE_MONITOR_DRY_RUN !== "true") {
    await notifyTelegram(msg);
    if (messages.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

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

console.log(messages.join("\n\n" + "=".repeat(40) + "\n\n"));
