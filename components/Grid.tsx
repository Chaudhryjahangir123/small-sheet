"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { colToLabel } from "../lib/address";

const ROWS = 10000;
const COLS = 26;
const ROW_H = 28;
const COL_W = 96;
const HEAD_W = 56;
const HEAD_H = 28;
const OVERSCAN = 8;

type Pos = { r: number; c: number };
type Selection = { anchor: Pos; focus: Pos };
type Editing = { r: number; c: number; draft: string };

const COL_INDEXES = Array.from({ length: COLS }, (_, i) => i);
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
const cellKey = (r: number, c: number) => `${r},${c}`;

export default function Grid() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  // What the user typed, keyed by "row,col". Empty cells are simply absent.
  const [cells, setCells] = useState<Record<string, string>>({});
  // The active cell is the anchor. The selected range runs anchor -> focus.
  const [sel, setSel] = useState<Selection>({
    anchor: { r: 0, c: 0 },
    focus: { r: 0, c: 0 },
  });
  const [editing, setEditing] = useState<Editing | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => setViewH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Stop dragging when the mouse is released anywhere on the page.
  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // When editing starts, put the cursor in the input at the end of the text.
  const isEditing = editing !== null;
  useEffect(() => {
    const el = inputRef.current;
    if (isEditing && el) {
      el.focus();
      const n = el.value.length;
      el.setSelectionRange(n, n);
    }
  }, [isEditing]);

  // Scroll just enough so the given cell is fully visible.
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

  const moveTo = (r: number, c: number, extend: boolean) => {
    const pos = { r: clamp(r, 0, ROWS - 1), c: clamp(c, 0, COLS - 1) };
    setSel((s) =>
      extend ? { anchor: s.anchor, focus: pos } : { anchor: pos, focus: pos }
    );
    ensureVisible(pos.r, pos.c);
  };

  const startEdit = (r: number, c: number, draft: string) => {
    setEditing({ r, c, draft });
  };

  const commitEdit = (value: string) => {
    if (!editing) return;
    const k = cellKey(editing.r, editing.c);
    setCells((prev) => {
      const next = { ...prev };
      if (value === "") delete next[k];
      else next[k] = value;
      return next;
    });
    setEditing(null);
  };

  const clearSelection = () => {
    const r1 = Math.min(sel.anchor.r, sel.focus.r);
    const r2 = Math.max(sel.anchor.r, sel.focus.r);
    const c1 = Math.min(sel.anchor.c, sel.focus.c);
    const c2 = Math.max(sel.anchor.c, sel.focus.c);
    setCells((prev) => {
      const next = { ...prev };
      for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++) delete next[cellKey(r, c)];
      return next;
    });
  };

  // ---- keyboard while NOT editing ----
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
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
        return startEdit(a.r, a.c, cells[cellKey(a.r, a.c)] ?? "");
      case "Delete":
      case "Backspace":
        e.preventDefault();
        return clearSelection();
      case "Escape":
        return setSel({ anchor: a, focus: a });
    }
    // Typing a normal character starts editing and replaces what was there.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      startEdit(a.r, a.c, e.key);
    }
  };

  // ---- keyboard while editing (inside the input) ----
  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
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

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).tagName === "INPUT") return;
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
    const p = cellFromEvent(e);
    if (p) startEdit(p.r, p.c, cells[cellKey(p.r, p.c)] ?? "");
  };

  // ---- what to draw ----
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(
    ROWS - 1,
    Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN
  );
  const rows: number[] = [];
  for (let r = first; r <= last; r++) rows.push(r);

  const top = Math.min(sel.anchor.r, sel.focus.r);
  const bottom = Math.max(sel.anchor.r, sel.focus.r);
  const left = Math.min(sel.anchor.c, sel.focus.c);
  const right = Math.max(sel.anchor.c, sel.focus.c);

  return (
    <div
      ref={scrollerRef}
      className="scroller"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onDoubleClick={onDoubleClick}
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
                const raw = cells[cellKey(r, c)] ?? "";
                const inRange = r >= top && r <= bottom && c >= left && c <= right;
                const isActive = r === sel.anchor.r && c === sel.anchor.c;
                const isEditingHere =
                  editing !== null && editing.r === r && editing.c === c;
                const isNumber = raw !== "" && !isNaN(Number(raw));

                let cls = "cell";
                if (isNumber) cls += " num";
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
                    {isEditingHere ? (
                      <input
                        ref={inputRef}
                        className="cellInput"
                        value={editing.draft}
                        onChange={(e) =>
                          setEditing({ ...editing, draft: e.target.value })
                        }
                        onKeyDown={onInputKeyDown}
                        aria-label={`Edit ${colToLabel(c)}${r + 1}`}
                      />
                    ) : (
                      raw
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}