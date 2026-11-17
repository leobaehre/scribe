// Round-trip check for the native .docx format: Scribe JSON → .docx → Word view (mammoth) and back to Scribe.
// Usage: npm run test:docx-export [-- out.docx]
import { writeFileSync } from "node:fs";
import mammoth from "mammoth";
import JSZip from "jszip";
import { readScribeDocx, toDocx } from "../src/lib/docxFormat.ts";

// 2×1 red PNG
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEIGGEAAB0eAf+3ePcVAAAAAElFTkSuQmCC";
const t = (text, marks) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const p = (...content) => ({ type: "paragraph", content });
const doc = { type: "doc", content: [
  { type: "heading", attrs: { level: 1 }, content: [t("Quarterly notes")] },
  p(t("Plain, "), t("bold", [{ type: "bold" }]), t(", "), t("italic", [{ type: "italic" }]), t(", "),
    t("underlined", [{ type: "underline" }]), t(", "), t("struck", [{ type: "strike" }]), t(", "),
    t("red", [{ type: "textStyle", attrs: { color: "#cc0000" } }]), t(", "),
    t("highlighted", [{ type: "highlight", attrs: { color: "#fff2cc" } }]), t(", "),
    t("big Arial", [{ type: "textStyle", attrs: { fontFamily: "Arial, sans-serif", fontSize: "20pt" } }]), t(", "),
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
  { type: "codeBlock", content: [t("const a = 1;\nconsole.log(a);")] },
] };

const bytes = await toDocx(doc, "Test");
const out = process.argv[2];
if (out) writeFileSync(out, bytes);
const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
console.log(`${bytes.length} bytes`);
console.log(html);

const expect = ["<h1>Quarterly notes</h1>", "<strong>bold</strong>", "<em>italic</em>", /* mammoth ignores underline */ "<s>struck</s>",
  '<a href="https://example.com">a link</a>', "<br />After a line break.", "<h2>Lists</h2>", "<ul><li>One<ul><li>Nested</li></ul></li><li>Two</li></ul>",
  "<ol><li>First</li><li>Second</li></ol>", "<img", "<table>", "Apples", "console.log(a);"];
const missing = expect.filter((s) => !html.includes(s));
if (missing.length) { console.error("MISSING:", missing); process.exit(1); }
console.log("OK: Word sees all expected content");

// Scribe → .docx → Scribe must be exact (images restored from Word's media).
const back = await readScribeDocx(bytes);
if (JSON.stringify(back) !== JSON.stringify(doc)) {
  console.error("MISMATCH reopening in Scribe:\n", JSON.stringify(back).slice(0, 400));
  process.exit(1);
}
const zip = await JSZip.loadAsync(bytes);
const parts = Object.keys(zip.files);
console.log(`OK: reopens losslessly in Scribe (JSON stored once; media: ${parts.filter((p) => p.startsWith("word/media/")).length} file)`);

// A file edited elsewhere must not reopen from the stale embedded copy.
const xml = await zip.file("word/document.xml").async("string");
zip.file("word/document.xml", xml.replace("Quarterly notes", "Edited in Word"));
const edited = await zip.generateAsync({ type: "uint8array" });
if ((await readScribeDocx(edited)) !== null) { console.error("Edited file was not detected"); process.exit(1); }
console.log("OK: a file edited in another app is detected and imported instead");
