import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import type { JSONContent } from "@tiptap/core";
import JSZip from "jszip";

/**
 * .docx is Scribe's native format.
 *
 * Saving converts the document (Tiptap JSON) to real Word content, and also
 * embeds the exact Scribe JSON as a custom XML part. Word ignores that part,
 * while Scribe reads it back on open, so nothing Word can't express is lost.
 * The part records a hash of word/document.xml: if the file has since been
 * edited in Word (or any other app), the hash won't match and Scribe imports
 * the Word content instead of the stale copy.
 *
 * Pure TypeScript, so it runs in the app and in Node (scripts/test-docx-export.mjs).
 */

const SCRIBE_NS = "https://scribe.app/ns/document/1";
const SCRIBE_PART = "customXml/scribe.xml";
const MEDIA_SCHEME = "scribe-media:"; // image src placeholder → n-th embedded Word image

const FONT = "Charter"; // matches --font-doc; Word substitutes a similar serif if missing
const BODY_HALF_PT = 26; // 13pt, the editor's 17px body text
const LINE = 396; // 1.65 line height, in 240ths of a line
const AFTER = 200; // ~0.8em paragraph spacing, in twips
const CONTENT_WIDTH_PX = 624; // 6.5in at 96dpi: Letter with 1in margins
const MUTED = "7A7A76";
const TEXT_WIDTH_TWIPS = 9360; // 6.5in

type Mark = NonNullable<JSONContent["marks"]>[number];
type Ctx = { listLevel: number; quote: boolean };
/** ordered: numbered-list counter; embedded: image nodes that made it into the .docx, in document order. */
type State = { ordered: number; embedded: Map<JSONContent, number> };

/* ---------- Inline content ---------- */

/** "#ff0000" / "rgb(255, 0, 0)" → "FF0000"; anything else → undefined. */
function hex(color: unknown): string | undefined {
  if (typeof color !== "string") return undefined;
  const c = color.trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
    return h.toUpperCase();
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
  if (m) return m.slice(1, 4).map((n) => Math.min(255, +n).toString(16).padStart(2, "0")).join("").toUpperCase();
  return undefined;
}

/** "14pt" / "18px" → half-points. */
function halfPoints(size: unknown): number | undefined {
  if (typeof size !== "string") return undefined;
  const n = parseFloat(size);
  if (!Number.isFinite(n)) return undefined;
  const pt = size.endsWith("px") ? n * 0.75 : n;
  return Math.round(pt * 2);
}

const firstFont = (family: unknown) =>
  typeof family === "string" ? family.split(",")[0].trim().replace(/^["']|["']$/g, "") || undefined : undefined;

function runOptions(marks: Mark[] = [], ctx: Ctx): IRunOptions {
  const o: Record<string, unknown> = {};
  for (const m of marks) {
    const a = m.attrs ?? {};
    switch (m.type) {
      case "bold": o.bold = true; break;
      case "italic": o.italics = true; break;
      case "underline": o.underline = {}; break;
      case "strike": o.strike = true; break;
      case "code": o.font = "Courier New"; break;
      case "superscript": o.superScript = true; break;
      case "subscript": o.subScript = true; break;
      case "highlight": {
        const fill = hex(a.color) ?? "FFF2CC";
        o.shading = { type: ShadingType.CLEAR, fill, color: "auto" };
        break;
      }
      case "textStyle": {
        if (hex(a.color)) o.color = hex(a.color);
        if (firstFont(a.fontFamily)) o.font = firstFont(a.fontFamily);
        if (halfPoints(a.fontSize)) o.size = halfPoints(a.fontSize);
        break;
      }
    }
  }
  if (ctx.quote && !o.color) o.color = MUTED;
  return o as IRunOptions;
}

function inlines(nodes: JSONContent[] = [], ctx: Ctx): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes) {
    if (n.type === "hardBreak") { out.push(new TextRun({ text: "", break: 1 })); continue; }
    if (n.type !== "text" || !n.text) continue;
    const opts = runOptions(n.marks, ctx);
    const link = n.marks?.find((m) => m.type === "link")?.attrs?.href as string | undefined;
    if (link) {
      out.push(new ExternalHyperlink({
        link,
        children: [new TextRun({ ...opts, text: n.text, style: "Hyperlink" })],
      }));
    } else {
      out.push(new TextRun({ ...opts, text: n.text }));
    }
  }
  return out;
}

const ALIGN: Record<string, IParagraphOptions["alignment"]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

/* ---------- Images ---------- */

type Img = { data: Uint8Array; type: "png" | "jpg" | "gif"; width: number; height: number };

function dataUrlBytes(src: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m) return null;
  const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return { mime: m[1].toLowerCase(), bytes };
}

/** Pixel size from the file header (PNG, GIF, JPEG). */
function imageSize(b: Uint8Array, type: Img["type"]): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (type === "png") return { width: dv.getUint32(16), height: dv.getUint32(20) };
    if (type === "gif") return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    // JPEG: walk segments to a start-of-frame marker.
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      }
      i += 2 + len;
    }
  } catch { /* truncated file */ }
  return null;
}

/** Word can't embed WebP or SVG directly: redraw those as PNG (browser only). */
async function toPng(src: string): Promise<Uint8Array | null> {
  if (typeof document === "undefined") return null;
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 600;
  canvas.height = img.naturalHeight || 400;
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

async function loadImage(src: string): Promise<Img | null> {
  let parsed = dataUrlBytes(src);
  if (!parsed && /^https?:/i.test(src)) {
    try {
      const res = await fetch(src);
      parsed = { mime: res.headers.get("content-type") ?? "", bytes: new Uint8Array(await res.arrayBuffer()) };
    } catch { return null; }
  }
  if (!parsed) return null;
  let { bytes } = parsed;
  let type: Img["type"] | null =
    parsed.mime.includes("png") ? "png" : parsed.mime.includes("jpeg") || parsed.mime.includes("jpg") ? "jpg"
    : parsed.mime.includes("gif") ? "gif" : null;
  if (!type) {
    const png = await toPng(src).catch(() => null);
    if (!png) return null;
    bytes = png;
    type = "png";
  }
  const size = imageSize(bytes, type) ?? { width: 400, height: 300 };
  const scale = Math.min(1, CONTENT_WIDTH_PX / size.width);
  return { data: bytes, type, width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

/* ---------- Blocks ---------- */

type Block = Paragraph | Table;

async function blocks(nodes: JSONContent[] = [], ctx: Ctx, state: State): Promise<Block[]> {
  const out: Block[] = [];
  for (const n of nodes) out.push(...(await block(n, ctx, state)));
  return out;
}

async function block(n: JSONContent, ctx: Ctx, state: State): Promise<Block[]> {
  const align = ALIGN[(n.attrs?.textAlign as string) ?? ""];
  const quoteStyle: Partial<IParagraphOptions> = ctx.quote
    ? { indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: "E4E2DD", space: 12 } } }
    : {};

  switch (n.type) {
    case "paragraph":
      return [new Paragraph({ children: inlines(n.content, ctx), alignment: align, ...quoteStyle })];

    case "heading": {
      const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
        HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][((n.attrs?.level as number) ?? 1) - 1];
      return [new Paragraph({ heading: level, children: inlines(n.content, ctx), alignment: align })];
    }

    case "blockquote":
      return blocks(n.content, { ...ctx, quote: true }, state);

    case "bulletList":
    case "orderedList": {
      const ordered = n.type === "orderedList";
      // Each numbered list restarts at 1 (its own numbering instance).
      const instance = ordered ? ++state.ordered : 0;
      const out: Block[] = [];
      for (const item of n.content ?? []) {
        let first = true;
        for (const child of item.content ?? []) {
          if (child.type === "bulletList" || child.type === "orderedList") {
            out.push(...(await block(child, { ...ctx, listLevel: ctx.listLevel + 1 }, state)));
            continue;
          }
          if (child.type !== "paragraph" && child.type !== "heading") {
            out.push(...(await block(child, ctx, state)));
            continue;
          }
          out.push(new Paragraph({
            children: inlines(child.content, ctx),
            alignment: ALIGN[(child.attrs?.textAlign as string) ?? ""],
            ...(first
              ? { numbering: { reference: ordered ? "numbers" : "bullets", level: Math.min(ctx.listLevel, 8), instance } }
              : { indent: { left: 720 * (ctx.listLevel + 1) } }),
            spacing: { after: 60 },
          }));
          first = false;
        }
      }
      return out;
    }

    case "codeBlock": {
      const lines = (n.content ?? []).map((t) => t.text ?? "").join("").split("\n");
      return [new Paragraph({
        shading: { type: ShadingType.CLEAR, fill: "F3F3F3", color: "auto" },
        spacing: { line: 276 },
        children: lines.flatMap((text, i) => [
          ...(i ? [new TextRun({ text: "", break: 1 })] : []),
          new TextRun({ text, font: "Courier New", size: 20 }),
        ]),
      })];
    }

    case "horizontalRule":
      return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 } }, children: [] })];

    case "image": {
      const img = await loadImage((n.attrs?.src as string) ?? "");
      if (!img) return [new Paragraph({ children: [new TextRun({ text: `[image: ${n.attrs?.alt ?? "not embedded"}]`, color: MUTED })] })];
      state.embedded.set(n, state.embedded.size);
      return [new Paragraph({
        alignment: align,
        children: [new ImageRun({
          type: img.type,
          data: img.data,
          transformation: { width: img.width, height: img.height },
          altText: n.attrs?.alt ? { name: String(n.attrs.alt), description: String(n.attrs.alt), title: String(n.attrs.alt) } : undefined,
        })],
      })];
    }

    case "table": {
      const rows: TableRow[] = [];
      for (const row of n.content ?? []) {
        const cells: TableCell[] = [];
        for (const cell of row.content ?? []) {
          const header = cell.type === "tableHeader";
          const cellNodes = header
            ? (cell.content ?? []).map((p) => p.type === "paragraph" || p.type === "heading"
              ? { ...p, content: p.content?.map((t) => ({ ...t, marks: [...(t.marks ?? []), { type: "bold" }] })) }
              : p)
            : cell.content;
          let content = await blocks(cellNodes, ctx, state);
          if (!content.length) content = [new Paragraph({ children: [] })];
          cells.push(new TableCell({
            children: content,
            columnSpan: (cell.attrs?.colspan as number) > 1 ? (cell.attrs!.colspan as number) : undefined,
            rowSpan: (cell.attrs?.rowspan as number) > 1 ? (cell.attrs!.rowspan as number) : undefined,
            shading: header ? { type: ShadingType.CLEAR, fill: "EFEDE8", color: "auto" } : undefined,
            margins: { top: 80, bottom: 80, left: 140, right: 140 },
          }));
        }
        rows.push(new TableRow({ children: cells, tableHeader: row.content?.every((c) => c.type === "tableHeader") || undefined }));
      }
      if (!rows.length) return [];
      // Explicit twip widths (full text width, equal columns) render the same in every reader.
      const cols = Math.max(1, ...(n.content ?? []).map((r) =>
        (r.content ?? []).reduce((sum, c) => sum + ((c.attrs?.colspan as number) || 1), 0)));
      const colWidth = Math.floor(TEXT_WIDTH_TWIPS / cols);
      return [
        new Table({ rows, width: { size: colWidth * cols, type: WidthType.DXA }, columnWidths: Array(cols).fill(colWidth) }),
        new Paragraph({ children: [] }),
      ];
    }

    default:
      // Unknown block: keep its text rather than dropping it.
      return n.content ? blocks(n.content, ctx, state) : [];
  }
}

/* ---------- Document ---------- */

const BULLETS = ["●", "○", "■"];
const NUMBER_FORMATS = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];

export async function toDocx(doc: JSONContent, title = "Document"): Promise<Uint8Array> {
  const state: State = { ordered: 0, embedded: new Map() };
  const children = await blocks(doc.content, { listLevel: 0, quote: false }, state);
  const heading = (halfPt: number, before: number) => ({
    run: { font: FONT, size: halfPt, bold: true, color: "1F1F1F" },
    paragraph: { spacing: { before, after: 80, line: 288 } },
  });

  const document = new Document({
    title,
    creator: "Scribe",
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY_HALF_PT, color: "1F1F1F" },
          paragraph: { spacing: { line: LINE, after: AFTER } },
        },
        heading1: heading(51, 360),
        heading2: heading(38, 320),
        heading3: heading(31, 280),
      },
      // Also set on the Normal style: some readers (Pages, Quick Look) ignore document defaults.
      paragraphStyles: [{
        id: "Normal", name: "Normal", quickFormat: true,
        run: { font: FONT, size: BODY_HALF_PT, color: "1F1F1F" },
        paragraph: { spacing: { line: LINE, after: AFTER } },
      }],
      characterStyles: [{
        id: "Hyperlink", name: "Hyperlink", basedOn: "DefaultParagraphFont",
        run: { color: "2F6FED", underline: {} },
      }],
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level, format: LevelFormat.BULLET, text: BULLETS[level % 3], alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
        {
          reference: "numbers",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level, format: NUMBER_FORMATS[level % 3], text: `%${level + 1}.`, alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 }, // US Letter
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
        },
      },
      children: children.length ? children : [new Paragraph({ children: [] })],
    }],
  });

  const zip = await JSZip.loadAsync(await Packer.toArrayBuffer(document));
  await embedScribeJson(zip, withMediaRefs(doc, state.embedded));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/* ---------- Embedded Scribe JSON ---------- */

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#"
      ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1))
      : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]);

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Images already stored as Word media are referenced instead of stored twice. */
function withMediaRefs(n: JSONContent, embedded: Map<JSONContent, number>): JSONContent {
  const i = embedded.get(n);
  if (i !== undefined) return { ...n, attrs: { ...n.attrs, src: `${MEDIA_SCHEME}${i}` } };
  return n.content ? { ...n, content: n.content.map((c) => withMediaRefs(c, embedded)) } : n;
}

async function embedScribeJson(zip: JSZip, content: JSONContent) {
  const documentXml = await zip.file("word/document.xml")!.async("uint8array");
  const payload = JSON.stringify({ version: 1, documentHash: await sha256(documentXml), content });
  zip.file(SCRIBE_PART, `<?xml version="1.0" encoding="UTF-8"?><scribe xmlns="${SCRIBE_NS}">${escapeXml(payload)}</scribe>`);
  const relsPath = "word/_rels/document.xml.rels";
  const rels = await zip.file(relsPath)!.async("string");
  zip.file(relsPath, rels.replace("</Relationships>",
    `<Relationship Id="rIdScribe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../${SCRIBE_PART}"/></Relationships>`));
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp" };

/**
 * If `bytes` is a .docx saved by Scribe and unchanged since, return the exact
 * Scribe document. Otherwise (made or edited elsewhere) return null.
 */
export async function readScribeDocx(bytes: Uint8Array): Promise<JSONContent | null> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { return null; }
  const documentXmlFile = zip.file("word/document.xml");
  if (!documentXmlFile) return null;

  // Word may rename custom XML parts, so look for ours by namespace.
  let payload: { version: number; documentHash: string; content: JSONContent } | null = null;
  const pattern = new RegExp(`<scribe[^>]*xmlns="${SCRIBE_NS}"[^>]*>([\\s\\S]*)</scribe>`);
  for (const f of zip.file(/^customXml\/[^/]+\.xml$/)) {
    const m = pattern.exec(await f.async("string"));
    if (!m) continue;
    try { payload = JSON.parse(unescapeXml(m[1])); } catch { return null; }
    break;
  }
  if (!payload || payload.version !== 1) return null;

  const documentXml = await documentXmlFile.async("uint8array");
  if ((await sha256(documentXml)) !== payload.documentHash) return null; // edited elsewhere

  // Resolve scribe-media:N to the N-th image in the Word document.
  const xml = new TextDecoder().decode(documentXml);
  const blips = [...xml.matchAll(/r:embed="([^"]+)"/g)].map((m) => m[1]);
  const rels = (await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? "";
  const targets = new Map<string, string>();
  for (const [tag] of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    if (id && target) targets.set(id, target);
  }
  const media = async (i: number): Promise<string | null> => {
    const target = targets.get(blips[i] ?? "");
    const file = target ? zip.file(target.startsWith("/") ? target.slice(1) : `word/${target}`) : null;
    if (!target || !file) return null;
    const ext = target.split(".").pop()!.toLowerCase();
    return `data:${MIME[ext] ?? "application/octet-stream"};base64,${toBase64(await file.async("uint8array"))}`;
  };
  const restore = async (n: JSONContent): Promise<JSONContent> => {
    const src = n.attrs?.src;
    if (n.type === "image" && typeof src === "string" && src.startsWith(MEDIA_SCHEME)) {
      const data = await media(Number(src.slice(MEDIA_SCHEME.length)));
      return { ...n, attrs: { ...n.attrs, src: data ?? "" } };
    }
    return n.content ? { ...n, content: await Promise.all(n.content.map(restore)) } : n;
  };
  return restore(payload.content);
}
