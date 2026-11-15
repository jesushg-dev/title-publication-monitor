import assert from "node:assert/strict";
import test from "node:test";
import { notifyTelegramDocument } from "./telegram.mjs";

test("adjunta el PDF completo a Telegram como respuesta al aviso", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response('{"ok":true,"result":{"message_id":321}}', { status: 200 });
  };
  try {
    const pdf = Buffer.from("%PDF-1.4\ncontenido de prueba");
    const sentId = await notifyTelegramDocument(pdf, {
      registry: "2026-TP23820", gazetteNumber: "195",
      entity: "NAYELIS DE LOS ANGELES SOTELO RODRIGUEZ",
      pdfVerification: { page: 98 },
    }, 123, { TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "456" });
    assert.equal(request.url, "https://api.telegram.org/bottoken/sendDocument");
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.body.get("chat_id"), "456");
    assert.deepEqual(JSON.parse(request.options.body.get("reply_parameters")), { message_id: 123 });
    assert.match(request.options.body.get("caption"), /NAYELIS.*página 98/);
    const attachment = request.options.body.get("document");
    assert.equal(attachment.name, "La-Gaceta-195-2026-TP23820.pdf");
    assert.equal(attachment.type, "application/pdf");
    assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), pdf);
    assert.equal(sentId, 321);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
