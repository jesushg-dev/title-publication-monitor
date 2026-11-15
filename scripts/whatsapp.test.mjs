import assert from "node:assert/strict";
import test from "node:test";
import { formatWhatsAppMessage, getWhatsAppButtons, getWhatsAppConfig, needsWhatsAppDocument, notifyWhatsApp } from "./whatsapp.mjs";

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

test("adapta el mensaje de Telegram y conserva un enlace de respaldo para WhatsApp", () => {
  const message = formatWhatsAppMessage(
    "👤 <b>JESUS &amp; LUIS</b>\n📋 <code>2026-TP30799</code>\n<i>Sin cambios</i>",
    [[{ text: "Consultar", url: "https://www.lagaceta.gob.ni/consultas" }]],
  );
  assert.match(message, /\*JESUS & LUIS\*/);
  assert.match(message, /`2026-TP30799`/);
  assert.match(message, /_Sin cambios_/);
  assert.match(message, /Fuente oficial: https:\/\/www\.lagaceta\.gob\.ni\/consultas/);
  assert.doesNotMatch(message, /<b>|<code>/);
});

test("prioriza hasta tres botones oficiales y deja un enlace directo a la página", () => {
  const links = [
    [{ text: "🔍 Consultar en La Gaceta", url: "https://www.lagaceta.gob.ni/consultas" }],
    [{ text: "📖 Leer Gaceta N.º 195 (NAYELIS)", url: "https://www.lagaceta.gob.ni/ediciones?search=23%2F10%2F2026" }],
    [{ text: "📄 Abrir página 98 (NAYELIS)", url: "https://www.lagaceta.gob.ni/la-gaceta-no-195/#page=98" }],
    [{ text: "Externo", url: "https://example.com/" }],
  ];
  const buttons = getWhatsAppButtons(links);
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map(({ title }) => title), [
    "Consultar La Gaceta", "Página 98 NAYELIS", "Gaceta 195 NAYELIS",
  ]);
  assert.ok(buttons.every(({ type, title, url }) =>
    type === "url" && title.length <= 25 && url.startsWith("https://www.lagaceta.gob.ni/")));
  const message = formatWhatsAppMessage("<b>Publicado</b>", links);
  assert.match(message, /Fuente oficial: https:\/\/www\.lagaceta\.gob\.ni\/la-gaceta-no-195\/#page=98/);
  assert.doesNotMatch(message, /example\.com|ediciones\?/);
});

test("envía texto e imagen a cada destinatario mediante Whapi", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "DELETE") return new Response('{"success":true}', { status: 200 });
    return new Response(JSON.stringify({ message: { id: `message-${calls.length}` } }), { status: 200 });
  };
  try {
    const sent = await notifyWhatsApp(
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
      { to: "50588888888", body: "*Aviso*", no_link_preview: true },
      { to: "50577777777", body: "*Aviso*", no_link_preview: true },
    ]);
    const image = JSON.parse(calls[1].options.body);
    assert.match(image.media, /^data:image\/png;name=pagina-resaltada\.png;base64,AQID$/);
    assert.match(image.caption, /PERSONA DE PRUEBA — página 2/);
    assert.equal(Object.keys(sent).length, 2);
    assert.deepEqual(Object.values(sent).map(({ ids }) => ids), [["message-1", "message-2"], ["message-3", "message-4"]]);

    calls.length = 0;
    await notifyWhatsApp(
      { token: "token-de-prueba", recipients: ["50588888888", "50577777777"] },
      "*Nuevo aviso*",
      [],
      sent,
    );
    assert.deepEqual(calls.filter(({ options }) => options.method === "DELETE").map(({ url }) => url), [
      "https://gate.whapi.cloud/messages/message-1",
      "https://gate.whapi.cloud/messages/message-3",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("si Whapi rechaza los botones, conserva el aviso con enlace sin vista previa", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const calls = [];
  const warnings = [];
  console.warn = (message) => warnings.push(message);
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/interactive")) return new Response("rechazado", { status: 400 });
    return new Response('{"message":{"id":"text-1"}}', { status: 200 });
  };
  try {
    const links = [[{ text: "Consultar", url: "https://www.lagaceta.gob.ni/consultas" }]];
    const message = formatWhatsAppMessage("<b>Estado consultado</b>", links);
    const sent = await notifyWhatsApp(
      { token: "token", recipients: ["50586793204@s.whatsapp.net"] },
      message, [], {}, links,
    );
    assert.deepEqual(calls.map(({ url }) => url.split("/").at(-1)), ["text", "interactive"]);
    const textPayload = JSON.parse(calls[0].options.body);
    assert.equal(textPayload.no_link_preview, true);
    assert.match(textPayload.body, /Fuente oficial: https:\/\/www\.lagaceta\.gob\.ni\/consultas/);
    const buttonPayload = JSON.parse(calls[1].options.body);
    assert.equal(buttonPayload.type, "button");
    assert.deepEqual(buttonPayload.action.buttons.map(({ type }) => type), ["url"]);
    assert.deepEqual(Object.values(sent)[0].ids, ["text-1"]);
    assert.match(warnings[0], /enlace de respaldo/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test("conserva los ID cuyo borrado no confirmó Whapi y los reintenta", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const calls = [];
  console.warn = () => {};
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options.method });
    if (options.method === "DELETE") {
      return new Response('{"success":false}', { status: 200 });
    }
    return new Response('{"message":{"id":"new-message-1"}}', { status: 200 });
  };
  try {
    const config = { token: "token", recipients: ["120363426827575325@g.us"] };
    const first = await notifyWhatsApp(config, "Aviso", [], {});
    const second = await notifyWhatsApp(config, "Otro aviso", [], first);
    const entry = Object.values(second)[0];
    assert.deepEqual(entry.pendingDeleteIds, ["new-message-1"]);
    await notifyWhatsApp(config, "Tercer aviso", [], second);
    assert.equal(calls.filter(({ method }) => method === "DELETE").length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test("reenvía imagen y PDF con cada aviso y borra los adjuntos anteriores", async () => {
  const calls = [];
  let serial = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "DELETE") return new Response('{"success":true}', { status: 200 });
    return new Response(JSON.stringify({ message: { id: `message-${++serial}` } }), { status: 200 });
  };
  const config = { token: "token", recipients: ["120363426827575325@g.us"] };
  const current = {
    registry: "2026-TP23820", gazetteNumber: "195", publicationDate: "23/10/2026",
    link: "https://www.lagaceta.gob.ni/ediciones?search=23%2F10%2F2026",
    entity: "NAYELIS DE LOS ANGELES SOTELO RODRIGUEZ", pdfVerification: { page: 98 },
  };
  try {
    assert.equal(needsWhatsAppDocument(config, {}, current), true);
    const first = await notifyWhatsApp(config, "Primer aviso", [{
      current, document: Buffer.from("%PDF-test"), screenshot: Buffer.from([1, 2, 3]),
    }]);
    assert.deepEqual(calls.slice(0, 3).map(({ url }) => url.split("/").at(-1)), ["text", "image", "document"]);
    const payload = JSON.parse(calls[2].options.body);
    assert.equal(payload.to, config.recipients[0]);
    assert.match(payload.media, /^data:application\/pdf;name=La-Gaceta-195-2026-TP23820\.pdf;base64,/);
    assert.equal(payload.filename, "La-Gaceta-195-2026-TP23820.pdf");
    assert.match(payload.caption, /NAYELIS.*página 98/);
    assert.equal(needsWhatsAppDocument(config, first, current), false);
    assert.deepEqual(Object.values(first)[0].ids, ["message-1", "message-2", "message-3"]);

    calls.length = 0;
    const second = await notifyWhatsApp(config, "Segundo aviso", [{
      current, document: Buffer.from("%PDF-test"), screenshot: Buffer.from([1, 2, 3]),
    }], first);
    assert.deepEqual(calls.filter(({ options }) => options.method === "POST")
      .map(({ url }) => url.split("/").at(-1)), ["text", "image", "document"]);
    assert.deepEqual(calls.filter(({ options }) => options.method === "DELETE")
      .map(({ url }) => url.split("/").at(-1)), ["message-1", "message-2", "message-3"]);
    assert.equal(needsWhatsAppDocument(config, second, current), false);
    assert.deepEqual(Object.values(second)[0].ids, ["message-4", "message-5", "message-6"]);

    calls.length = 0;
    const third = await notifyWhatsApp(config, "Tercer aviso", [], second);
    assert.deepEqual(calls.filter(({ options }) => options.method === "DELETE")
      .map(({ url }) => url.split("/").at(-1)), ["message-4"]);
    assert.deepEqual(Object.values(third)[0].ids, ["message-7", "message-5", "message-6"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
