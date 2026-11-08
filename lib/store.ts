import { promises as fs } from "fs";
import path from "path";
import { FIXTURES } from "./fixtures";
import type { Entry } from "./sheet";

export type StoredSheet = { id: string; name: string; cells: Entry[] };
export type Store = { epoch: string; sheets: StoredSheet[] };

const FILE = path.join(process.cwd(), "data", "store.json");

export async function writeStore(store: Store): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(store));
}

// If there is no saved file, build the fixtures. Same fixtures every time.
export async function readStore(): Promise<Store> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Store;
  } catch {
    const store: Store = {
      epoch: String(Date.now()),
      sheets: FIXTURES.map((f) => ({ id: f.id, name: f.name, cells: f.build() })),
    };
    await writeStore(store);
    return store;
  }
}