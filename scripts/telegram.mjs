export const notifyTelegramDocument = async (document, current, messageId, env = process.env) => {
  const filename = `La-Gaceta-${String(current.gazetteNumber).replace(/[^a-zA-Z0-9-]/g, "_")}-${String(current.registry).replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
  const form = new FormData();
  form.append("chat_id", env.TELEGRAM_CHAT_ID);
  form.append("caption", `📄 La Gaceta N.º ${current.gazetteNumber} — ${current.entity}. Nombre en la página ${current.pdfVerification.page}.`);
  form.append("reply_parameters", JSON.stringify({ message_id: messageId }));
  form.append("document", new Blob([document], { type: "application/pdf" }), filename);
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`,
    { method: "POST", body: form },
  );
  const sent = await response.json();
  if (!response.ok || !sent.ok || !Number.isInteger(sent.result?.message_id)) {
    throw new Error(`Telegram no pudo enviar el PDF (HTTP ${response.status}).`);
  }
  return sent.result.message_id;
};
