"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Grid, { type History } from "./Grid";
import { addr, parseAddr } from "../lib/address";
import { COLS, ROWS, SheetModel, type Entry } from "../lib/sheet";
import { Saver, loadDraft, type SaveState } from "../lib/saver";

type SheetMeta = { id: string; name: string };
type Pos = { r: number; c: number };
type Loaded = {
  id: string;
  model: SheetModel;
  hist: History;
  saver: Saver;
  start: Pos;
};
type Screen =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "notfound"; id: string }
  | { kind: "ready" };

const JSON_HEADERS = { "Content-Type": "application/json" };
const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved",
  saving: "Saving...",
  unsaved: "Unsaved changes",
  failed: "Save failed",
};

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  return { sheet: p.get("sheet"), cell: p.get("cell") };
}
const sheetUrl = (id: string, cell?: string) =>
  `?sheet=${encodeURIComponent(id)}${cell ? `&cell=${cell}` : ""}`;

export default function Workbook() {
  const [sheets, setSheets] = useState<SheetMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [, setEdits] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const openToken = useRef(0);
  const saverRef = useRef<Saver | null>(null);
  const renamingRef = useRef<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const openSheet = useCallback(async (id: string, cell: string | null) => {
    const token = ++openToken.current;
    saverRef.current?.dispose();
    saverRef.current = null;
    setLoaded(null);
    setActiveId(id);
    setScreen({ kind: "loading" });

    let res: Response;
    try {
      res = await fetch(`/api/sheet?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
    } catch {
      if (token === openToken.current)
        setScreen({ kind: "error", message: "The server could not be reached." });
      return;
    }
    if (token !== openToken.current) return;
    if (res.status === 404) {
      setScreen({ kind: "notfound", id });
      return;
    }
    if (!res.ok) {
      setScreen({ kind: "error", message: `The server answered with ${res.status}.` });
      return;
    }
    const data = (await res.json()) as {
      id: string;
      epoch: string;
      cells: Entry[];
    };
    if (token !== openToken.current) return;

    const draft = loadDraft(id, data.epoch);
    const model = new SheetModel();
    model.load(draft ?? data.cells);
    const saver = new Saver(id, data.epoch, model, setSaveState);
    saverRef.current = saver;
    setSaveState("saved");
    if (draft) saver.restoredFromDraft();

    const p = cell ? parseAddr(cell) : null;
    const ok = p && p.r >= 0 && p.r < ROWS && p.c >= 0 && p.c < COLS;
    setLoaded({
      id,
      model,
      hist: { undo: [], redo: [] },
      saver,
      start: ok ? p : { r: 0, c: 0 },
    });
    setScreen({ kind: "ready" });
  }, []);

  // First load: get the list of sheets, then open the one the URL names.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sheets", { cache: "no-store" });
        if (!res.ok) throw new Error("list failed");
        const list = (await res.json()) as SheetMeta[];
        if (cancelled) return;
        setSheets(list);
        const url = readUrl();
        const id = url.sheet ?? list[0]?.id;
        if (!id) {
          setScreen({ kind: "error", message: "There are no sheets." });
          return;
        }
        if (!url.sheet) window.history.replaceState(null, "", sheetUrl(id));
        openSheet(id, url.cell);
      } catch {
        if (!cancelled)
          setScreen({ kind: "error", message: "The server could not be reached." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openSheet]);

  // Browser Back and Forward.
  useEffect(() => {
    const onPop = () => {
      const u = readUrl();
      if (u.sheet) openSheet(u.sheet, u.cell);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [openSheet]);

  // Closing the tab: keep a copy of anything not yet saved.
  useEffect(() => {
    const persist = () => saverRef.current?.persist();
    window.addEventListener("pagehide", persist);
    return () => window.removeEventListener("pagehide", persist);
  }, []);

  const switchTo = (id: string) => {
    if (id === activeId) return;
    window.history.pushState(null, "", sheetUrl(id));
    openSheet(id, null);
  };

  const addSheet = async () => {
    try {
      const res = await fetch("/api/sheets", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: `Sheet ${sheets.length + 1}` }),
      });
      if (!res.ok) throw new Error("add failed");
      const meta = (await res.json()) as SheetMeta;
      setSheets((list) => [...list, meta]);
      switchTo(meta.id);
    } catch {
      setNotice("Could not add a sheet. Try again.");
    }
  };

  const startRename = (id: string) => {
    renamingRef.current = id;
    setRenaming(id);
  };

  const commitRename = async (id: string, value: string) => {
    if (renamingRef.current !== id) return;
    renamingRef.current = null;
    setRenaming(null);
    const name = value.trim().slice(0, 40);
    const old = sheets.find((s) => s.id === id)?.name;
    if (!name || name === old) return;
    setSheets((list) => list.map((s) => (s.id === id ? { ...s, name } : s)));
    try {
      const res = await fetch(`/api/sheet?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("rename failed");
    } catch {
      setSheets((list) =>
        list.map((s) => (s.id === id ? { ...s, name: old ?? s.name } : s))
      );
      setNotice("Could not rename the sheet.");
    }
  };

  let body;
  if (screen.kind === "loading") {
    body = (
      <div className="screen" role="status">
        <div className="spinner" aria-hidden="true" />
        <h2>Loading sheet</h2>
        <p>Big sheets can take a moment.</p>
      </div>
    );
  } else if (screen.kind === "error") {
    body = (
      <div className="screen" role="alert">
        <h2>Something went wrong</h2>
        <p>{screen.message}</p>
        <button className="btn" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  } else if (screen.kind === "notfound") {
    body = (
      <div className="screen" role="alert">
        <h2>That sheet does not exist</h2>
        <p>
          The address asked for &quot;{screen.id}&quot;. It may have been renamed
          or never existed.
        </p>
        {sheets[0] && (
          <button className="btn" onClick={() => switchTo(sheets[0].id)}>
            Open {sheets[0].name}
          </button>
        )}
      </div>
    );
  } else if (loaded) {
    body = (
      <>
        <Grid
          key={loaded.id}
          model={loaded.model}
          hist={loaded.hist}
          initialCell={loaded.start}
          onChange={() => {
            loaded.saver.edit();
            setEdits((n) => n + 1);
          }}
          onCellChange={(p) =>
            window.history.replaceState(null, "", sheetUrl(loaded.id, addr(p.c, p.r)))
          }
        />
        {loaded.model.size === 0 && (
          <div className="emptyHint">
            <b>This sheet is empty</b>
            <span>
              Click a cell and start typing, or paste a block from another
              spreadsheet.
            </span>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="workbook">
      <div className="tabsBar">
        <div className="tabs" role="tablist" aria-label="Sheets">
          {sheets.map((s) =>
            renaming === s.id ? (
              <input
                key={s.id}
                className="renameInput"
                autoFocus
                maxLength={40}
                defaultValue={s.name}
                aria-label="Sheet name"
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename(s.id, e.currentTarget.value);
                  } else if (e.key === "Escape") {
                    renamingRef.current = null;
                    setRenaming(null);
                  }
                }}
                onBlur={(e) => commitRename(s.id, e.currentTarget.value)}
              />
            ) : (
              <button
                key={s.id}
                role="tab"
                className="tab"
                aria-selected={s.id === activeId}
                title="Double-click to rename"
                onClick={() => switchTo(s.id)}
                onDoubleClick={() => startRename(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "F2") startRename(s.id);
                }}
              >
                {s.name}
              </button>
            )
          )}
          <button
            className="addTab"
            aria-label="Add sheet"
            title="Add sheet"
            onClick={addSheet}
          >
            +
          </button>
        </div>
        {notice && (
          <span className="notice" role="alert">
            {notice}
          </span>
        )}
        {loaded && screen.kind === "ready" && (
          <div className={`save ${saveState}`} role="status" aria-live="polite">
            <span className="dot" aria-hidden="true" />
            <span>{SAVE_LABEL[saveState]}</span>
            {saveState === "failed" && (
              <>
                <span className="saveHelp">Your changes are kept in this browser.</span>
                <button className="linkBtn" onClick={() => loaded.saver.retry()}>
                  Retry now
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="gridWrap">{body}</div>
    </div>
  );
}