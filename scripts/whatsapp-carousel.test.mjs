import assert from "node:assert/strict";
import test from "node:test";
import { buildWhatsAppCarouselCards } from "./whatsapp-carousel.mjs";
import { notifyWhatsApp } from "./whatsapp.mjs";

test("crea cuatro tarjetas con los estados y el enlace oficial correspondiente", () => {
  const results = [
    { target: "2026-TP30799", current: { entity: "JESUS ENMANUEL HERNANDEZ GONZALEZ", registry: "2026-TP30799", status: "Redactado", receivedAt: "15/10/2026" }, queue: { pendingAhead: 3000, initialPending: 8000, publishedSinceRegistration: 5000, forecast: { range: { from: "2026-12-03", to: "2026-12-14" } } } },
    { target: "2026-TP29824", current: { entity: "LUIS EMILIO DIAZ GUTIERREZ", registry: "2026-TP29824", status: "Redactado" } },
    { target: "DANILO JOSE ACEVEDO FLORES", current: { entity: "DANILO JOSE ACEVEDO FLORES", isPending: true } },
    { target: "2026-TP23820", current: { entity: "NAYELIS DE LOS ANGELES SOTELO RODRIGUEZ", registry: "2026-TP23820", status: "Publicado", gazetteNumber: "195", publicationDate: "23/10/2026", pdfVerification: { status: "verified", page: 98, url: "https://www.lagaceta.gob.ni/la-gaceta-no-195/#page=98" } } },
  ];
  const cards = buildWhatsAppCarouselCards(results);
  assert.equal(cards.length, 4);
  assert.ok(cards.every(({ media, buttons }) => media.media.startsWith("data:image/png;") && buttons.length === 1));
  assert.match(cards[0].text, /JESUS.*\n.*2026-TP30799.*Redactado/);
  assert.match(cards[0].text, /TP anteriores pendientes: 3,000/);
  assert.match(cards[1].text, /LUIS EMILIO/);
  assert.match(cards[2].text, /Búsqueda activa por nombre/);
  assert.match(cards[3].text, /página 98 verificada/);
  assert.equal(cards[3].buttons[0].url, results[3].current.pdfVerification.url);
  assert.equal(cards[0].buttons[0].url, "https://www.lagaceta.gob.ni/consultas?t=1&search=2026-TP30799");
});

test("envía carrusel, captura y PDF, sin imagen resumen", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ message: { id: `message-${calls.length}` } }), { status: 200 });
  };
  try {
    const current = {
      registry: "2026-TP23820", entity: "NAYELIS DE LOS ANGELES SOTELO RODRIGUEZ",
      gazetteNumber: "195", publicationDate: "23/10/2026", pdfVerification: { page: 98 },
    };
    const cards = buildWhatsAppCarouselCards([
      { target: "2026-TP30799", current: { registry: "2026-TP30799", status: "Redactado" } },
      { target: "2026-TP23820", current: { ...current, status: "Publicado" } },
    ]);
    const state = await notifyWhatsApp(
      { token: "token", recipients: ["50586793204@s.whatsapp.net"] },
      "Estado normal", [{ current, screenshot: Buffer.from([1]), document: Buffer.from("%PDF-test") }],
      {}, [], cards,
    );
    assert.deepEqual(calls.map(({ url }) => url.split("/").at(-1)), ["carousel", "image", "document"]);
    const payload = JSON.parse(calls[0].options.body);
    assert.equal(payload.to, "50586793204@s.whatsapp.net");
    assert.equal(payload.cards.length, 2);
    assert.deepEqual(Object.values(state)[0].ids, ["message-1", "message-2", "message-3"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
