import { open, save, message } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { JSONContent } from "@tiptap/react";
import { docxToHtml } from "./docx";
import { readScribeDocx, toDocx } from "./docxFormat";

/**
 * `foreign`: a .docx made (or last edited) by another app. Scribe imports what
 * it understands, so saving over it would drop the rest (headers, comments, …);
 * the app asks before replacing such a file.
 */
export type OpenedDoc = { path: string; name: string; foreign: boolean } & (
  | { kind: "html"; html: string }
  | { kind: "json"; json: JSONContent }
);

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const stem = (name: string) => name.replace(/\.[^.]+$/, "");
const isDocx = (p: string) => /\.docx$/i.test(p);
const KNOWN_EXT = /\.(docx|scribe)$/i;

/** Show the native open dialog and load a .docx (or older .scribe) file. */
export async function openDocument(): Promise<OpenedDoc | null> {
  const picked = await open({
    multiple: false,
    filters: [{ name: "Documents", extensions: ["docx", "scribe"] }],
  });
  if (!picked || Array.isArray(picked)) return null;
  const path = picked as string;
  const name = baseName(path);

  if (isDocx(path)) {
    const bytes = await readFile(path);
    const own = await readScribeDocx(bytes);
    if (own) return { kind: "json", path, name, json: own, foreign: false };
    const { html, warnings } = await docxToHtml(bytes);
    if (warnings.length) console.warn("docx import warnings:", warnings);
    return { kind: "html", path, name, html, foreign: true };
  }
  const parsed = JSON.parse(await readTextFile(path));
  return { kind: "json", path, name, json: parsed.content, foreign: false };
}

/** Write the document to `target`; the extension picks the format. */
async function writeDocument(json: JSONContent, target: string) {
  if (isDocx(target)) {
    await writeFile(target, await toDocx(json, stem(baseName(target))));
  } else {
    const payload = JSON.stringify({ format: "scribe", version: 1, content: json }, null, 2);
    await writeTextFile(target, payload);
  }
}

/**
 * Save to `path`, or ask for one (always, for Save As). New documents default
 * to Word (.docx); a file opened as .scribe keeps saving as .scribe.
 * Returns the path used, or null if cancelled.
 */
export async function saveDocument(
  json: JSONContent,
  path: string | null,
  suggestedName: string,
  saveAs = false,
): Promise<string | null> {
  let target = path;
  if (saveAs || !target || !KNOWN_EXT.test(target)) {
    const chosen = await save({
      defaultPath: stem(suggestedName) + (target && !isDocx(target) && KNOWN_EXT.test(target) ? ".scribe" : ".docx"),
      filters: [
        { name: "Word document", extensions: ["docx"] },
        { name: "Scribe document", extensions: ["scribe"] },
      ],
    });
    if (!chosen) return null;
    target = KNOWN_EXT.test(chosen) ? chosen : chosen + ".docx";
  }
  await writeDocument(json, target);
  return target;
}

/** Before overwriting a .docx from another app. */
export async function confirmReplaceForeign(name: string): Promise<"replace" | "saveAs" | "cancel"> {
  const r = await message(
    `“${name}” was created in another app. Saving will replace it with Scribe's version, ` +
      "and anything Scribe can't show (such as headers, footers and comments) will be lost.",
    { title: "Replace this Word document?", kind: "warning", buttons: { yes: "Replace", no: "Save As…", cancel: "Cancel" } },
  );
  if (r === "Yes" || r === "Replace") return "replace";
  if (r === "No" || r === "Save As…") return "saveAs";
  return "cancel";
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
};

/** Ask for an image file and return it as a data URL, so it's stored inside the document. */
export async function pickImage(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    filters: [{ name: "Images", extensions: Object.keys(IMAGE_TYPES) }],
  });
  if (!picked || Array.isArray(picked)) return null;
  const path = picked as string;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const bytes = await readFile(path);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${IMAGE_TYPES[ext] ?? "application/octet-stream"};base64,${btoa(bin)}`;
}

export const showError = (text: string) => message(text, { title: "Scribe", kind: "error" });
export { baseName };
