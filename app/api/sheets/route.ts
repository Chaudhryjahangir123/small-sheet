import { NextResponse } from "next/server";
import { readStore, writeStore } from "../../../lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = await readStore();
  return NextResponse.json(store.sheets.map(({ id, name }) => ({ id, name })));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const store = await readStore();
  let n = store.sheets.length + 1;
  while (store.sheets.some((s) => s.id === `sheet-${n}`)) n++;
  const name = String(body.name ?? "").trim().slice(0, 40) || `Sheet ${n}`;
  const sheet = { id: `sheet-${n}`, name, cells: [] };
  store.sheets.push(sheet);
  await writeStore(store);
  return NextResponse.json({ id: sheet.id, name: sheet.name });
}