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

const MONTHS_ES = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
};

const extractEditionMetadata = (html, url) => {
  const numberMatch =
    html.match(/La Gaceta\s*-\s*No\.\s*(\d+)\b/i) ??
    url.pathname.match(/la-gaceta-no-(\d+)-/i);
  const dateMatch =
    html.match(/\b(\d{2}\/\d{2}\/\d{4})\b/) ??
    (() => {
      const m = html.match(
        /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})\b/i,
      );
      if (!m) return null;
      const day = m[1].padStart(2, "0");
      const month = MONTHS_ES[m[2].toLowerCase()];
      return [null, `${day}/${month}/${m[3]}`];
    })();
  return {
    gazetteNumber: numberMatch?.[1] ?? null,
    publicationDate: dateMatch?.[1] ?? null,
  };
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
    return {
      data,
      url,
      metadata: {
        gazetteNumber: edition.gazetteNumber ?? null,
        publicationDate: edition.publicationDate ?? null,
      },
    };
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
  return {
    data: new Uint8Array(pdfData),
    url,
    metadata: extractEditionMetadata(html, url),
  };
};

const openPdfDocument = async (link, edition = {}) => {
  const { data, url, metadata } = await resolvePdf(link, edition);
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
    return {
      url,
      document,
      metadata,
      verify: async (name) => {
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
      },
      destroy: () => task.destroy(),
    };
  } catch (error) {
    await task.destroy();
    throw error;
  }
};

export const openLatestEditionPdf = async () => {
  try {
    const editionsUrl = new URL("https://www.lagaceta.gob.ni/ediciones");
    const response = await fetch(editionsUrl, {
      signal: AbortSignal.timeout(30_000),
      redirect: "manual",
    });
    if (!response.ok) throw new Error(`La Gaceta respondió HTTP ${response.status}.`);
    const html = await response.text();
    const latestMatch = html.match(/href=["'](\/la-gaceta-no-\d+-[^"']+)["']/i);
    if (!latestMatch) throw new Error("No se encontró ninguna edición reciente en La Gaceta.");
    const latestUrl = officialUrl(latestMatch[1], editionsUrl).toString();
    return await openPdfDocument(latestUrl);
  } catch (error) {
    console.warn(`No se pudo abrir la edición actual de La Gaceta: ${error.message}`);
    return null;
  }
};

export const verifyPublicationPdf = async (link, name, edition = {}) => {
  try {
    const doc = await openPdfDocument(link, edition);
    try {
      return await doc.verify(name);
    } finally {
      await doc.destroy();
    }
  } catch (error) {
    console.warn(`No se pudo verificar el PDF de ${name}: ${error.message}`);
    return { status: "unverified", page: null };
  }
};
