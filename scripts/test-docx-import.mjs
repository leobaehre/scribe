// Checks the Word importer (src/lib/docxImport.ts) on files that don't carry Scribe's embedded copy.
// Usage: npm run test:docx-import
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import JSZip from "jszip";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { TextStyle, Color, FontFamily, FontSize } from "@tiptap/extension-text-style";
import { toDocx } from "../src/lib/docxFormat.ts";
import { importDocx } from "../src/lib/docxImport.ts";

globalThis.DOMParser = new Window().DOMParser;

let failed = 0;
const check = (ok, label) => { console.log(`${ok ? "OK  " : "FAIL"}: ${label}`); if (!ok) failed++; };
const all = (n, out = []) => { out.push(n); (n.content ?? []).forEach((c) => all(c, out)); return out; };
const texts = (doc) => all(doc).filter((n) => n.type === "text");
const textWith = (doc, s) => texts(doc).find((t) => t.text.includes(s));
const mark = (t, type) => t?.marks?.find((m) => m.type === type);
// Same extensions as the editor (src/App.tsx): imported JSON must load into it.
const schema = getSchema([StarterKit, Image.configure({ inline: false, allowBase64: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }), Table, TableRow, TableHeader, TableCell,
  TextStyle, Color, FontFamily, FontSize, Highlight.configure({ multicolor: true })]);
const valid = (doc) => { try { schema.nodeFromJSON(doc).check(); return true; } catch (e) { console.log("   ", e.message); return false; } };

/* 1. Scribe's own .docx with the embedded copy removed = how another app's save looks. */
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEIGGEAAB0eAf+3ePcVAAAAAElFTkSuQmCC";
const t = (text, marks) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const p = (...content) => ({ type: "paragraph", content });
const sample = { type: "doc", content: [
  { type: "heading", attrs: { level: 1 }, content: [t("Quarterly notes")] },
  p(t("Plain, "), t("bold", [{ type: "bold" }]), t(", "), t("italic", [{ type: "italic" }]), t(", "),
    t("underlined", [{ type: "underline" }]), t(", "), t("struck", [{ type: "strike" }]), t(", "),
    t("red", [{ type: "textStyle", attrs: { color: "#cc0000" } }]), t(", "),
    t("highlighted", [{ type: "highlight", attrs: { color: "#fff2cc" } }]), t(", "),
    t("big Arial", [{ type: "textStyle", attrs: { fontFamily: "Arial, Helvetica, sans-serif", fontSize: "20pt" } }]), t(", "),
    t("a link", [{ type: "link", attrs: { href: "https://example.com" } }]), t("."),
    { type: "hardBreak" }, t("After a line break.")),
  { type: "paragraph", attrs: { textAlign: "center" }, content: [t("Centered")] },
  { type: "heading", attrs: { level: 2 }, content: [t("Lists")] },
  { type: "bulletList", content: [
    { type: "listItem", content: [p(t("One")), { type: "bulletList", content: [{ type: "listItem", content: [p(t("Nested"))] }] }] },
    { type: "listItem", content: [p(t("Two"))] },
  ] },
  { type: "orderedList", content: [{ type: "listItem", content: [p(t("First"))] }, { type: "listItem", content: [p(t("Second"))] }] },
  { type: "blockquote", content: [p(t("A quote."))] },
  { type: "image", attrs: { src: png, alt: "red" } },
  { type: "table", content: [
    { type: "tableRow", content: [{ type: "tableHeader", content: [p(t("Name"))] }, { type: "tableHeader", content: [p(t("Qty"))] }] },
    { type: "tableRow", content: [{ type: "tableCell", content: [p(t("Apples"))] }, { type: "tableCell", content: [p(t("3"))] }] },
  ] },
] };

const zip = await JSZip.loadAsync(await toDocx(sample, "Test"));
zip.remove("customXml/scribe.xml");
const { json: a, warnings: wa } = await importDocx(await zip.generateAsync({ type: "uint8array" }));
const top = a.content;
console.log("\n— Scribe file without its embedded copy");
check(top[0].type === "heading" && top[0].attrs.level === 1 && top[0].content[0].text === "Quarterly notes", "heading 1");
check(top.some((n) => n.type === "heading" && n.attrs.level === 2), "heading 2");
check(!!mark(textWith(a, "bold"), "bold") && !mark(textWith(a, "Plain"), "bold"), "bold only where set");
check(!!mark(textWith(a, "italic"), "italic"), "italic");
check(!!mark(textWith(a, "underlined"), "underline"), "underline");
check(!!mark(textWith(a, "struck"), "strike"), "strikethrough");
check(mark(textWith(a, "red"), "textStyle")?.attrs.color === "#cc0000", "text color");
check(mark(textWith(a, "highlighted"), "highlight")?.attrs.color === "#fff2cc", "highlight color");
const big = mark(textWith(a, "big Arial"), "textStyle")?.attrs;
check(big?.fontFamily === "Arial, Helvetica, sans-serif" && big?.fontSize === "20pt", "font family + size");
check(!mark(textWith(a, "Plain"), "textStyle"), "default text gets no color/font/size marks");
const link = textWith(a, "a link");
check(mark(link, "link")?.attrs.href === "https://example.com" && !mark(link, "underline") && !mark(link, "textStyle"), "link (without Word's link color/underline)");
check(all(a).some((n) => n.type === "hardBreak"), "line break");
check(top.some((n) => n.attrs?.textAlign === "center" && n.content?.[0].text === "Centered"), "center alignment");
const bl = top.find((n) => n.type === "bulletList");
check(bl?.content.length === 2 && bl.content[0].content[1]?.type === "bulletList", "nested bullet list");
check(top.find((n) => n.type === "orderedList")?.content.length === 2, "numbered list");
check(top.some((n) => n.type === "blockquote" && n.content[0].content?.[0].text === "A quote." && !n.content[0].content[0].marks), "quote (Quote style)");
const img = all(a).find((n) => n.type === "image");
check(img?.attrs.src.startsWith("data:image/png;base64,") && img.attrs.alt === "red", "image with alt text");
const tbl = top.find((n) => n.type === "table");
check(tbl?.content[0].content.every((c) => c.type === "tableHeader") && tbl.content[1].content[0].type === "tableCell", "table with header row");
check(wa.length === 0, `no warnings (${wa.join("; ")})`);
check(valid(a), "valid editor document");

/* 2. A .docx written by another program (macOS textutil, from RTF). */
console.log("\n— File written by macOS textutil");
let tool = true;
try { execFileSync("textutil", ["-help"], { stdio: "ignore" }); } catch { tool = false; }
if (!tool) console.log("skip: textutil not available");
else {
  const dir = mkdtempSync(join(tmpdir(), "scribe-import-"));
  const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Helvetica;}{\f1 Georgia;}}{\colortbl;\red0\green0\blue0;\red0\green102\blue204;}
\f0\fs24 Plain text, \cf2 blue text\cf0 , {\f1\fs40 big Georgia}, {\b bold}.\par
\qc Centered line\par
\ql\par}`;
  writeFileSync(join(dir, "in.rtf"), rtf);
  execFileSync("textutil", ["-convert", "docx", "-output", join(dir, "out.docx"), join(dir, "in.rtf")]);
  const { json: b } = await importDocx(new Uint8Array(readFileSync(join(dir, "out.docx"))));
  rmSync(dir, { recursive: true });
  check(mark(textWith(b, "blue text"), "textStyle")?.attrs.color === "#0066cc", "color");
  const g = mark(textWith(b, "big Georgia"), "textStyle")?.attrs;
  check(g?.fontFamily === "Georgia, serif" && g?.fontSize === "20pt", "font family + size");
  check(mark(textWith(b, "Plain"), "textStyle")?.attrs.fontSize === "12pt", "body keeps its original size");
  check(!!mark(textWith(b, "bold"), "bold"), "bold");
  check(b.content.some((n) => n.attrs?.textAlign === "center"), "center alignment");
  check(valid(b), "valid editor document");
}

/* 3. Merged cells, hand-written XML. */
console.log("\n— Merged table cells");
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const tc = (text, pr = "") => `<w:tc><w:tcPr>${pr}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const docXml = `<?xml version="1.0"?><w:document ${W}><w:body><w:tbl>
<w:tr>${tc("Wide", '<w:gridSpan w:val="2"/>')}${tc("Tall", '<w:vMerge w:val="restart"/>')}</w:tr>
<w:tr>${tc("A")}${tc("B")}<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>
<w:tr>${tc("C")}${tc("D")}${tc("E")}</w:tr></w:tbl></w:body></w:document>`;
const z = new JSZip();
z.file("word/document.xml", docXml);
const { json: c } = await importDocx(await z.generateAsync({ type: "uint8array" }));
const rows = c.content[0].content;
check(rows[0].content[0].attrs.colspan === 2, "gridSpan → colspan 2");
check(rows[0].content[1].attrs.rowspan === 2, "vMerge → rowspan 2");
check(rows[1].content.length === 2 && rows[2].content.length === 3, "merged-away cells dropped");
check(valid(c), "valid editor document");

console.log(failed ? `\n${failed} check(s) failed` : "\nAll import checks passed");
process.exit(failed ? 1 : 0);
