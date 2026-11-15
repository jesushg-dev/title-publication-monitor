import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { findUniqueNamePage, verifyPublicationPdf } from "./verify-publication-pdf.mjs";
import { makePdf } from "./pdf-test-fixture.mjs";

test("solo acepta el nombre completo en una página única", () => {
  assert.equal(findUniqueNamePage(["OTRA PERSONA", "JESUS ENMANUEL HERNANDEZ GONZALEZ"],
    "Jesús Enmanuel Hernández González"), 2);
  assert.equal(findUniqueNamePage(["JESUS ENMANUEL HERNANDEZ GONZALEZ", "JESUS ENMANUEL HERNANDEZ GONZALEZ"],
    "Jesús Enmanuel Hernández González"), null);
  assert.equal(findUniqueNamePage(["JESUS HERNANDEZ GONZALEZ"],
    "Jesús Enmanuel Hernández González"), null);
});

test("lee el PDF y devuelve la página verificada", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(makePdf("JESUS ENMANUEL HERNANDEZ GONZALEZ"), {
    headers: { "content-type": "application/pdf" },
  });
  try {
    const { screenshot, document, ...verification } = await verifyPublicationPdf(
      "https://www.lagaceta.gob.ni/media/titulo.pdf",
      "Jesús Enmanuel Hernández González",
    );
    assert.deepEqual(verification, {
      status: "verified",
      page: 1,
      url: "https://www.lagaceta.gob.ni/media/titulo.pdf#page=1",
    });
    assert.deepEqual(document, makePdf("JESUS ENMANUEL HERNANDEZ GONZALEZ"));
    assert.ok(Buffer.isBuffer(screenshot));
    const image = await loadImage(screenshot);
    assert.ok(image.width > 800 && image.height > 1000);
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let highlighted = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 180 && pixels[index + 1] > 150 && pixels[index + 2] < 150) highlighted++;
    }
    assert.ok(highlighted > 100, "El nombre debe estar resaltado en la página completa");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sigue la edición intermedia y extrae el PDF incorporado", async () => {
  const originalFetch = globalThis.fetch;
  const visited = [];
  const pdf = makePdf("NAYELIS DE LOS ANGELES SOTELO RODRIGUEZ");
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    visited.push(url.pathname);
    if (url.pathname === "/ediciones") {
      return new Response('<h1>23/10/2026</h1><a href="/la-gaceta-no-195-viernes-23-de-octubre-de-2026/">Edición</a>', {
        headers: { "content-type": "text/html" },
      });
    }
    return new Response(`<h1>La Gaceta - No. 195 Viernes 23 de Octubre de 2026</h1><h6>23/10/2026</h6><script>const pdfData = atob('${pdf.toString("base64")}'); const loadingTask = pdfjsLib.getDocument({ data: pdfData });</script>`, {
      headers: { "content-type": "text/html" },
    });
  };
  try {
    const result = await verifyPublicationPdf(
      "https://www.lagaceta.gob.ni/ediciones?search=23%2F10%2F2026",
      "Nayelis de los Angeles Sotelo Rodriguez",
      { gazetteNumber: "195", publicationDate: "23/10/2026" },
    );
    assert.deepEqual(visited, ["/ediciones", "/la-gaceta-no-195-viernes-23-de-octubre-de-2026/"]);
    assert.equal(result.status, "verified");
    assert.equal(result.page, 1);
    assert.match(result.url, /la-gaceta-no-195.*#page=1$/);
    assert.ok(Buffer.isBuffer(result.screenshot));
    assert.deepEqual(result.document, pdf);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
