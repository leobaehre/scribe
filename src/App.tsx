import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { TextStyle, Color, FontFamily, FontSize } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import Toolbar from "./Toolbar";
import { confirmReplaceForeign, openDocument, saveDocument, showError } from "./lib/files";
import { Pagination, PAGE, PERIOD } from "./lib/pagination";
import { COMMIT, DEBUG, VERSION } from "./lib/version";
import { IS_MAC, MOD } from "./lib/platform";

const UNTITLED = "Untitled";

export default function App() {
  const [name, setName] = useState(UNTITLED);
  const [path, setPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // The open .docx came from another app; ask before overwriting it.
  const [foreign, setForeign] = useState(false);
  const [pages, setPages] = useState(1);
  const loading = useRef(false);

  const editor = useEditor({
    extensions: [
      // StarterKit v3 already includes Underline and Link.
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Image.configure({ inline: false, allowBase64: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Pagination.configure({ onPages: setPages }),
    ],
    autofocus: "end",
    onUpdate: () => {
      if (!loading.current) setDirty(true);
    },
  });

  const words = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const t = e?.getText().trim() ?? "";
      return t ? t.split(/\s+/).length : 0;
    },
  });

  const doOpen = useCallback(async () => {
    if (!editor) return;
    try {
      const doc = await openDocument();
      if (!doc) return;
      loading.current = true;
      if (doc.kind === "html") editor.commands.setContent(doc.html);
      else editor.commands.setContent(doc.json);
      editor.commands.focus("start");
      loading.current = false;
      setName(doc.name);
      setPath(doc.path);
      setForeign(doc.foreign);
      setDirty(false);
    } catch (err) {
      loading.current = false;
      await showError(`Couldn't open that file.\n\n${String(err)}`);
    }
  }, [editor]);

  const doSave = useCallback(async (saveAs = false) => {
    if (!editor) return;
    try {
      if (foreign && path && !saveAs) {
        const choice = await confirmReplaceForeign(name);
        if (choice === "cancel") return;
        saveAs = choice === "saveAs";
      }
      const saved = await saveDocument(editor.getJSON(), path, name, saveAs);
      if (!saved) return;
      setPath(saved);
      setForeign(false);
      setName(saved.split(/[\\/]/).pop() ?? saved);
      setDirty(false);
    } catch (err) {
      await showError(`Couldn't save the file.\n\n${String(err)}`);
    }
  }, [editor, path, name, foreign]);

  const doNew = useCallback(() => {
    if (!editor) return;
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    loading.current = true;
    editor.commands.clearContent();
    loading.current = false;
    setName(UNTITLED);
    setPath(null);
    setForeign(false);
    setDirty(false);
  }, [editor, dirty]);

  // Native menu bar (macOS). Handlers are read through a ref so the
  // listener is registered once and always sees the latest callbacks.
  const menuActions = useRef<Record<string, () => void>>({});
  menuActions.current = {
    new: doNew,
    open: () => void doOpen(),
    save: () => void doSave(),
    saveAs: () => void doSave(true),
    undo: () => editor?.chain().focus().undo().run(),
    redo: () => editor?.chain().focus().redo().run(),
    bold: () => editor?.chain().focus().toggleBold().run(),
    italic: () => editor?.chain().focus().toggleItalic().run(),
    underline: () => editor?.chain().focus().toggleUnderline().run(),
    strike: () => editor?.chain().focus().toggleStrike().run(),
    paragraph: () => editor?.chain().focus().setParagraph().run(),
    h1: () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
    h2: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    h3: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
    bulletList: () => editor?.chain().focus().toggleBulletList().run(),
    orderedList: () => editor?.chain().focus().toggleOrderedList().run(),
    blockquote: () => editor?.chain().focus().toggleBlockquote().run(),
    link: () => {
      if (!editor) return;
      if (editor.isActive("link")) return void editor.chain().focus().unsetLink().run();
      const url = window.prompt("Link address");
      if (url) editor.chain().focus().setLink({ href: url }).run();
    },
    alignLeft: () => editor?.chain().focus().setTextAlign("left").run(),
    alignCenter: () => editor?.chain().focus().setTextAlign("center").run(),
    alignRight: () => editor?.chain().focus().setTextAlign("right").run(),
  };
  useEffect(() => {
    const unlisten = listen<string>("menu", (e) => menuActions.current[e.payload]?.());
    return () => { void unlisten.then((f) => f()); };
  }, []);

  // Keyboard shortcuts (Windows/Linux; macOS uses the menu bar accelerators)
  useEffect(() => {
    if (IS_MAC) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") { e.preventDefault(); void doSave(e.shiftKey); }
      else if (k === "o") { e.preventDefault(); void doOpen(); }
      else if (k === "n") { e.preventDefault(); doNew(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSave, doOpen, doNew]);

  // Window title reflects the document
  useEffect(() => {
    const title = `${dirty ? "● " : ""}${name} — Scribe`;
    document.title = title;
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [name, dirty]);

  if (!editor) return null;

  return (
    <div className="app">
      {/* On macOS, New/Open/Save live in the native menu bar instead. */}
      {!IS_MAC && (
        <header className="topbar">
            <div className="file-actions">
              <button onClick={doNew} title={`New (${MOD}N)`}>New</button>
              <button onClick={doOpen} title={`Open (${MOD}O)`}>Open</button>
              <button onClick={() => doSave()} title={`Save (${MOD}S)`}>Save</button>
              <button onClick={() => doSave(true)} title={`Save As (${MOD}Shift+S)`}>Save As</button>
            </div>
            <div className="doc-name">{name}{dirty ? " •" : ""}</div>
            <div className="topbar-spacer" />
        </header>
      )}
      <Toolbar editor={editor} />
      <main className="canvas">
        <div className="page" style={pageVars(pages)}>
          <div className="sheets" aria-hidden="true">
            {Array.from({ length: pages }, (_, i) => (
              <div key={i} className="sheet" style={{ top: i * PERIOD }}>
                <span className="page-num">{i + 1}</span>
              </div>
            ))}
          </div>
          <EditorContent editor={editor} className="page-content" />
        </div>
      </main>
      <footer className="statusbar">
        <span>{pages} {pages === 1 ? "page" : "pages"} · {words} {words === 1 ? "word" : "words"}</span>
        <span className="version" title={`Scribe ${VERSION}, build ${COMMIT}${DEBUG ? " (debug)" : ""}`}>
          {DEBUG && <span className="debug-badge">debug</span>}v{VERSION}
        </span>
      </footer>
    </div>
  );
}

const pageVars = (pages: number) =>
  ({
    "--page-w": `${PAGE.width}px`,
    "--page-h": `${PAGE.height}px`,
    "--page-margin": `${PAGE.margin}px`,
    "--doc-h": `${pages * PERIOD - PAGE.gap}px`,
  }) as CSSProperties;
