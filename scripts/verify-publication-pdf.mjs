import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const normalize = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-zA-Z0-9]+/g, " ")
  .toLowerCase()
  .trim()
  .replace(/\s+/g, " ");

export const findUniqueNamePage = (pages, name) => {
  const expected = ` ${normalize(name)} `;
  if (expected.length < 12) return null;
  const matches = [];
  for (let index = 0; index < pages.length; index++) {
    if (` ${normalize(pages[index])} `.includes(expected)) matches.push(index + 1);
  }
  return matches.length === 1 ? matches[0] : null;
};

const readLimitedPdf = async (response) => {
  const maxBytes = 50 * 1024 * 1024;
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("El PDF supera 50 MB.");
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
};

export const verifyPublicationPdf = async (link, name) => {
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" || url.hostname !== "www.lagaceta.gob.ni") {
      throw new Error("El enlace no pertenece a La Gaceta.");
    }
    const response = await fetch(url, {
      signal: AbortSignal.timeout(45_000),
      redirect: "manual",
    });
    if (!response.ok) throw new Error(`El PDF respondió HTTP ${response.status}.`);
    const data = await readLimitedPdf(response);
    if (Buffer.from(data.subarray(0, 5)).toString("ascii") !== "%PDF-") {
      throw new Error("El enlace no devolvió un PDF.");
    }
    const task = getDocument({ data, useSystemFonts: true, disableFontFace: true });
    try {
      const pdf = await task.promise;
      const pages = [];
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => item.str ?? "").join(" "));
        page.cleanup();
      }
      const page = findUniqueNamePage(pages, name);
      return page
        ? { status: "verified", page, url: `${url.toString().split("#")[0]}#page=${page}` }
        : { status: "unverified", page: null };
    } finally {
      await task.destroy();
    }
  } catch (error) {
    console.warn(`No se pudo verificar el PDF de ${name}: ${error.message}`);
    return { status: "unverified", page: null };
  }
};
