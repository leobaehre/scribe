// Verifies that a .docx converts to HTML and that TipTap's schema accepts it.
import { readFileSync } from "node:fs";
import mammoth from "mammoth";
import { generateJSON } from "@tiptap/html";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";

const file = process.argv[2];
if (!file) { console.error("usage: npm run test:docx -- file.docx"); process.exit(1); }
const { value: html, messages } = await mammoth.convertToHtml({ buffer: readFileSync(file) }, {
  styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh",
    "p[style-name='Quote'] => blockquote > p:fresh", "u => u", "strike => s"],
});
const json = generateJSON(html, [StarterKit, Image.configure({ allowBase64: true }),
  TextAlign, Table, TableRow, TableHeader, TableCell]);
const types = new Set();
(function walk(n) { types.add(n.type); (n.content || []).forEach(walk); (n.marks || []).forEach((m) => types.add("mark:" + m.type)); })(json);
console.log("warnings:", messages.length);
console.log("node/mark types:", [...types].sort().join(", "));
