import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";

/**
 * Page geometry in CSS px. A4 proportions (210 × 297 mm) at the editor's 760px width,
 * with 72px top/bottom margins (the .tiptap padding) and a gap between sheets.
 */
export const PAGE = { width: 760, height: 1075, margin: 72, gap: 32 };
export const PERIOD = PAGE.height + PAGE.gap;

/**
 * Pagination works on the rendered layout: after each change it measures every
 * line of text (and every unsplittable block such as an image or table), works
 * out which ones would cross a page's bottom margin, and inserts an invisible
 * spacer before each one so it starts at the top of the next sheet. Long
 * paragraphs split between lines, tables split between rows (repeating a header
 * row at the top of each new page), and images move as a whole.
 *
 * The spacers are decorations, so they never enter the document or the saved file.
 *
 * Table splitting (spacer rows, rowspan groups, repeated header) is adapted from
 * tiptap-a4-pagination, Copyright (c) Phan Nhật Huy, MIT License:
 * https://github.com/HuyPhan1232203/Text-editor-react/tree/main/packages/tiptap-a4-pagination
 */

/** Where a spacer sits: between blocks, inside a paragraph (between lines), or between table rows. */
type Kind = "block" | "inline" | "row";
type RowInfo = { columns: number; header?: string };

type Unit = {
  top: number; // relative to the editor root, without spacers
  bottom: number;
  breakPos: number; // where a spacer goes to push this unit to the next page
  kind: Kind;
  row?: RowInfo;
  extra: number; // room kept at the top of the new page (a repeated table header)
  measure: () => number | null; // current top of this unit, for the correction pass
};

type Break = { pos: number; kind: Kind; row?: RowInfo; height: number; target: number; measure: () => number | null };

const key = new PluginKey<DecorationSet>("pagination");

/** Move a break up to the outermost block it starts, so e.g. a list's first line breaks before the list. */
function hoist(doc: PMNode, pos: number): number {
  let $p = doc.resolve(pos);
  while ($p.depth > 0 && $p.index() === 0) {
    pos = $p.before();
    $p = doc.resolve(pos);
  }
  return pos;
}

type Line = { top: number; bottom: number; left: number };

function linesOf(el: HTMLElement): Line[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = Array.from(range.getClientRects())
    .filter((r) => r.height > 0)
    .sort((a, b) => a.top - b.top);
  const lines: Line[] = [];
  for (const r of rects) {
    const last = lines[lines.length - 1];
    if (last && r.top < last.bottom - 2) {
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
      last.left = Math.min(last.left, r.left);
    } else {
      lines.push({ top: r.top, bottom: r.bottom, left: r.left });
    }
  }
  if (!lines.length) {
    const r = el.getBoundingClientRect();
    lines.push({ top: r.top, bottom: r.bottom, left: r.left });
  }
  return lines;
}

/** Static copy of a header row with its measured cell widths, so the columns line up. */
function copyHeaderRow(row: HTMLElement): string {
  const clone = row.cloneNode(true) as HTMLElement;
  const cells = Array.from(row.children);
  Array.from(clone.children).forEach((cell, i) => {
    (cell as HTMLElement).style.width = `${cells[i].getBoundingClientRect().width}px`;
    cell.classList.remove("selectedCell");
  });
  clone.querySelectorAll(".column-resize-handle").forEach((n) => n.remove());
  return `<table><tbody>${clone.outerHTML}</tbody></table>`;
}

/**
 * A table becomes one unit per group of rows that mustn't be separated (rows
 * joined by a rowspan). The first group breaks before the whole table; later
 * groups break between rows with a spacer row.
 */
function tableUnits(view: EditorView, table: PMNode, pos: number, base: number, rootTop: () => number): Unit[] {
  const el = view.nodeDOM(pos);
  if (!(el instanceof HTMLElement)) return [];
  const { doc } = view.state;
  const box = el.getBoundingClientRect();
  const map = TableMap.get(table);
  const groups: { pos: number; top: number; bottom: number }[] = [];
  let firstGroupRows = 0;
  let firstRow: HTMLElement | null = null;

  let index = 0;
  table.forEach((_row, offset) => {
    const i = index++;
    const rowPos = pos + 1 + offset;
    const dom = view.nodeDOM(rowPos);
    if (!(dom instanceof HTMLElement)) return;
    const r = dom.getBoundingClientRect();
    // A cell from the row above reaching into this one (rowspan) joins the two rows.
    const joined = i > 0 && map.map
      .slice(i * map.width, (i + 1) * map.width)
      .some((cell, col) => cell === map.map[(i - 1) * map.width + col]);
    if (joined && groups.length) groups[groups.length - 1].bottom = r.bottom - base;
    else groups.push({ pos: rowPos, top: r.top - base, bottom: r.bottom - base });
    if (groups.length === 1) { firstGroupRows++; firstRow ??= dom; }
  });

  const whole: Unit = {
    top: box.top - base,
    bottom: box.bottom - base,
    breakPos: hoist(doc, pos),
    kind: "block",
    extra: 0,
    measure: () => {
      const cur = view.nodeDOM(pos);
      return cur instanceof HTMLElement ? cur.getBoundingClientRect().top - rootTop() : null;
    },
  };
  if (groups.length < 2) return [whole];

  // Repeat the first row on each new page if it's a header row on its own.
  const head = table.firstChild;
  const isHeader = firstGroupRows === 1 && firstRow && head && head.childCount > 0
    && Array.from({ length: head.childCount }, (_, i) => head.child(i)).every((c) => c.type.name === "tableHeader");
  const header = isHeader ? { html: copyHeaderRow(firstRow!), height: firstRow!.getBoundingClientRect().height } : null;

  groups[groups.length - 1].bottom = box.bottom - base;
  return groups.map((g, i) => i === 0
    ? { ...whole, bottom: g.bottom }
    : {
      top: g.top,
      bottom: g.bottom,
      breakPos: g.pos,
      kind: "row" as const,
      row: { columns: map.width, header: header?.html },
      extra: header?.height ?? 0,
      measure: () => {
        const cur = view.nodeDOM(g.pos);
        return cur instanceof HTMLElement ? cur.getBoundingClientRect().top - rootTop() : null;
      },
    });
}

function collectUnits(view: EditorView): Unit[] {
  const { doc } = view.state;
  const rootTop = () => view.dom.getBoundingClientRect().top;
  const base = rootTop();
  const caretTop = (p: number) => () => {
    try { return view.coordsAtPos(p, 1).top - rootTop(); } catch { return null; }
  };
  const units: Unit[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === "table") {
      units.push(...tableUnits(view, node, pos, base, rootTop));
      return false;
    }
    // Blocks that can't be split across pages
    if (node.isBlock && node.isAtom) {
      const el = view.nodeDOM(pos);
      if (el instanceof HTMLElement) {
        const r = el.getBoundingClientRect();
        units.push({
          top: r.top - base,
          bottom: r.bottom - base,
          breakPos: hoist(doc, pos),
          kind: "block",
          extra: 0,
          measure: () => {
            const cur = view.nodeDOM(pos);
            return cur instanceof HTMLElement ? cur.getBoundingClientRect().top - rootTop() : null;
          },
        });
      }
      return false;
    }
    if (!node.isTextblock) return true; // lists, list items, blockquotes: look inside

    const el = view.nodeDOM(pos);
    if (!(el instanceof HTMLElement)) return false;
    const start = pos + 1;
    const end = pos + node.nodeSize - 1;
    linesOf(el).forEach((line, i) => {
      const top = line.top - base;
      const bottom = line.bottom - base;
      if (i === 0) {
        units.push({ top, bottom, breakPos: hoist(doc, pos), kind: "block", extra: 0, measure: caretTop(start) });
        return;
      }
      const hit = view.posAtCoords({ left: line.left + 1, top: (line.top + line.bottom) / 2 });
      if (!hit || hit.pos <= start || hit.pos >= end) {
        // Can't find where this line starts: keep it with the previous line.
        units[units.length - 1].bottom = bottom;
        return;
      }
      units.push({ top, bottom, breakPos: hit.pos, kind: "inline", extra: 0, measure: caretTop(hit.pos) });
    });
    return false;
  });
  return units;
}

function paginate(units: Unit[]): { breaks: Break[]; pages: number } {
  const limit = (k: number) => k * PERIOD + PAGE.height - PAGE.margin;
  const breaks: Break[] = [];
  let page = 0;
  let shift = 0;
  let first = true;
  let lastBottom = 0;
  for (const u of units) {
    const top = u.top + shift;
    const bottom = u.bottom + shift;
    if (bottom > limit(page) + 0.5 && !first) {
      let next = page + 1;
      while (next * PERIOD + PAGE.margin < top) next++; // after an oversized block
      // A repeated table header takes the first lines of the new page.
      const target = next * PERIOD + PAGE.margin + u.extra;
      const height = Math.max(0, target - top);
      breaks.push({ pos: u.breakPos, kind: u.kind, row: u.row, height, target, measure: u.measure });
      shift += height;
      page = next;
      lastBottom = u.bottom + shift;
    } else {
      lastBottom = bottom;
    }
    first = false;
  }
  // A block taller than a page can spill onto further sheets.
  const pages = Math.max(page + 1, Math.ceil((lastBottom + PAGE.margin) / PERIOD));
  return { breaks, pages };
}

function spacer(b: Break): HTMLElement {
  if (b.kind === "row" && b.row) {
    // Inside a table the spacer is a full-width row; a repeated header sits at its bottom.
    const tr = document.createElement("tr");
    tr.className = "page-break page-break-row";
    tr.contentEditable = "false";
    const td = document.createElement("td");
    td.className = "page-break-cell";
    td.colSpan = b.row.columns; // exact count: with table-layout: fixed, more would add phantom columns
    td.style.height = `${b.height}px`;
    if (b.row.header) {
      const header = document.createElement("div");
      header.className = "page-break-header";
      header.innerHTML = b.row.header;
      td.appendChild(header);
    }
    tr.appendChild(td);
    return tr;
  }
  const el = document.createElement(b.kind === "inline" ? "span" : "div");
  el.className = "page-break";
  el.style.height = `${b.height}px`;
  el.contentEditable = "false";
  return el;
}

/** Short hash so widget keys change when a repeated header's content changes. */
function hash(text: string): string {
  let v = 0;
  for (let i = 0; i < text.length; i++) v = (v * 31 + text.charCodeAt(i)) | 0;
  return (v >>> 0).toString(36);
}

function decorations(view: EditorView, breaks: Break[]): DecorationSet {
  return DecorationSet.create(
    view.state.doc,
    breaks.map((b) =>
      Decoration.widget(b.pos, () => spacer(b), {
        side: -1,
        ignoreSelection: true,
        key: `pb:${b.pos}:${b.kind}:${b.height.toFixed(1)}:${b.row ? `${b.row.columns}:${hash(b.row.header ?? "")}` : ""}`,
      }),
    ),
  );
}

function relayout(view: EditorView, followCaret: boolean): number {
  const scroller = view.dom.closest(".canvas") as HTMLElement | null;
  const scrollTop = scroller?.scrollTop ?? 0;
  const set = (d: DecorationSet) => view.dispatch(view.state.tr.setMeta(key, d).setMeta("addToHistory", false));

  // Everything below happens synchronously in one frame, so nothing flickers.
  set(DecorationSet.empty);
  const { breaks, pages } = paginate(collectUnits(view));
  set(decorations(view, breaks));

  // Spacers change neighbouring margins slightly; nudge each break so its
  // content lands exactly on the next page's top margin.
  let acc = 0;
  let adjusted = false;
  for (const b of breaks) {
    const top = b.measure();
    if (top == null) continue;
    const err = b.target - (top + acc);
    if (Math.abs(err) > 0.5) {
      b.height = Math.max(0, b.height + err);
      acc += err;
      adjusted = true;
    }
  }
  if (adjusted) set(decorations(view, breaks));

  if (scroller) {
    scroller.scrollTop = scrollTop;
    // Typing past the bottom of a page moves the caret to the next one; keep it visible.
    if (followCaret && view.hasFocus() && view.state.selection.empty) {
      try {
        const c = view.coordsAtPos(view.state.selection.head);
        const r = scroller.getBoundingClientRect();
        if (c.bottom > r.bottom) scroller.scrollTop += c.bottom - r.bottom + 24;
        else if (c.top < r.top) scroller.scrollTop -= r.top - c.top + 24;
      } catch { /* position not rendered */ }
    }
  }
  return pages;
}

export const Pagination = Extension.create<{ onPages?: (pages: number) => void }>({
  name: "pagination",
  addOptions: () => ({ onPages: undefined }),
  addProseMirrorPlugins() {
    const { onPages } = this.options;
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => (tr.getMeta(key) as DecorationSet | undefined) ?? set.map(tr.mapping, tr.doc),
        },
        props: { decorations: (state) => key.getState(state) },
        view(view) {
          let frame = 0;
          let followCaret = false;
          let lastPages = -1;
          let lastWidth = 0;
          const run = () => {
            frame = 0;
            if (view.isDestroyed) return;
            const pages = relayout(view, followCaret);
            followCaret = false;
            if (pages !== lastPages) onPages?.((lastPages = pages));
          };
          const schedule = () => { if (!frame) frame = requestAnimationFrame(run); };
          // Re-flow when the page width changes (narrow windows) or fonts finish loading.
          const ro = new ResizeObserver(([e]) => {
            if (Math.abs(e.contentRect.width - lastWidth) > 0.5) { lastWidth = e.contentRect.width; schedule(); }
          });
          ro.observe(view.dom);
          void document.fonts?.ready.then(schedule);
          // Images change height when they finish loading, without a document change.
          view.dom.addEventListener("load", schedule, true);
          schedule();
          return {
            update(v, prev) {
              if (v.state.doc !== prev.doc) { followCaret = true; schedule(); }
            },
            destroy() { cancelAnimationFrame(frame); ro.disconnect(); view.dom.removeEventListener("load", schedule, true); },
          };
        },
      }),
    ];
  },
});
