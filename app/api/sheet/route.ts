import { NextResponse } from "next/server";
import { readStore, writeStore } from "../../../lib/store";
import { COLS, ROWS, type Entry } from "../../../lib/sheet";

export const dynamic = "force-dynamic";

const idOf = (request: Request) =>
  new URL(request.url).searchParams.get("id") ?? "";

// Never trust the browser: check every cell before storing it.
function cleanCells(input: unknown): Entry[] | null {
  if (!Array.isArray(input) || input.length > 300_000) return null;
  const out: Entry[] = [];
  for (const e of input) {
    if (!Array.isArray(e) || e.length !== 3) return null;
    const [r, c, raw] = e;
    if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
    if (typeof raw !== "string" || raw.length > 5000) return null;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    out.push([r, c, raw]);
  }
  return out;
}

export async function GET(request: Request) {
  const store = await readStore();
  const sheet = store.sheets.find((s) => s.id === idOf(request));
  if (!sheet) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ...sheet, epoch: store.epoch });
}

// THE SAVE HANDLER. Slow on purpose (0.3 to 1.5 seconds) and it fails
// about one time in five on purpose. Do not remove this.
export async function PUT(request: Request) {
  await new Promise((done) => setTimeout(done, 300 + Math.random() * 1200));
  if (Math.random() < 0.2) {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
  const body = (await request.json().catch(() => null)) as { cells?: unknown } | null;
  const cells = cleanCells(body?.cells);
  if (!cells) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const store = await readStore();
  const sheet = store.sheets.find((s) => s.id === idOf(request));
  if (!sheet) return NextResponse.json({ error: "not_found" }, { status: 404 });
  sheet.cells = cells;
  await writeStore(store);
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = String(body?.name ?? "").trim().slice(0, 40);
  if (!name) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const store = await readStore();
  const sheet = store.sheets.find((s) => s.id === idOf(request));
  if (!sheet) return NextResponse.json({ error: "not_found" }, { status: 404 });
  sheet.name = name;
  await writeStore(store);
  return NextResponse.json({ ok: true });
}