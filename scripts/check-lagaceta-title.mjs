import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const defaultRegistries = ["2026-TP30799", "2026-TP30796", "2026-TP29824"];
const registries = (
  process.env.TITLE_MONITOR_REGISTRIES ?? defaultRegistries.join(",")
)
  .split(",")
  .map((registry) => registry.trim())
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

    return savedState.records ?? {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
};

const fetchCurrentState = async (registry) => {
  const queryUrl = new URL("https://www.lagaceta.gob.ni/consultas");
  queryUrl.searchParams.set("t", "1");
  queryUrl.searchParams.set("search", registry);

  const response = await fetch(queryUrl, {
    headers: { "User-Agent": "title-publication-monitor/1.0" },
  });

  if (!response.ok) {
    throw new Error(`La Gaceta respondió HTTP ${response.status}.`);
  }

  const html = await response.text();
  const row = html.match(/<tr class="consulta-row">([\s\S]*?)<\/tr>/i)?.[0];

  if (!row) {
    throw new Error(
      "No fue posible confirmar la fila del registro en La Gaceta.",
    );
  }

  const cells = extractCells(row);

  if (cells.length < 9 || cells[0] !== registry) {
    throw new Error("La respuesta no contiene la fila esperada del registro.");
  }

  return {
    registry: cells[0],
    receivedAt: cells[1],
    processType: cells[2],
    entity: cells[3],
    gazetteNumber: cells[4],
    link: cells[5],
    publicationDate: cells[6],
    errataDate: cells[7],
    status: cells[8],
    checkedAt: new Date().toISOString(),
  };
};

const createRecordMessage = (current, previous) => {
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
  const changes = previous
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

const createFailureMessage = (registry, error) =>
  [
    `⚠️ <b>Registro ${escapeHtml(registry)}</b>`,
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

  if (!response.ok) throw new Error(`Telegram respondió HTTP ${response.status}.`);
};

const previousRecords = await loadPreviousRecords();
const results = [];

for (const registry of registries) {
  try {
    results.push({ current: await fetchCurrentState(registry), error: null });
  } catch (error) {
    results.push({ registry, current: null, error });
  }
}

const messages = results.map((result) =>
  result.current
    ? createRecordMessage(
        result.current,
        previousRecords[result.current.registry],
      )
    : createFailureMessage(result.registry, result.error),
);

for (const msg of messages) {
  if (process.env.TITLE_MONITOR_DRY_RUN !== "true") {
    await notifyTelegram(msg);
    if (messages.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

const updatedRecords = Object.fromEntries(
  results
    .filter((result) => result.current)
    .map(({ current }) => [current.registry, current]),
);

await mkdir(stateDirectory, { recursive: true });
await writeFile(
  statePath,
  `${JSON.stringify(
    { records: { ...previousRecords, ...updatedRecords } },
    null,
    2,
  )}\n`,
);

console.log(messages.join("\n\n" + "=".repeat(40) + "\n\n"));
