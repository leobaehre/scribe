import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { pickImage, showError } from "./lib/files";
import { MOD, SHIFT } from "./lib/platform";

/* ---------- Icons (Material Symbols paths, 24×24) ---------- */

const ICONS = {
  undo: "M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z",
  redo: "M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z",
  bold: "M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z",
  italic: "M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z",
  underline: "M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z",
  strike: "M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z",
  textColor: "M5.49 17h2.42l1.27-3.58h5.65L16.09 17h2.42L13.25 3h-2.5L5.49 17zm4.42-5.61l2.03-5.79h.12l2.03 5.79H9.91z",
  highlight: "M13.06 5.19l3.75 3.75L7.75 18H4v-3.75l9.06-9.06zm4.82 2.68l-3.75-3.75 1.83-1.83c.39-.39 1.02-.39 1.41 0l2.34 2.34c.39.39.39 1.02 0 1.41l-1.83 1.83z",
  link: "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z",
  image: "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z",
  alignLeft: "M15 15H3v2h12v-2zm0-8H3v2h12V7zM3 13h18v-2H3v2zm0 8h18v-2H3v2zM3 3v2h18V3H3z",
  alignCenter: "M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z",
  alignRight: "M3 21h18v-2H3v2zm6-4h12v-2H9v2zm-6-4h18v-2H3v2zm6-4h12V7H9v2zM3 3v2h18V3H3z",
  alignJustify: "M3 21h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18V7H3v2zm0-6v2h18V3H3z",
  bullets: "M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z",
  numbers: "M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z",
  quote: "M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z",
  outdent: "M11 17h10v-2H11v2zm-8-5l4 4V8l-4 4zm0 9h18v-2H3v2zM3 3v2h18V3H3zm8 6h10V7H11v2zm0 4h10v-2H11v2z",
  indent: "M3 21h18v-2H3v2zM3 8v8l4-4-4-4zm8 9h10v-2H11v2zM3 3v2h18V3H3zm8 6h10V7H11v2zm0 4h10v-2H11v2z",
  clear: "M3.27 5L2 6.27l6.97 6.97L6.5 19h3l1.57-3.66L16.73 21 18 19.73 3.55 5.27 3.27 5zM6 5v.18L8.82 8h2.4l-.72 1.68 2.1 2.1L14.21 8H20V5H6z",
  minus: "M19 13H5v-2h14v2z",
  plus: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  caret: "M7 10l5 5 5-5z",
} as const;

function Icon({ name, bar }: { name: keyof typeof ICONS; bar?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d={ICONS[name]} fill="currentColor" />
      {bar !== undefined && <rect x="3" y="20" width="18" height="3.2" rx="0.6" fill={bar} className="tb-colorbar" />}
    </svg>
  );
}

/* ---------- Building blocks ---------- */

type BtnProps = { icon: keyof typeof ICONS; title: string; active?: boolean; disabled?: boolean; onClick: () => void };

function Btn({ icon, title, active, disabled, onClick }: BtnProps) {
  return (
    <button
      type="button"
      className={"tb-btn" + (active ? " is-active" : "")}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep the editor selection
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

const Sep = () => <span className="tb-sep" />;

/** A toolbar button that opens a small panel below it; closes on outside click or Escape. */
function Dropdown({ button, title, children }: { button: ReactNode; title: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className="tb-dropdown" ref={ref}>
      <button
        type="button"
        className={"tb-btn tb-btn-wide" + (open ? " is-active" : "")}
        title={title}
        aria-label={title}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        {button}
      </button>
      {open && <div className="tb-panel">{children(() => setOpen(false))}</div>}
    </div>
  );
}

// Google Docs-style palette: grays, saturated, then light-to-dark tints.
const PALETTE = [
  ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"],
  ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"],
  ["#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc"],
  ["#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd"],
  ["#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0"],
  ["#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79"],
  ["#5b0f00", "#660000", "#783f04", "#7f6000", "#274e13", "#0c343d", "#1c4587", "#073763", "#20124d", "#4c1130"],
];

function ColorPicker({ icon, title, value, resetLabel, onPick }: {
  icon: "textColor" | "highlight"; title: string; value: string | null; resetLabel: string; onPick: (c: string | null) => void;
}) {
  return (
    <Dropdown title={title} button={<Icon name={icon} bar={value ?? (icon === "textColor" ? "currentColor" : "transparent")} />}>
      {(close) => (
        <div className="tb-palette">
          <button type="button" className="tb-reset" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(null); close(); }}>
            {resetLabel}
          </button>
          {PALETTE.map((row, i) => (
            <div key={i} className="tb-swatches">
              {row.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={"tb-swatch" + (value?.toLowerCase() === c ? " is-current" : "")}
                  style={{ background: c }}
                  title={c}
                  aria-label={c}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onPick(c); close(); }}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

/* ---------- Toolbar ---------- */

const FONTS: { label: string; value: string }[] = [
  { label: "Charter", value: "" }, // the document default (see --font-doc)
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "\"Times New Roman\", Times, serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", value: "\"Helvetica Neue\", Helvetica, Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Courier New", value: "\"Courier New\", Courier, monospace" },
];

const SIZE_STEPS = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96];

/** Font size in points at the cursor: an explicit size if set, else what the paragraph renders at. */
function currentSize(e: Editor): number {
  const set = e.getAttributes("textStyle").fontSize as string | undefined;
  if (set) {
    const n = parseFloat(set);
    return Math.round(set.endsWith("px") ? n * 0.75 : n);
  }
  try {
    const { node } = e.view.domAtPos(e.state.selection.from);
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
    if (el) return Math.round(parseFloat(getComputedStyle(el).fontSize) * 0.75);
  } catch { /* not rendered yet */ }
  return 13;
}

export default function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      block: e.isActive("heading", { level: 1 }) ? "1"
        : e.isActive("heading", { level: 2 }) ? "2"
        : e.isActive("heading", { level: 3 }) ? "3"
        : "p",
      font: (e.getAttributes("textStyle").fontFamily as string | undefined) ?? "",
      size: currentSize(e),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      color: (e.getAttributes("textStyle").color as string | undefined) ?? null,
      highlight: (e.getAttributes("highlight").color as string | undefined) ?? null,
      link: e.isActive("link"),
      align: (["center", "right", "justify"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left",
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      canIndent: e.can().sinkListItem("listItem"),
      canOutdent: e.can().liftListItem("listItem"),
    }),
  });

  const [sizeText, setSizeText] = useState(String(s.size));
  useEffect(() => setSizeText(String(s.size)), [s.size]);

  const chain = () => editor.chain().focus();

  const setBlock = (v: string) => {
    if (v === "p") chain().setParagraph().run();
    else chain().setHeading({ level: Number(v) as 1 | 2 | 3 }).run();
  };

  const setFont = (v: string) => (v ? chain().setFontFamily(v).run() : chain().unsetFontFamily().run());

  const setSize = (pt: number) => {
    if (!Number.isFinite(pt)) return setSizeText(String(s.size));
    const clamped = Math.min(400, Math.max(1, Math.round(pt)));
    chain().setFontSize(`${clamped}pt`).run();
  };
  const stepSize = (dir: 1 | -1) => {
    const next = dir > 0 ? SIZE_STEPS.find((n) => n > s.size) ?? s.size + 1 : [...SIZE_STEPS].reverse().find((n) => n < s.size) ?? Math.max(1, s.size - 1);
    setSize(next);
  };

  const toggleLink = () => {
    if (s.link) return void chain().unsetLink().run();
    const url = window.prompt("Link address");
    if (url) chain().extendMarkRange("link").setLink({ href: url }).run();
  };

  const insertImage = async () => {
    try {
      const src = await pickImage();
      if (src) chain().setImage({ src }).run();
    } catch (err) {
      await showError(`Couldn't insert that image.\n\n${String(err)}`);
    }
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <Btn icon="undo" title={`Undo (${MOD}Z)`} disabled={!s.canUndo} onClick={() => chain().undo().run()} />
      <Btn icon="redo" title={`Redo (${MOD}${SHIFT}Z)`} disabled={!s.canRedo} onClick={() => chain().redo().run()} />
      <Sep />
      <select className="tb-select tb-style" value={s.block} onChange={(e) => setBlock(e.target.value)} aria-label="Styles" title="Styles">
        <option value="p">Normal text</option>
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
      </select>
      <Sep />
      <select className="tb-select tb-font" value={s.font} onChange={(e) => setFont(e.target.value)} aria-label="Font" title="Font">
        {!FONTS.some((f) => f.value === s.font) && <option value={s.font}>{s.font.split(",")[0].replace(/"/g, "")}</option>}
        {FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
      </select>
      <Sep />
      <Btn icon="minus" title="Decrease font size" onClick={() => stepSize(-1)} />
      <input
        className="tb-size"
        value={sizeText}
        inputMode="numeric"
        aria-label="Font size"
        title="Font size"
        onChange={(e) => setSizeText(e.target.value.replace(/[^\d.]/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); setSize(parseFloat(sizeText)); }
          else if (e.key === "Escape") { setSizeText(String(s.size)); editor.commands.focus(); }
        }}
        onBlur={() => setSizeText(String(s.size))}
        onFocus={(e) => e.target.select()}
      />
      <Btn icon="plus" title="Increase font size" onClick={() => stepSize(1)} />
      <Sep />
      <Btn icon="bold" title={`Bold (${MOD}B)`} active={s.bold} onClick={() => chain().toggleBold().run()} />
      <Btn icon="italic" title={`Italic (${MOD}I)`} active={s.italic} onClick={() => chain().toggleItalic().run()} />
      <Btn icon="underline" title={`Underline (${MOD}U)`} active={s.underline} onClick={() => chain().toggleUnderline().run()} />
      <Btn icon="strike" title={`Strikethrough (${MOD}${SHIFT}X)`} active={s.strike} onClick={() => chain().toggleStrike().run()} />
      <ColorPicker
        icon="textColor" title="Text color" value={s.color} resetLabel="Automatic"
        onPick={(c) => (c ? chain().setColor(c).run() : chain().unsetColor().run())}
      />
      <ColorPicker
        icon="highlight" title="Highlight color" value={s.highlight} resetLabel="None"
        onPick={(c) => (c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run())}
      />
      <Sep />
      <Btn icon="link" title={`Insert link (${MOD}K)`} active={s.link} onClick={toggleLink} />
      <Btn icon="image" title="Insert image" onClick={() => void insertImage()} />
      <Sep />
      <Btn icon="alignLeft" title={`Left align (${MOD}${SHIFT}L)`} active={s.align === "left"} onClick={() => chain().setTextAlign("left").run()} />
      <Btn icon="alignCenter" title={`Center align (${MOD}${SHIFT}E)`} active={s.align === "center"} onClick={() => chain().setTextAlign("center").run()} />
      <Btn icon="alignRight" title={`Right align (${MOD}${SHIFT}R)`} active={s.align === "right"} onClick={() => chain().setTextAlign("right").run()} />
      <Btn icon="alignJustify" title={`Justify (${MOD}${SHIFT}J)`} active={s.align === "justify"} onClick={() => chain().setTextAlign("justify").run()} />
      <Sep />
      <Btn icon="bullets" title={`Bulleted list (${MOD}${SHIFT}8)`} active={s.bullet} onClick={() => chain().toggleBulletList().run()} />
      <Btn icon="numbers" title={`Numbered list (${MOD}${SHIFT}7)`} active={s.ordered} onClick={() => chain().toggleOrderedList().run()} />
      <Btn icon="quote" title={`Quote (${MOD}${SHIFT}B)`} active={s.quote} onClick={() => chain().toggleBlockquote().run()} />
      <Btn icon="outdent" title={`Decrease indent (${SHIFT}Tab)`} disabled={!s.canOutdent} onClick={() => chain().liftListItem("listItem").run()} />
      <Btn icon="indent" title="Increase indent (Tab)" disabled={!s.canIndent} onClick={() => chain().sinkListItem("listItem").run()} />
      <Sep />
      <Btn icon="clear" title="Clear formatting" onClick={() => chain().unsetAllMarks().unsetTextAlign().run()} />
    </div>
  );
}
