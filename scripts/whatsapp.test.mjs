import assert from "node:assert/strict";
import test from "node:test";
import { formatWhatsAppMessage, getWhatsAppConfig, notifyWhatsApp } from "./whatsapp.mjs";

test("WhatsApp se habilita solo con token, destinatarios y sin flag", () => {
  const configured = {
    WHAPI_TOKEN: "  token-de-prueba  ",
    WHAPI_RECIPIENTS: "50588888888, 50577777777,50588888888",
  };
  assert.deepEqual(getWhatsAppConfig(configured), {
    token: "token-de-prueba",
    recipients: ["50588888888", "50577777777"],
  });
  assert.equal(getWhatsAppConfig({ ...configured, WHATSAPP_DISABLED: "TRUE" }), null);
  assert.equal(getWhatsAppConfig({ WHAPI_RECIPIENTS: configured.WHAPI_RECIPIENTS }), null);
  assert.equal(getWhatsAppConfig({ WHAPI_TOKEN: configured.WHAPI_TOKEN }), null);
});

test("adapta el mensaje de Telegram y añade enlaces para WhatsApp", () => {
  const message = formatWhatsAppMessage(
    "👤 <b>JESUS &amp; LUIS</b>\n📋 <code>2026-TP30799</code>\n<i>Sin cambios</i>",
    [[{ text: "Consultar", url: "https://www.lagaceta.gob.ni/consultas" }]],
  );
  assert.match(message, /\*JESUS & LUIS\*/);
  assert.match(message, /`2026-TP30799`/);
  assert.match(message, /_Sin cambios_/);
  assert.match(message, /Consultar: https:\/\/www\.lagaceta\.gob\.ni\/consultas/);
  assert.doesNotMatch(message, /<b>|<code>/);
});

test("envía texto e imagen a cada destinatario mediante Whapi", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response("{}", { status: 200 });
  };
  try {
    await notifyWhatsApp(
      { token: "token-de-prueba", recipients: ["50588888888", "50577777777"] },
      "*Aviso*",
      [{
        screenshot: Buffer.from([1, 2, 3]),
        current: { entity: "PERSONA DE PRUEBA", pdfVerification: { page: 2 } },
      }],
    );
    assert.equal(calls.length, 4);
    assert.deepEqual(calls.map(({ url }) => url), [
      "https://gate.whapi.cloud/messages/text",
      "https://gate.whapi.cloud/messages/image",
      "https://gate.whapi.cloud/messages/text",
      "https://gate.whapi.cloud/messages/image",
    ]);
    assert.ok(calls.every(({ options }) => options.headers.Authorization === "Bearer token-de-prueba"));
    assert.deepEqual(calls.filter(({ url }) => url.endsWith("/text")).map(({ options }) => JSON.parse(options.body)), [
      { to: "50588888888", body: "*Aviso*" },
      { to: "50577777777", body: "*Aviso*" },
    ]);
    const image = JSON.parse(calls[1].options.body);
    assert.match(image.media, /^data:image\/png;name=pagina-resaltada\.png;base64,AQID$/);
    assert.match(image.caption, /PERSONA DE PRUEBA — página 2/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
