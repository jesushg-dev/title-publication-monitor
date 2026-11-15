import { createHmac } from "node:crypto";

const apiBase = "https://gate.whapi.cloud/messages";

export const getWhatsAppConfig = (env = process.env) => {
  if (env.WHATSAPP_DISABLED?.toLowerCase() === "true") return null;
  const token = env.WHAPI_TOKEN?.trim();
  const recipients = [...new Set((env.WHAPI_RECIPIENTS ?? "")
    .split(",")
    .map((recipient) => recipient.trim())
    .filter(Boolean))];
  if (!token || recipients.length === 0) return null;
  return { token, recipients };
};

export const publicationDocumentKey = (current) =>
  [current.registry, current.gazetteNumber, current.publicationDate, current.link].join("|");

export const needsWhatsAppDocument = (config, previous, current) =>
  Boolean(config?.recipients.some((recipient) => {
    const fingerprint = createHmac("sha256", config.token).update(recipient).digest("hex");
    return !(previous[fingerprint]?.documentKeys ?? []).includes(publicationDocumentKey(current));
  }));

export const formatWhatsAppMessage = (html, links = []) => {
  const message = html
    .replace(/<b>(.*?)<\/b>/gs, "*$1*")
    .replace(/<i>(.*?)<\/i>/gs, "_$1_")
    .replace(/<code>(.*?)<\/code>/gs, "`$1`")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  const references = links.flat().filter(({ url }) => /^https:\/\//.test(url));
  const pages = references.filter(({ url }) => /#page=\d+$/.test(url));
  const fallback = pages.length === 1
    ? pages[0]
    : references.find(({ url }) => new URL(url).pathname === "/consultas") ?? references[0];
  return fallback ? `${message}\n\n🔗 Fuente oficial: ${fallback.url}` : message;
};

export const getWhatsAppButtons = (links = []) => {
  const references = links.flat().filter(({ url }) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && parsed.hostname === "www.lagaceta.gob.ni";
    } catch {
      return false;
    }
  });
  const consultation = references.filter(({ url }) => new URL(url).pathname === "/consultas");
  const pages = references.filter(({ url }) => /#page=\d+$/.test(url));
  const editions = references.filter(({ url }) =>
    new URL(url).pathname !== "/consultas" && !/#page=\d+$/.test(url));
  const selected = [...consultation, ...pages, ...editions]
    .filter(({ url }, index, entries) => entries.findIndex((entry) => entry.url === url) === index)
    .slice(0, 3);
  return selected.map(({ text, url }, index) => {
    const firstName = /\(([^)]+)\)/.exec(text)?.[1] ?? "";
    const page = /#page=(\d+)$/.exec(url)?.[1];
    const gazette = /Gaceta N\.º\s*(\d+)/i.exec(text)?.[1];
    const title = page
      ? `Página ${page} ${firstName}`
      : gazette
        ? `Gaceta ${gazette} ${firstName}`
        : "Consultar La Gaceta";
    return { type: "url", title: title.trim().slice(0, 25), id: `gaceta-link-${index + 1}`, url };
  });
};

const post = async (endpoint, token, body) => {
  const response = await fetch(`${apiBase}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Whapi respondió HTTP ${response.status} al enviar ${endpoint}.`);
  }
  const result = await response.json();
  if (!result.message?.id) throw new Error("Whapi no devolvió el ID del mensaje enviado.");
  return result.message.id;
};

const deleteMessage = async (token, id) => {
  const response = await fetch(`${apiBase}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Whapi respondió HTTP ${response.status} al borrar el mensaje anterior.`);
  const result = await response.json();
  if (result.success !== true) throw new Error("Whapi no confirmó el borrado del mensaje anterior.");
};

export const notifyWhatsApp = async (config, message, media = [], previous = {}, links = []) => {
  const sent = { ...previous };
  const buttons = getWhatsAppButtons(links);
  for (const recipient of config.recipients) {
    const fingerprint = createHmac("sha256", config.token).update(recipient).digest("hex");
    const ids = [await post("text", config.token, {
      to: recipient, body: message, no_link_preview: true,
    })];
    if (buttons.length > 0) {
      try {
        ids.push(await post("interactive", config.token, {
          to: recipient,
          type: "button",
          body: { text: "🔗 Accesos oficiales" },
          action: { buttons },
        }));
      } catch (error) {
        console.warn(`Whapi no pudo mostrar los botones; el enlace de respaldo sigue en el aviso: ${error.message}`);
      }
    }
    const previousImageIds = previous[fingerprint]?.imageMessageIds ?? {};
    const imageMessageIds = { ...previousImageIds };
    for (const { screenshot, current } of media) {
      if (!screenshot) continue;
      const id = await post("image", config.token, {
        to: recipient,
        media: `data:image/png;name=pagina-resaltada.png;base64,${Buffer.from(screenshot).toString("base64")}`,
        caption: `📄 ${current.entity} — página ${current.pdfVerification.page} de La Gaceta. Nombre resaltado en la imagen.`,
      });
      ids.push(id);
      imageMessageIds[publicationDocumentKey(current)] = id;
    }
    const documentKeys = [...(previous[fingerprint]?.documentKeys ?? [])];
    const previousDocumentIds = previous[fingerprint]?.documentMessageIds ?? {};
    const documentMessageIds = { ...previousDocumentIds };
    for (const { document, current } of media) {
      if (!document) continue;
      const key = publicationDocumentKey(current);
      const filename = `La-Gaceta-${String(current.gazetteNumber).replace(/[^a-zA-Z0-9-]/g, "_")}-${String(current.registry).replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
      const id = await post("document", config.token, {
        to: recipient,
        media: `data:application/pdf;name=${filename};base64,${Buffer.from(document).toString("base64")}`,
        filename,
        caption: `📄 La Gaceta N.º ${current.gazetteNumber} — ${current.entity}. Nombre en la página ${current.pdfVerification.page}.`,
      });
      ids.push(id);
      documentMessageIds[key] = id;
      if (!documentKeys.includes(key)) documentKeys.push(key);
    }
    const pendingDeleteIds = [];
    const previousIds = [
      ...(previous[fingerprint]?.pendingDeleteIds ?? []),
      ...(previous[fingerprint]?.ids ?? []),
    ];
    const retainedImageIds = Object.entries(previousImageIds)
      .filter(([key, id]) => imageMessageIds[key] === id)
      .map(([, id]) => id);
    const retainedDocumentIds = Object.entries(previousDocumentIds)
      .filter(([key, id]) => documentMessageIds[key] === id)
      .map(([, id]) => id);
    const retainedMediaIds = new Set([...retainedImageIds, ...retainedDocumentIds]);
    let deletedCount = 0;
    for (const id of new Set(previousIds)) {
      if (retainedMediaIds.has(id)) continue;
      try {
        await deleteMessage(config.token, id);
        deletedCount++;
      } catch (error) {
        pendingDeleteIds.push(id);
        console.warn(`No se pudo borrar el aviso anterior de WhatsApp: ${error.message}`);
      }
    }
    console.log(`WhatsApp: Whapi confirmó ${deletedCount} borrado(s); ${pendingDeleteIds.length} pendiente(s) de reintento.`);
    sent[fingerprint] = { ids: [...ids, ...retainedMediaIds], pendingDeleteIds, documentKeys, imageMessageIds, documentMessageIds, sentAt: new Date().toISOString() };
  }
  return sent;
};
