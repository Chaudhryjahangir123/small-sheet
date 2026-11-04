"use client";

import { useEffect, useRef, useState } from "react";
import { colToLabel } from "../lib/address";
const styles: Record<string, string> = new Proxy(
  {},
  { get: (_target, key) => String(key) }
);

const ROWS = 10000;
const COLS = 26;
const ROW_H = 28;
const COL_W = 96;
const HEAD_W = 56;
const HEAD_H = 28;
const OVERSCAN = 8;

export default function Grid() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => setViewH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Only render the rows that are actually on screen (plus a few extra).
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(
    ROWS - 1,
    Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN
  );

  const cols = Array.from({ length: COLS }, (_, c) => c);
  const rows: number[] = [];
  for (let r = first; r <= last; r++) rows.push(r);

  return (
    <div
      ref={scrollerRef}
      className={styles.scroller}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      role="grid"
      aria-rowcount={ROWS + 1}
      aria-colcount={COLS}
    >
      <div style={{ width: HEAD_W + COLS * COL_W }}>
        <div className={styles.headerRow} style={{ height: HEAD_H }}>
          <div className={styles.corner} style={{ width: HEAD_W }} />
          {cols.map((c) => (
            <div key={c} className={styles.colHead} style={{ width: COL_W }}>
              {colToLabel(c)}
            </div>
          ))}
        </div>

        <div style={{ height: ROWS * ROW_H, position: "relative" }}>
          {rows.map((r) => (
            <div
              key={r}
              className={styles.row}
              style={{ top: r * ROW_H, height: ROW_H }}
              role="row"
            >
              <div className={styles.rowHead} style={{ width: HEAD_W }}>
                {r + 1}
              </div>
              {cols.map((c) => (
                <div
                  key={c}
                  className={styles.cell}
                  style={{ width: COL_W }}
                  role="gridcell"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}