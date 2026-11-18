import type { JSONContent } from "@tiptap/core";
import JSZip from "jszip";

/**
 * Reads a .docx written by another app (Word, Pages, Google Docs, …) straight
 * from its XML into Scribe's document JSON, keeping the original look: fonts,
 * sizes, colors, highlights and alignment, plus headings, lists, links,
 * images and tables (with merged cells).
 *
 * Things Scribe can't show (headers, footers, comments, footnotes, equations,
 * charts) are skipped and reported in `warnings`.
 */

/* ---------- XML helpers (prefix-agnostic: match on local names) ---------- */

const kids = (el: Element | null | undefined, name?: string): Element[] =>
  el ? Array.from(el.children).filter((c) => !name || c.localName === name) : [];
const child = (el: Element | null | undefined, name: string): Element | undefined =>
  el ? Array.from(el.children).find((c) => c.localName === name) : undefined;
function attr(el: Element | null | undefined, name: string): string | undefined {
  if (!el) return undefined;
  // Compare the name without its prefix (some DOM implementations keep "w:" in localName).
  for (const a of Array.from(el.attributes)) if (a.name.slice(a.name.indexOf(":") + 1) === name) return a.value;
  return undefined;
}
const val = (el: Element | null | undefined) => attr(el, "val");
function descendants(el: Element, name: string): Element[] {
  const out: Element[] = [];
  const walk = (e: Element) => { for (const c of Array.from(e.children)) { if (c.localName === name) out.push(c); walk(c); } };
  walk(el);
  return out;
}
/** On/off properties: present without a value means on. */
function toggle(el: Element | undefined): boolean | undefined {
  if (!el) return undefined;
  const v = val(el);
  return !(v === "0" || v === "false" || v === "off" || v === "none");
}

/* ---------- Run and paragraph properties ---------- */

type RunProps = { b?: boolean; i?: boolean; u?: boolean; strike?: boolean; color?: string; sz?: number; font?: string; hl?: string };
type ParaProps = { jc?: string; numId?: string; ilvl?: number; outline?: number };
type Style = { id: string; name: string; type: string; basedOn?: string; rPr: RunProps; pPr: ParaProps };

const HIGHLIGHT: Record<string, string> = {
  yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000",
  darkBlue: "#00008b", darkCyan: "#008b8b", darkGreen: "#006400", darkMagenta: "#800080", darkRed: "#8b0000",
  darkYellow: "#808000", darkGray: "#a9a9a9", lightGray: "#d3d3d3", black: "#000000", white: "#ffffff",
};

function runProps(rPr: Element | undefined, theme: Theme): RunProps {
  const p: RunProps = {};
  if (!rPr) return p;
  const set = <K extends keyof RunProps>(k: K, v: RunProps[K] | undefined) => { if (v !== undefined) p[k] = v; };
  set("b", toggle(child(rPr, "b")));
  set("i", toggle(child(rPr, "i")));
  set("u", toggle(child(rPr, "u")));
  const strike = toggle(child(rPr, "strike")) ?? toggle(child(rPr, "dstrike"));
  set("strike", strike);
  const color = val(child(rPr, "color"));
  if (color) p.color = /^[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "auto";
  const sz = Number(val(child(rPr, "sz")));
  if (sz > 0) p.sz = sz;
  const fonts = child(rPr, "rFonts");
  if (fonts) {
    const themed = attr(fonts, "asciiTheme") ?? attr(fonts, "hAnsiTheme");
    const font = themed ? (themed.startsWith("major") ? theme.major : theme.minor) : attr(fonts, "ascii") ?? attr(fonts, "hAnsi");
    if (font) p.font = font;
  }
  const hl = val(child(rPr, "highlight"));
  if (hl) p.hl = hl === "none" ? "none" : HIGHLIGHT[hl];
  else {
    const fill = attr(child(rPr, "shd"), "fill");
    if (fill && /^[0-9a-f]{6}$/i.test(fill)) p.hl = `#${fill.toLowerCase()}`;
  }
  return p;
}

function paraProps(pPr: Element | undefined): ParaProps {
  const p: ParaProps = {};
  if (!pPr) return p;
  const jc = val(child(pPr, "jc"));
  if (jc) p.jc = jc;
  const numPr = child(pPr, "numPr");
  if (numPr) {
    const id = val(child(numPr, "numId"));
    if (id !== undefined) p.numId = id;
    const lvl = Number(val(child(numPr, "ilvl")));
    if (Number.isFinite(lvl)) p.ilvl = lvl;
  }
  const outline = Number(val(child(pPr, "outlineLvl")));
  if (Number.isFinite(outline) && child(pPr, "outlineLvl")) p.outline = outline;
  return p;
}

/* ---------- Document context ---------- */

type Theme = { major?: string; minor?: string };
type Rel = { target: string; external: boolean };
type Ctx = {
  zip: JSZip;
  rels: Map<string, Rel>;
  styles: Map<string, Style>;
  defaultPara?: string;
  defaults: RunProps;
  textColor?: string; // the document's normal text color: not imported as a color
  numFormats: Map<string, string[]>; // numId → numFmt per level
  theme: Theme;
  warnings: Set<string>;
};

/** Properties along a style's basedOn chain, oldest ancestor first. */
function styleChain(ctx: Ctx, id: string | undefined): Style[] {
  const chain: Style[] = [];
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const s = ctx.styles.get(id);
    if (!s) break;
    chain.unshift(s);
    id = s.basedOn;
  }
  return chain;
}

function parseStyles(doc: Document | null, theme: Theme): { styles: Map<string, Style>; defaultPara?: string; defaults: RunProps } {
  const styles = new Map<string, Style>();
  let defaultPara: string | undefined;
  let defaults: RunProps = {};
  const root = doc?.documentElement;
  if (!root) return { styles, defaults };
  const docDefaults = child(root, "docDefaults");
  defaults = runProps(child(child(docDefaults, "rPrDefault"), "rPr"), theme);
  for (const s of kids(root, "style")) {
    const id = attr(s, "styleId");
    if (!id) continue;
    const type = attr(s, "type") ?? "paragraph";
    styles.set(id, {
      id, type,
      name: (val(child(s, "name")) ?? id).toLowerCase(),
      basedOn: val(child(s, "basedOn")),
      rPr: runProps(child(s, "rPr"), theme),
      pPr: paraProps(child(s, "pPr")),
    });
    const isDefault = attr(s, "default");
    if (type === "paragraph" && (isDefault === "1" || isDefault === "true")) defaultPara = id;
  }
  return { styles, defaultPara, defaults };
}

function parseNumbering(doc: Document | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const root = doc?.documentElement;
  if (!root) return out;
  const abstract = new Map<string, string[]>();
  for (const a of kids(root, "abstractNum")) {
    const fmts: string[] = [];
    for (const lvl of kids(a, "lvl")) fmts[Number(attr(lvl, "ilvl")) || 0] = val(child(lvl, "numFmt")) ?? "decimal";
    abstract.set(attr(a, "abstractNumId") ?? "", fmts);
  }
  for (const n of kids(root, "num")) {
    out.set(attr(n, "numId") ?? "", abstract.get(val(child(n, "abstractNumId")) ?? "") ?? []);
  }
  return out;
}

function parseTheme(doc: Document | null): Theme {
  const root = doc?.documentElement;
  if (!root) return {};
  const font = (name: string) => {
    const el = descendants(root, name)[0];
    return attr(el ? child(el, "latin") : undefined, "typeface") || undefined;
  };
  return { major: font("majorFont"), minor: font("minorFont") };
}

function parseRels(doc: Document | null): Map<string, Rel> {
  const out = new Map<string, Rel>();
  for (const r of kids(doc?.documentElement, "Relationship")) {
    out.set(attr(r, "Id") ?? "", { target: attr(r, "Target") ?? "", external: attr(r, "TargetMode") === "External" });
  }
  return out;
}

/* ---------- Marks ---------- */

/** Toolbar font values, so imported fonts show up selected in the font menu. */
const FONT_VALUES: Record<string, string> = {
  georgia: "Georgia, serif",
  "times new roman": "\"Times New Roman\", Times, serif",
  arial: "Arial, Helvetica, sans-serif",
  helvetica: "\"Helvetica Neue\", Helvetica, Arial, sans-serif",
  verdana: "Verdana, sans-serif",
  "courier new": "\"Courier New\", Courier, monospace",
};
const SCRIBE_FONT = "charter";
const SCRIBE_SIZE = 26; // half-points: Scribe's 13pt body text
const LINK_BLUES = new Set(["0563c1", "1155cc", "0000ff", "2f6fed", "467886"]);

function fontValue(font: string): string {
  return FONT_VALUES[font.toLowerCase()] ?? (/[\s,]/.test(font) ? `"${font}"` : font);
}

type Mark = NonNullable<JSONContent["marks"]>[number];

function marksFor(p: RunProps, ctx: Ctx, link?: string): Mark[] {
  const marks: Mark[] = [];
  if (p.b) marks.push({ type: "bold" });
  if (p.i) marks.push({ type: "italic" });
  if (p.u && !link) marks.push({ type: "underline" });
  if (p.strike) marks.push({ type: "strike" });
  const style: Record<string, string> = {};
  const color = p.color;
  if (color && color !== "auto" && color !== "000000" && color !== ctx.textColor && !(link && LINK_BLUES.has(color))) {
    style.color = `#${color}`;
  }
  if (p.font && p.font.toLowerCase() !== SCRIBE_FONT) style.fontFamily = fontValue(p.font);
  if (p.sz && p.sz !== SCRIBE_SIZE) style.fontSize = `${p.sz / 2}pt`;
  if (Object.keys(style).length) marks.push({ type: "textStyle", attrs: style });
  if (p.hl && p.hl !== "none") marks.push({ type: "highlight", attrs: { color: p.hl } });
  if (link) marks.push({ type: "link", attrs: { href: link } });
  return marks;
}

/* ---------- Media ---------- */

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml",
};

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function partPath(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = ["word"];
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

async function imageNode(ctx: Ctx, relId: string | undefined, alt: string | undefined, widthPx?: number): Promise<JSONContent | null> {
  const rel = relId ? ctx.rels.get(relId) : undefined;
  if (!rel || rel.external) return null;
  const ext = rel.target.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME[ext];
  if (!mime) { ctx.warnings.add(`Some images (.${ext}) can't be shown.`); return null; }
  const file = ctx.zip.file(partPath(rel.target));
  if (!file) return null;
  const src = `data:${mime};base64,${toBase64(await file.async("uint8array"))}`;
  return { type: "image", attrs: { src, alt: alt || null, ...(widthPx ? { width: Math.round(widthPx) } : {}) } };
}

/* ---------- Paragraphs ---------- */

/** Inline output: text pieces, line breaks, or block-level images / text box content to lift out. */
type Piece = JSONContent | { lift: JSONContent[] };
type Field = { instr: string; result: boolean; link?: string };
type ParaState = { base: RunProps; heading: boolean; quote: boolean; fields: Field[] };

const isLift = (p: Piece): p is { lift: JSONContent[] } => "lift" in p;

async function inlineContent(el: Element, ctx: Ctx, st: ParaState, link: string | undefined, out: Piece[]) {
  for (const c of kids(el)) {
    switch (c.localName) {
      case "r": await run(c, ctx, st, link, out); break;
      case "hyperlink": {
        const rel = ctx.rels.get(attr(c, "id") ?? "");
        const href = rel?.external ? rel.target : undefined;
        await inlineContent(c, ctx, st, href ?? link, out);
        break;
      }
      case "fldSimple": {
        const m = /HYPERLINK\s+"([^"]+)"/.exec(attr(c, "instr") ?? "");
        await inlineContent(c, ctx, st, m?.[1] ?? link, out);
        break;
      }
      case "ins": case "smartTag": case "customXml": case "dir": case "bdo":
        await inlineContent(c, ctx, st, link, out); break;
      case "sdt":
        await inlineContent(child(c, "sdtContent") ?? c, ctx, st, link, out); break;
      case "oMath": case "oMathPara":
        ctx.warnings.add("Equations aren't supported yet and were left out."); break;
      // del, moveFrom, bookmarks, proofing marks, comment ranges: nothing to show
    }
  }
}

async function run(r: Element, ctx: Ctx, st: ParaState, link: string | undefined, out: Piece[]) {
  const rPr = child(r, "rPr");
  const styleId = val(child(rPr, "rStyle"));
  const charStyle: RunProps = {};
  for (const s of styleChain(ctx, styleId)) {
    const props = { ...s.rPr };
    // Word's built-in link style: Scribe draws links itself.
    if (s.name === "hyperlink" || s.id === "Hyperlink") { delete props.color; delete props.u; }
    Object.assign(charStyle, props);
  }
  const props: RunProps = { ...st.base, ...charStyle, ...runProps(rPr, ctx.theme) };
  const fieldLink = [...st.fields].reverse().find((f) => f.result && f.link)?.link;
  const inField = st.fields.some((f) => !f.result);
  const marks = marksFor(props, ctx, link ?? fieldLink);
  const text = (t: string) => { if (t && !inField) out.push({ type: "text", text: t, ...(marks.length ? { marks } : {}) }); };

  for (const c of kids(r)) {
    switch (c.localName) {
      case "t": text(c.textContent ?? ""); break;
      case "tab": case "ptab": text("\t"); break;
      case "noBreakHyphen": text("-"); break;
      case "br": case "cr": {
        const type = attr(c, "type");
        if (type !== "page" && type !== "column" && !inField) out.push({ type: "hardBreak" });
        break;
      }
      case "fldChar": {
        const type = attr(c, "fldCharType");
        if (type === "begin") st.fields.push({ instr: "", result: false });
        else if (type === "separate") {
          const f = st.fields[st.fields.length - 1];
          if (f) { f.result = true; f.link = /HYPERLINK\s+"([^"]+)"/.exec(f.instr)?.[1]; }
        } else if (type === "end") st.fields.pop();
        break;
      }
      case "instrText": {
        const f = st.fields[st.fields.length - 1];
        if (f && !f.result) f.instr += c.textContent ?? "";
        break;
      }
      case "drawing": case "pict": case "object":
        out.push({ lift: await graphic(c, ctx) }); break;
      case "AlternateContent": {
        // Prefer the modern Choice; the Fallback repeats it in an older format.
        const choice = child(c, "Choice") ?? child(c, "Fallback");
        if (choice) for (const g of kids(choice)) if (["drawing", "pict", "object"].includes(g.localName)) out.push({ lift: await graphic(g, ctx) });
        break;
      }
      case "footnoteReference": case "endnoteReference":
        ctx.warnings.add("Footnotes aren't supported yet and were left out."); break;
      case "commentReference":
        ctx.warnings.add("Comments aren't shown."); break;
    }
  }
}

/** Images and text box contents inside a drawing, as blocks. */
async function graphic(el: Element, ctx: Ctx): Promise<JSONContent[]> {
  const out: JSONContent[] = [];
  const data = descendants(el, "graphicData")[0];
  const uri = attr(data, "uri") ?? "";
  if (/chart|diagram/.test(uri)) { ctx.warnings.add("Charts and SmartArt aren't supported yet and were left out."); return out; }

  const extent = descendants(el, "extent")[0];
  const cx = Number(attr(extent, "cx"));
  const widthPx = cx > 0 ? cx / 9525 : undefined; // EMU → CSS px
  const alt = attr(descendants(el, "docPr")[0], "descr") ?? attr(descendants(el, "docPr")[0], "title");
  for (const blip of descendants(el, "blip")) {
    const img = await imageNode(ctx, attr(blip, "embed"), alt, widthPx);
    if (img) out.push(img);
  }
  for (const imgData of descendants(el, "imagedata")) {
    const img = await imageNode(ctx, attr(imgData, "id"), alt);
    if (img) out.push(img);
  }
  for (const box of descendants(el, "txbxContent")) out.push(...(await blocks(box, ctx)));
  return out;
}

/** Merge neighbouring text nodes with identical marks. */
function compact(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (last && n.type === "text" && last.type === "text" && JSON.stringify(last.marks) === JSON.stringify(n.marks)) {
      last.text += n.text ?? "";
    } else out.push({ ...n });
  }
  return out;
}

const ALIGN: Record<string, string> = { center: "center", right: "right", end: "right", both: "justify", distribute: "justify" };

type Item = { nodes: JSONContent[]; list?: { level: number; ordered: boolean; numId: string } };

async function paragraph(p: Element, ctx: Ctx): Promise<Item> {
  const pPr = child(p, "pPr");
  const styleId = val(child(pPr, "pStyle")) ?? ctx.defaultPara;
  const chain = styleChain(ctx, styleId);
  const pp: ParaProps = {};
  for (const s of chain) Object.assign(pp, s.pPr);
  Object.assign(pp, paraProps(pPr));
  const name = chain[chain.length - 1]?.name ?? "";

  let level = /^heading ([1-9])$/.exec(name)?.[1] ? Number(/^heading ([1-9])$/.exec(name)![1])
    : name === "title" ? 1 : name === "subtitle" ? 2
    : pp.outline !== undefined && pp.outline < 9 ? pp.outline + 1 : 0;
  level = Math.min(level, 6);
  const quote = name === "quote" || name === "intense quote";

  // Run defaults: document defaults + paragraph style. Headings and quotes get their
  // size/weight (and quotes their color) from Scribe, so those come only from direct formatting.
  const base: RunProps = { ...ctx.defaults };
  for (const s of chain) Object.assign(base, s.rPr);
  if (level) { delete base.b; delete base.sz; }
  if (quote) delete base.color;

  const pieces: Piece[] = [];
  await inlineContent(p, ctx, { base, heading: !!level, quote, fields: [] }, undefined, pieces);

  // Split around lifted blocks (images, text boxes): text before, the blocks, text after.
  const attrs: Record<string, unknown> = {};
  const align = ALIGN[pp.jc ?? ""];
  if (align) attrs.textAlign = align;
  const make = (content: JSONContent[]): JSONContent => {
    const c = compact(content);
    const node: JSONContent = level ? { type: "heading", attrs: { ...attrs, level } } : { type: "paragraph", ...(align ? { attrs } : {}) };
    if (c.length) node.content = c;
    return node;
  };
  const nodes: JSONContent[] = [];
  let current: JSONContent[] = [];
  let lifted = false;
  for (const piece of pieces) {
    if (isLift(piece)) {
      if (current.length) nodes.push(make(current));
      current = [];
      nodes.push(...piece.lift);
      lifted = true;
    } else current.push(piece);
  }
  if (current.length || !lifted) nodes.push(make(current));

  // An empty paragraph with only a bottom border is a horizontal line.
  if (!lifted && !current.length && child(child(pPr, "pBdr"), "bottom")) return { nodes: [{ type: "horizontalRule" }] };

  if (quote) return { nodes: [{ type: "blockquote", content: nodes.map((n) => n.type === "heading" ? { ...n, type: "paragraph", attrs: undefined } : n) }] };

  if (pp.numId && pp.numId !== "0") {
    const lvl = pp.ilvl ?? 0;
    const fmt = ctx.numFormats.get(pp.numId)?.[lvl] ?? "bullet";
    // A list item starts with a paragraph.
    const first = nodes[0]?.type === "heading" ? { ...nodes[0], type: "paragraph", attrs: align ? { textAlign: align } : undefined } : nodes[0];
    return { nodes: first?.type === "paragraph" ? [first, ...nodes.slice(1)] : [{ type: "paragraph" }, ...nodes], list: { level: lvl, ordered: fmt !== "bullet" && fmt !== "none", numId: pp.numId } };
  }
  return { nodes };
}

/** Turn a run of list paragraphs into nested bullet / numbered lists. */
function makeLists(run: Required<Item>[]): JSONContent[] {
  const out: JSONContent[] = [];
  let i = 0;
  while (i < run.length) {
    const base = run[i].list.level;
    const { ordered, numId } = run[i].list;
    const items: JSONContent[] = [];
    while (i < run.length && run[i].list.level >= base) {
      const it = run[i];
      if (it.list.level === base) {
        // A different list type, or a separately numbered list, starts a new list.
        if (items.length && (it.list.ordered !== ordered || (ordered && it.list.numId !== numId))) break;
        items.push({ type: "listItem", content: [...it.nodes] });
        i++;
      } else {
        let j = i;
        while (j < run.length && run[j].list.level > base) j++;
        const nested = makeLists(run.slice(i, j));
        if (items.length) items[items.length - 1].content!.push(...nested);
        else items.push({ type: "listItem", content: [{ type: "paragraph" }, ...nested] });
        i = j;
      }
    }
    out.push({ type: ordered ? "orderedList" : "bulletList", content: items });
  }
  return out;
}

/* ---------- Tables ---------- */

async function table(tbl: Element, ctx: Ctx): Promise<JSONContent> {
  const rowEls: Element[] = [];
  const collectRows = (el: Element) => {
    for (const c of kids(el)) {
      if (c.localName === "tr") rowEls.push(c);
      else if (c.localName === "sdt") collectRows(child(c, "sdtContent") ?? c);
      else if (c.localName === "customXml") collectRows(c);
    }
  };
  collectRows(tbl);

  type Cell = { el: Element; col: number; span: number; merge?: "restart" | "continue" };
  const grid: Cell[][] = rowEls.map((tr) => {
    let col = Number(val(child(child(tr, "trPr"), "gridBefore"))) || 0;
    const cells: Cell[] = [];
    const collectCells = (el: Element) => {
      for (const c of kids(el)) {
        if (c.localName === "tc") {
          const tcPr = child(c, "tcPr");
          const span = Number(val(child(tcPr, "gridSpan"))) || 1;
          const vm = child(tcPr, "vMerge");
          cells.push({ el: c, col, span, merge: vm ? (val(vm) === "restart" ? "restart" : "continue") : undefined });
          col += span;
        } else if (c.localName === "sdt") collectCells(child(c, "sdtContent") ?? c);
        else if (c.localName === "customXml") collectCells(c);
      }
    };
    collectCells(tr);
    return cells;
  });

  const rows: JSONContent[] = [];
  for (let r = 0; r < grid.length; r++) {
    const header = toggle(child(child(rowEls[r], "trPr"), "tblHeader")) === true;
    const cells: JSONContent[] = [];
    for (const cell of grid[r]) {
      if (cell.merge === "continue") continue;
      let rowspan = 1;
      if (cell.merge === "restart") {
        while (grid[r + rowspan]?.some((c) => c.col === cell.col && c.merge === "continue")) rowspan++;
      }
      const content = await blocks(cell.el, ctx);
      cells.push({
        type: header ? "tableHeader" : "tableCell",
        attrs: { colspan: cell.span, rowspan, colwidth: null },
        content: content.length ? content : [{ type: "paragraph" }],
      });
    }
    rows.push({ type: "tableRow", content: cells });
  }
  return { type: "table", content: rows };
}

/* ---------- Blocks ---------- */

async function blocks(container: Element, ctx: Ctx): Promise<JSONContent[]> {
  const items: Item[] = [];
  const walk = async (el: Element) => {
    for (const c of kids(el)) {
      switch (c.localName) {
        case "p": items.push(await paragraph(c, ctx)); break;
        case "tbl": items.push({ nodes: [await table(c, ctx)] }); break;
        case "sdt": await walk(child(c, "sdtContent") ?? c); break;
        case "customXml": case "ins": await walk(c); break;
        case "oMathPara": ctx.warnings.add("Equations aren't supported yet and were left out."); break;
      }
    }
  };
  await walk(container);

  const out: JSONContent[] = [];
  for (let i = 0; i < items.length;) {
    if (!items[i].list) { out.push(...items[i].nodes); i++; continue; }
    let j = i;
    while (j < items.length && items[j].list) j++;
    out.push(...makeLists(items.slice(i, j) as Required<Item>[]));
    i = j;
  }
  return out;
}

/* ---------- Entry point ---------- */

export async function importDocx(bytes: Uint8Array): Promise<{ json: JSONContent; warnings: string[] }> {
  const zip = await JSZip.loadAsync(bytes);
  const parser = new DOMParser();
  const xml = async (path: string) => {
    const f = zip.file(path);
    return f ? parser.parseFromString(await f.async("string"), "application/xml") : null;
  };
  const documentXml = await xml("word/document.xml");
  const body = child(documentXml?.documentElement, "body");
  if (!body) throw new Error("Not a Word document (word/document.xml has no body).");

  const theme = parseTheme(await xml("word/theme/theme1.xml"));
  const { styles, defaultPara, defaults } = parseStyles(await xml("word/styles.xml"), theme);
  const ctx: Ctx = {
    zip,
    rels: parseRels(await xml("word/_rels/document.xml.rels")),
    styles,
    defaultPara,
    defaults,
    numFormats: parseNumbering(await xml("word/numbering.xml")),
    theme,
    warnings: new Set(),
  };
  const normal = { ...defaults };
  for (const s of styleChain(ctx, defaultPara)) Object.assign(normal, s.rPr);
  ctx.textColor = normal.color;

  if (Object.keys(zip.files).some((f) => /^word\/(header|footer)\d*\.xml$/.test(f))) ctx.warnings.add("Headers and footers aren't shown.");
  if (zip.file("word/comments.xml")) ctx.warnings.add("Comments aren't shown.");

  const content = await blocks(body, ctx);
  return { json: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }, warnings: [...ctx.warnings] };
}
