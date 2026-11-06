"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { addr, colToLabel } from "../lib/address";
import { COLS, ROWS, SheetModel, formatNumber } from "../lib/sheet";

const ROW_H = 28;
const COL_W = 96;
const HEAD_W = 56;
const HEAD_H = 28;
const OVERSCAN = 8;

type Pos = { r: number; c: number };
type Selection = { anchor: Pos; focus: Pos };
type Editing = { r: number; c: number; draft: string; from: "cell" | "bar" };

const COL_INDEXES = Array.from({ length: COLS }, (_, i) => i);
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

export default function Grid() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);

  // The model holds the data. "version" just makes React redraw after an edit.
  const [model] = useState(() => new SheetModel());
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
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

  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // When editing starts inside a cell, focus its input with the cursor at the end.
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

  const commitEdit = (value: string) => {
    if (!editing) return;
    const changed = model.setRaw(editing.r, editing.c, value);
    if (changed.length > 0) bump();
    setEditing(null);
  };

  const clearSelection = () => {
    const changed = model.clearRange(
      Math.min(sel.anchor.r, sel.focus.r),
      Math.min(sel.anchor.c, sel.focus.c),
      Math.max(sel.anchor.r, sel.focus.r),
      Math.max(sel.anchor.c, sel.focus.c)
    );
    if (changed.length > 0) bump();
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
        return startEdit(a.r, a.c, model.getRaw(a.r, a.c));
      case "Delete":
      case "Backspace":
        e.preventDefault();
        return clearSelection();
      case "Escape":
        return setSel({ anchor: a, focus: a });
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
  const top = Math.min(sel.anchor.r, sel.focus.r);
  const bottom = Math.max(sel.anchor.r, sel.focus.r);
  const left = Math.min(sel.anchor.c, sel.focus.c);
  const right = Math.max(sel.anchor.c, sel.focus.c);

  const stats = useMemo(() => {
    void version; // recompute after every edit
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

      <div className="statusBar">
        <span>{rangeLabel}</span>
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