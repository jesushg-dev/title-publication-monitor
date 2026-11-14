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

const readLimitedResponse = async (response, maxBytes) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("El PDF supera 50 MB.");
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
};

const officialUrl = (link, base) => {
  const url = new URL(link, base);
  if (url.protocol !== "https:" || url.hostname !== "www.lagaceta.gob.ni") {
    throw new Error("El enlace no pertenece a La Gaceta.");
  }
  return url;
};

const resolvePdf = async (link, edition = {}, depth = 0) => {
  if (depth > 2) throw new Error("La edición contiene demasiadas páginas intermedias.");
  const url = officialUrl(link);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(45_000),
    redirect: "manual",
  });
  if (!response.ok) throw new Error(`La Gaceta respondió HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") ?? "";
  const data = await readLimitedResponse(response, /pdf/i.test(contentType) ? 50 * 1024 * 1024 : 15 * 1024 * 1024);
  if (Buffer.from(data.subarray(0, 5)).toString("ascii") === "%PDF-") {
    return { data, url };
  }
  if (!/html/i.test(contentType)) throw new Error("El enlace no devolvió un PDF ni una página de edición.");
  const html = Buffer.from(data).toString("utf8");

  if (/\/ediciones\/?$/i.test(url.pathname)) {
    const number = String(edition.gazetteNumber ?? "").trim();
    if (!/^\d+$/.test(number) || !html.includes(edition.publicationDate ?? "")) {
      throw new Error("No se pudo identificar la edición oficial por número y fecha.");
    }
    const paths = [...html.matchAll(/href=["']([^"']+)["']/gi)]
      .map((match) => match[1])
      .filter((href) => new RegExp(`^/la-gaceta-no-${number}-`, "i").test(href));
    const unique = [...new Set(paths)];
    if (unique.length !== 1) throw new Error("La búsqueda no devolvió una edición única.");
    return resolvePdf(officialUrl(unique[0], url).toString(), edition, depth + 1);
  }

  if (edition.gazetteNumber && !new RegExp(`La Gaceta\\s*-\\s*No\\.\\s*${edition.gazetteNumber}\\b`, "i").test(html)) {
    throw new Error("La página no coincide con el número de Gaceta del registro.");
  }
  if (edition.publicationDate && !html.includes(edition.publicationDate)) {
    throw new Error("La página no coincide con la fecha de publicación del registro.");
  }
  const embedded = html.match(/const\s+pdfData\s*=\s*atob\(['"]([A-Za-z0-9+/=]+)['"]\)/);
  if (!embedded) throw new Error("No se encontró el PDF incorporado en la edición.");
  const pdfData = Buffer.from(embedded[1], "base64");
  if (pdfData.length > 50 * 1024 * 1024 || pdfData.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("El documento incorporado no es un PDF válido.");
  }
  return { data: new Uint8Array(pdfData), url };
};

export const verifyPublicationPdf = async (link, name, edition = {}) => {
  try {
    const { data, url } = await resolvePdf(link, edition);
    const document = Buffer.from(data);
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
        document,
      };
    } finally {
      await task.destroy();
    }
  } catch (error) {
    console.warn(`No se pudo verificar el PDF de ${name}: ${error.message}`);
    return { status: "unverified", page: null };
  }
};
