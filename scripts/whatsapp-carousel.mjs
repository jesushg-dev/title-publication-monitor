import { createCanvas } from "@napi-rs/canvas";

const consultationUrl = "https://www.lagaceta.gob.ni/consultas";

const formatDate = (date) => date && new Intl.DateTimeFormat("es-NI", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
}).format(new Date(`${date}T00:00:00Z`));

const wrap = (context, text, maxWidth) => {
  const lines = [""];
  for (const word of text.split(/\s+/)) {
    const current = lines.at(-1);
    const next = current ? `${current} ${word}` : word;
    if (context.measureText(next).width > maxWidth && current) lines.push(word);
    else lines[lines.length - 1] = next;
  }
  return lines.slice(0, 3);
};

const renderCardImage = (name, registry, status) => {
  const canvas = createCanvas(720, 420);
  const context = canvas.getContext("2d");
  context.fillStyle = "#10213b";
  context.fillRect(0, 0, 720, 420);
  context.fillStyle = "#64d8bd";
  context.fillRect(0, 0, 720, 12);
  context.font = "bold 24px sans-serif";
  context.fillText("MONITOR DE TÍTULOS · LA GACETA", 40, 65);
  context.fillStyle = "#ffffff";
  context.font = "bold 37px sans-serif";
  const nameLines = wrap(context, name, 640);
  nameLines.forEach((line, index) => context.fillText(line, 40, 150 + index * 45));
  context.fillStyle = "#aed2e1";
  context.font = "28px sans-serif";
  context.fillText(registry, 40, 315);
  context.fillStyle = "#64d8bd";
  context.font = "bold 27px sans-serif";
  context.fillText(status, 40, 370);
  return `data:image/png;name=tarjeta-titulo.png;base64,${canvas.toBuffer("image/png").toString("base64")}`;
};

export const buildWhatsAppCarouselCards = (results) => {
  if (results.length < 2 || results.length > 10) {
    throw new Error("El carrusel de Whapi requiere entre 2 y 10 títulos.");
  }
  return results.map(({ target, current, queue, error }, index) => {
    const name = current?.entity || target;
    const registry = current?.registry || "Sin registro asignado";
    const status = error ? "Consulta no disponible" : current?.isPending
      ? "Pendiente de ingreso" : current?.status || "Sin confirmar";
    const lines = [`*${name}*`, `📋 ${registry} · ${status}`];
    if (error) {
      lines.push("⚠️ No se pudo confirmar el estado en esta consulta.");
    } else if (/^publicado$/i.test(status) || current?.pdfVerification?.status === "verified") {
      lines.push(`📰 Gaceta N.º ${current.gazetteNumber || "pendiente"}${current.pdfVerification?.status === "verified" ? ` · página ${current.pdfVerification.page} verificada` : " · página sin verificar"}`);
      lines.push(`📅 Ingreso: ${current.receivedAt || "pendiente"} · Publicación: ${current.publicationDate || "pendiente"}`);
    } else if (current?.isPending) {
      lines.push("🔍 Búsqueda activa por nombre.");
    } else {
      lines.push(`📥 Ingreso: ${current.receivedAt || "pendiente"}`);
      if (Number.isFinite(queue?.pendingAhead)) lines.push(`⏳ TP anteriores pendientes: ${queue.pendingAhead.toLocaleString("es-NI")}`);
      const { from, to } = queue?.forecast?.range ?? {};
      if (from && to) lines.push(`🗓️ Estimación: ${formatDate(from)} – ${formatDate(to)}`);
      if (queue?.initialPending && Number.isFinite(queue.publishedSinceRegistration)) {
        const percent = Math.round(queue.publishedSinceRegistration / queue.initialPending * 100);
        lines.push(`📈 Avance desde ingreso: ≈${percent}%`);
      }
    }
    const pageUrl = current?.pdfVerification?.status === "verified"
      ? current.pdfVerification.url : null;
    const searchUrl = current?.registry
      ? `${consultationUrl}?t=1&search=${encodeURIComponent(current.registry)}` : consultationUrl;
    const url = pageUrl || searchUrl;
    return {
      id: `titulo-${index + 1}`,
      media: { media: renderCardImage(name, registry, status) },
      text: lines.join("\n"),
      buttons: [{
        type: "url",
        title: pageUrl ? `Abrir página ${current.pdfVerification.page}` : "Consultar La Gaceta",
        id: `consultar-titulo-${index + 1}`,
        url,
      }],
    };
  });
};

