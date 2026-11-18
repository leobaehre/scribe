// Shows how a .docx imports into Scribe: node/mark types and warnings.
// Usage: npm run test:docx -- file.docx
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { importDocx } from "../src/lib/docxImport.ts";

globalThis.DOMParser = new Window().DOMParser;

const file = process.argv[2];
if (!file) { console.error("usage: npm run test:docx -- file.docx"); process.exit(1); }
const { json, warnings } = await importDocx(new Uint8Array(readFileSync(file)));
const types = new Set();
(function walk(n) {
  types.add(n.type);
  (n.content || []).forEach(walk);
  (n.marks || []).forEach((m) => types.add("mark:" + m.type + (m.attrs ? `(${Object.keys(m.attrs).join(",")})` : "")));
})(json);
console.log("warnings:", warnings.length ? warnings : "none");
console.log("node/mark types:", [...types].sort().join(", "));
