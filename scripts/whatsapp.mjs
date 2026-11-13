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
  const references = links.flat()
    .filter(({ url }) => /^https:\/\//.test(url))
    .map(({ text, url }) => `${text}: ${url}`);
  return references.length ? `${message}\n\n${references.join("\n")}` : message;
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
};

export const notifyWhatsApp = async (config, message, photos = []) => {
  for (const recipient of config.recipients) {
    await post("text", config.token, { to: recipient, body: message });
    for (const { screenshot, current } of photos) {
      await post("image", config.token, {
        to: recipient,
        media: `data:image/png;name=pagina-resaltada.png;base64,${Buffer.from(screenshot).toString("base64")}`,
        caption: `📄 ${current.entity} — página ${current.pdfVerification.page} de La Gaceta. Nombre resaltado en la imagen.`,
      });
    }
  }
};
