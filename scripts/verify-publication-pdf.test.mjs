import assert from "node:assert/strict";
import test from "node:test";
import { findUniqueNamePage, verifyPublicationPdf } from "./verify-publication-pdf.mjs";

test("solo acepta el nombre completo en una página única", () => {
  assert.equal(findUniqueNamePage(["OTRA PERSONA", "JESUS ENMANUEL HERNANDEZ GONZALEZ"],
    "Jesús Enmanuel Hernández González"), 2);
  assert.equal(findUniqueNamePage(["JESUS ENMANUEL HERNANDEZ GONZALEZ", "JESUS ENMANUEL HERNANDEZ GONZALEZ"],
    "Jesús Enmanuel Hernández González"), null);
  assert.equal(findUniqueNamePage(["JESUS HERNANDEZ GONZALEZ"],
    "Jesús Enmanuel Hernández González"), null);
});

const makePdf = (name) => {
  const stream = `BT /F1 12 Tf 72 720 Td (${name}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
};

test("lee el PDF y devuelve la página verificada", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(makePdf("JESUS ENMANUEL HERNANDEZ GONZALEZ"), {
    headers: { "content-type": "application/pdf" },
  });
  try {
    assert.deepEqual(await verifyPublicationPdf(
      "https://www.lagaceta.gob.ni/media/titulo.pdf",
      "Jesús Enmanuel Hernández González",
    ), {
      status: "verified",
      page: 1,
      url: "https://www.lagaceta.gob.ni/media/titulo.pdf#page=1",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
