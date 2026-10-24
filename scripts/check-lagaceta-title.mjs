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
  [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
    decodeHtml(match[1]),
  );

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
    ["errataDate", "Fecha de errata"],
  ];
  const changes = previous
    ? trackedFields
        .filter(([field]) => previous[field] !== current[field])
        .map(
          ([field, label]) =>
            `• ${label}: ${previous[field] || "-"} → ${current[field] || "-"}`,
        )
    : [];

  const details = [
    `Registro: ${current.registry}`,
    `Fecha de ingreso: ${current.receivedAt}`,
    `Tipo de trámite: ${current.processType}`,
    `Titular: ${current.entity}`,
    `Estado: ${current.status}`,
    `N.º de Gaceta: ${current.gazetteNumber}`,
    `Enlace: ${current.link}`,
    `Fecha de publicación: ${current.publicationDate}`,
    `Fe de errata: ${current.errataDate}`,
  ];

  return [
    changes.length > 0
      ? "Cambio detectado:"
      : previous
        ? "Sin cambios."
        : "Primera comprobación.",
    ...changes,
    ...details,
  ].join("\n");
};

const createFailureMessage = (registry, error) =>
  `${registry}: no fue posible confirmar el estado. ${error.message}`;

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
      body: JSON.stringify({ chat_id: chatId, text: message }),
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

const message = [
  "🔔 Estado de títulos profesionales",
  ...results.flatMap((result) => [
    "",
    result.current
      ? createRecordMessage(
          result.current,
          previousRecords[result.current.registry],
        )
      : createFailureMessage(result.registry, result.error),
  ]),
].join("\n");

if (process.env.TITLE_MONITOR_DRY_RUN !== "true") {
  await notifyTelegram(message);
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

console.log(message);
