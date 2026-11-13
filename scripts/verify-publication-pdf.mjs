import { getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

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

const matchingItems = (items, name) => {
  let combined = "";
  const segments = [];
  for (const item of items) {
    const text = normalize(item.str);
    if (!text) continue;
    if (combined) combined += " ";
    const start = combined.length;
    combined += text;
    segments.push({ item, start, end: combined.length });
  }
  const expected = normalize(name);
  const start = combined.indexOf(expected);
  if (start < 0 || combined.indexOf(expected, start + 1) >= 0) return [];
  const end = start + expected.length;
  return segments.filter((segment) => segment.start < end && segment.end > start)
    .map(({ item }) => item);
};

const renderHighlightedPage = async (page, name) => {
  const viewport = page.getViewport({ scale: 1.5 });
  const items = (await page.getTextContent()).items;
  const matches = matchingItems(items, name);
  if (!matches.length) return null;
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  context.save();
  context.globalCompositeOperation = "multiply";
  context.fillStyle = "rgba(255, 235, 50, 0.55)";
  for (const item of matches) {
    const transform = Util.transform(viewport.transform, item.transform);
    const height = Math.max(8, Math.abs(item.height * viewport.scale));
    context.fillRect(transform[4] - 3, transform[5] - height - 3,
      Math.max(12, item.width * viewport.scale) + 6, height + 6);
  }
  context.restore();
  return canvas.toBuffer("image/png");
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
      if (!page) return { status: "unverified", page: null };
      let screenshot = null;
      try {
        screenshot = await renderHighlightedPage(await pdf.getPage(page), name);
      } catch (error) {
        console.warn(`No se pudo crear la imagen de la página ${page}: ${error.message}`);
      }
      return {
        status: "verified",
        page,
        url: `${url.toString().split("#")[0]}#page=${page}`,
        screenshot,
      };
    } finally {
      await task.destroy();
    }
  } catch (error) {
    console.warn(`No se pudo verificar el PDF de ${name}: ${error.message}`);
    return { status: "unverified", page: null };
  }
};
