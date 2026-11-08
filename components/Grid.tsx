"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { addr, colToLabel } from "../lib/address";
import {
  COLS,
  ROWS,
  formatNumber,
  type Change,
  type SheetModel,
} from "../lib/sheet";

const ROW_H = 28;
const COL_W = 112;
const HEAD_W = 56;
const HEAD_H = 28;
const OVERSCAN = 8;

// Limits for pasted data. Anything bigger is refused with a message.
const MAX_PASTE_CHARS = 20_000_000;
const MAX_PASTE_CELLS = 200_000;
const MAX_CELL_LEN = 5000;

type Pos = { r: number; c: number };
type Selection = { anchor: Pos; focus: Pos };
type Editing = { r: number; c: number; draft: string; from: "cell" | "bar" };

export type History = { undo: Change[][]; redo: Change[][] };

type Props = {
  model: SheetModel;
  hist: History;
  initialCell?: Pos;
  onChange?: () => void;
  onCellChange?: (p: Pos) => void;
};

const COL_INDEXES = Array.from({ length: COLS }, (_, i) => i);
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

// Turn clipboard text (tabs between cells, newlines between rows) into rows.
function parseClipboard(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) =>
    line.split("\t").map((v) => v.slice(0, MAX_CELL_LEN))
  );
}

export default function Grid({
  model,
  hist,
  initialCell,
  onChange,
  onCellChange,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);

  const [version, setVersion] = useState(0);
  const bump = () => {
    setVersion((v) => v + 1);
    onChange?.();
  };

  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const [sel, setSel] = useState<Selection>(() => {
    const p = initialCell ?? { r: 0, c: 0 };
    return { anchor: p, focus: p };
  });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => setViewH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const editFrom = editing?.from;
  useEffect(() => {
    const el = inputRef.current;
    if (editFrom === "cell" && el) {
      el.focus();
      const n = el.value.length;
      el.setSelectionRange(n, n);
    }
  }, [editFrom]);

  const ensureVisible = useCallback((r: number, c: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const top = r * ROW_H;
    const bottom = (r + 1) * ROW_H;
    const visibleH = el.clientHeight - HEAD_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + visibleH) el.scrollTop = bottom - visibleH;

    const left = c * COL_W;
    const right = (c + 1) * COL_W;
    const visibleW = el.clientWidth - HEAD_W;
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (right > el.scrollLeft + visibleW)
      el.scrollLeft = right - visibleW;
  }, []);

  // Scroll to the starting cell once, when the grid first appears.
  useEffect(() => {
    if (initialCell) ensureVisible(initialCell.r, initialCell.c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tell the page which cell is active, so the URL can say so.
  const activeR = sel.anchor.r;
  const activeC = sel.anchor.c;
  useEffect(() => {
    onCellChange?.({ r: activeR, c: activeC });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeR, activeC]);

  const moveTo = (r: number, c: number, extend: boolean) => {
    const pos = { r: clamp(r, 0, ROWS - 1), c: clamp(c, 0, COLS - 1) };
    setSel((s) =>
      extend ? { anchor: s.anchor, focus: pos } : { anchor: pos, focus: pos }
    );
    ensureVisible(pos.r, pos.c);
  };

  const startEdit = (
    r: number,
    c: number,
    draft: string,
    from: "cell" | "bar" = "cell"
  ) => setEditing({ r, c, draft, from });

  // Every real change goes through here, so undo sees it as one step.
  const record = (changes: Change[]) => {
    if (changes.length === 0) return;
    hist.undo.push(changes);
    hist.redo.length = 0; // a new edit makes the old redo steps invalid
    bump();
  };

  const commitEdit = (value: string) => {
    if (!editing) return;
    record(model.setRaw(editing.r, editing.c, value));
    setEditing(null);
  };

  const bounds = () => ({
    top: Math.min(sel.anchor.r, sel.focus.r),
    bottom: Math.max(sel.anchor.r, sel.focus.r),
    left: Math.min(sel.anchor.c, sel.focus.c),
    right: Math.max(sel.anchor.c, sel.focus.c),
  });

  const clearSelection = () => {
    const b = bounds();
    record(model.clearRange(b.top, b.left, b.bottom, b.right));
  };

  // ---- undo and redo ----
  const jumpTo = (batch: Change[]) => {
    let r1 = ROWS;
    let r2 = 0;
    let c1 = COLS;
    let c2 = 0;
    for (const ch of batch) {
      r1 = Math.min(r1, ch.r);
      r2 = Math.max(r2, ch.r);
      c1 = Math.min(c1, ch.c);
      c2 = Math.max(c2, ch.c);
    }
    setSel({ anchor: { r: r1, c: c1 }, focus: { r: r2, c: c2 } });
    ensureVisible(r1, c1);
  };

  const undo = () => {
    const batch = hist.undo.pop();
    if (!batch) return;
    model.apply(batch.map((ch) => ({ ...ch, after: ch.before })));
    hist.redo.push(batch);
    jumpTo(batch);
    bump();
  };

  const redo = () => {
    const batch = hist.redo.pop();
    if (!batch) return;
    model.apply(batch);
    hist.undo.push(batch);
    jumpTo(batch);
    bump();
  };

  // ---- copy, cut, paste ----
  const selectionText = () => {
    const b = bounds();
    const lines: string[] = [];
    for (let r = b.top; r <= b.bottom; r++) {
      const row: string[] = [];
      for (let c = b.left; c <= b.right; c++) row.push(model.getRaw(r, c));
      lines.push(row.join("\t"));
    }
    return lines.join("\n");
  };

  const onCopy = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing) return; // let the text box copy normally
    e.preventDefault();
    e.clipboardData.setData("text/plain", selectionText());
  };

  const onCut = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", selectionText());
    clearSelection();
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing) return;
    e.preventDefault();
    // We only ever read plain text. HTML from a web page never becomes markup.
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    if (text.length > MAX_PASTE_CHARS) {
      setNotice("That paste is too large. Nothing was pasted.");
      return;
    }
    const block = parseClipboard(text);
    let width = 0;
    for (const line of block) width = Math.max(width, line.length);
    if (block.length * width > MAX_PASTE_CELLS) {
      setNotice(
        `That paste is too large (limit ${MAX_PASTE_CELLS.toLocaleString()} cells). Nothing was pasted.`
      );
      return;
    }
    const a = sel.anchor;
    const changes: Change[] = [];
    let clipped = false;
    for (let i = 0; i < block.length; i++) {
      for (let j = 0; j < block[i].length; j++) {
        const r = a.r + i;
        const c = a.c + j;
        if (r >= ROWS || c >= COLS) {
          clipped = true;
          continue;
        }
        changes.push({ r, c, before: "", after: block[i][j] });
      }
    }
    record(model.apply(changes));
    setSel({
      anchor: a,
      focus: {
        r: Math.min(ROWS - 1, a.r + block.length - 1),
        c: Math.min(COLS - 1, a.c + width - 1),
      },
    });
    if (clipped)
      setNotice("Some pasted cells fell outside the sheet and were skipped.");
  };

  // ---- keyboard while NOT editing ----
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        return e.shiftKey ? redo() : undo();
      }
      if (k === "y") {
        e.preventDefault();
        return redo();
      }
      return; // let copy, cut and paste through
    }
    const base = e.shiftKey ? sel.focus : sel.anchor;
    const a = sel.anchor;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        return moveTo(base.r + 1, base.c, e.shiftKey);
      case "ArrowUp":
        e.preventDefault();
        return moveTo(base.r - 1, base.c, e.shiftKey);
      case "ArrowRight":
        e.preventDefault();
        return moveTo(base.r, base.c + 1, e.shiftKey);
      case "ArrowLeft":
        e.preventDefault();
        return moveTo(base.r, base.c - 1, e.shiftKey);
      case "Tab":
        e.preventDefault();
        return moveTo(a.r, a.c + (e.shiftKey ? -1 : 1), false);
      case "Enter":
      case "F2":
        e.preventDefault();
        return startEdit(a.r, a.c, model.getRaw(a.r, a.c));
      case "Delete":
      case "Backspace":
        e.preventDefault();
        return clearSelection();
      case "Escape":
        return setSel({ anchor: a, focus: a });
    }
    if (e.key.length === 1 && !e.altKey) {
      e.preventDefault();
      startEdit(a.r, a.c, e.key);
    }
  };

  // ---- keyboard while editing (cell input and formula bar share this) ----
  const onEditKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!editing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit(editing.draft);
      moveTo(editing.r + (e.shiftKey ? -1 : 1), editing.c, false);
      scrollerRef.current?.focus();
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitEdit(editing.draft);
      moveTo(editing.r, editing.c + (e.shiftKey ? -1 : 1), false);
      scrollerRef.current?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(null);
      scrollerRef.current?.focus();
    }
  };

  // ---- mouse ----
  const cellFromEvent = (e: MouseEvent): Pos | null => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
    if (!t) return null;
    return { r: Number(t.dataset.r), c: Number(t.dataset.c) };
  };
  const isInput = (e: MouseEvent) =>
    (e.target as HTMLElement).tagName === "INPUT";

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isInput(e)) return;
    const p = cellFromEvent(e);
    if (!p) return;
    e.preventDefault();
    if (editing) commitEdit(editing.draft);
    scrollerRef.current?.focus();
    dragging.current = true;
    setSel((s) =>
      e.shiftKey ? { anchor: s.anchor, focus: p } : { anchor: p, focus: p }
    );
  };

  const onMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const p = cellFromEvent(e);
    if (!p) return;
    setSel((s) =>
      s.focus.r === p.r && s.focus.c === p.c
        ? s
        : { anchor: s.anchor, focus: p }
    );
  };

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (isInput(e)) return;
    const p = cellFromEvent(e);
    if (p) startEdit(p.r, p.c, model.getRaw(p.r, p.c));
  };

  // ---- what to draw ----
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(
    ROWS - 1,
    Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN
  );
  const rows: number[] = [];
  for (let r = first; r <= last; r++) rows.push(r);

  const a = sel.anchor;
  const { top, bottom, left, right } = bounds();

  const stats = useMemo(() => {
    void version;
    return model.stats(top, left, bottom, right);
  }, [model, version, top, bottom, left, right]);

  const rangeLabel =
    top === bottom && left === right
      ? addr(left, top)
      : `${addr(left, top)}:${addr(right, bottom)}`;

  const barValue = editing ? editing.draft : model.getRaw(a.r, a.c);

  return (
    <div className="sheet">
      <div className="formulaBar">
        <div className="tools">
          <button
            className="tbtn"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            disabled={hist.undo.length === 0}
            onClick={() => {
              undo();
              scrollerRef.current?.focus();
            }}
          >
            ↶
          </button>
          <button
            className="tbtn"
            aria-label="Redo"
            title="Redo (Ctrl+Y)"
            disabled={hist.redo.length === 0}
            onClick={() => {
              redo();
              scrollerRef.current?.focus();
            }}
          >
            ↷
          </button>
        </div>
        <div className="addrBox" aria-label="Active cell">
          {addr(a.c, a.r)}
        </div>
        <span className="fx" aria-hidden="true">
          fx
        </span>
        <input
          className="barInput"
          aria-label="Formula bar"
          value={barValue}
          onFocus={() => {
            if (!editing)
              startEdit(a.r, a.c, model.getRaw(a.r, a.c), "bar");
            else if (editing.from !== "bar")
              setEditing({ ...editing, from: "bar" });
          }}
          onChange={(e) =>
            editing
              ? setEditing({ ...editing, draft: e.target.value })
              : startEdit(a.r, a.c, e.target.value, "bar")
          }
          onKeyDown={onEditKeyDown}
        />
      </div>

      <div
        ref={scrollerRef}
        className="scroller"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onDoubleClick={onDoubleClick}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        role="grid"
        aria-label="Spreadsheet"
        aria-rowcount={ROWS + 1}
        aria-colcount={COLS}
      >
        <div style={{ width: HEAD_W + COLS * COL_W }}>
          <div className="headerRow" style={{ height: HEAD_H }}>
            <div className="corner" style={{ width: HEAD_W }} />
            {COL_INDEXES.map((c) => (
              <div
                key={c}
                className={c >= left && c <= right ? "colHead hl" : "colHead"}
                style={{ width: COL_W }}
              >
                {colToLabel(c)}
              </div>
            ))}
          </div>

          <div style={{ height: ROWS * ROW_H, position: "relative" }}>
            {rows.map((r) => (
              <div
                key={r}
                className="row"
                style={{ top: r * ROW_H, height: ROW_H }}
                role="row"
                aria-rowindex={r + 2}
              >
                <div
                  className={r >= top && r <= bottom ? "rowHead hl" : "rowHead"}
                  style={{ width: HEAD_W }}
                >
                  {r + 1}
                </div>
                {COL_INDEXES.map((c) => {
                  const info = model.cellInfo(r, c);
                  const inRange =
                    r >= top && r <= bottom && c >= left && c <= right;
                  const isActive = r === a.r && c === a.c;
                  const isEditingHere =
                    editing !== null && editing.r === r && editing.c === c;

                  let cls = "cell";
                  if (info.kind === "number") cls += " num";
                  if (info.kind === "error") cls += " err";
                  else if (info.formula) cls += " computed";
                  if (inRange) cls += " selected";
                  if (isActive) cls += " active";
                  if (isEditingHere) cls += " editing";

                  return (
                    <div
                      key={c}
                      id={`cell-${r}-${c}`}
                      className={cls}
                      style={{ width: COL_W }}
                      role="gridcell"
                      aria-selected={inRange}
                      aria-colindex={c + 1}
                      data-r={r}
                      data-c={c}
                    >
                      {isEditingHere && editing.from === "cell" ? (
                        <input
                          ref={inputRef}
                          className="cellInput"
                          value={editing.draft}
                          onChange={(e) =>
                            setEditing({ ...editing, draft: e.target.value })
                          }
                          onKeyDown={onEditKeyDown}
                          aria-label={`Edit ${colToLabel(c)}${r + 1}`}
                        />
                      ) : isEditingHere ? (
                        editing.draft
                      ) : (
                        info.text
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {`${addr(a.c, a.r)}, ${model.cellInfo(a.r, a.c).text || "empty"}`}
      </div>

      <div className="statusBar">
        <span>{rangeLabel}</span>
        {notice && (
          <span className="notice" role="status">
            {notice}
          </span>
        )}
        <span className="grow" />
        <span>
          Sum <b>{formatNumber(stats.sum)}</b>
        </span>
        <span>
          Average <b>{stats.avg === null ? "-" : formatNumber(stats.avg)}</b>
        </span>
        <span>
          Count <b>{stats.count}</b>
        </span>
      </div>
    </div>
  );
}