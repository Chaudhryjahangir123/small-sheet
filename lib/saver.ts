import type { Entry, SheetModel } from "./sheet";

export type SaveState = "saved" | "unsaved" | "saving" | "failed";

const draftKey = (id: string) => `smallsheet:draft:${id}`;

// A draft is a copy of unsaved work, kept in this browser. It survives a reload.
export function loadDraft(id: string, epoch: string): Entry[] | null {
  try {
    const text = localStorage.getItem(draftKey(id));
    if (!text) return null;
    const d = JSON.parse(text) as { epoch: string; entries: Entry[] };
    return d.epoch === epoch && Array.isArray(d.entries) ? d.entries : null;
  } catch {
    return null;
  }
}

export class Saver {
  private id: string;
  private epoch: string;
  private model: SheetModel;
  private onState: (s: SaveState) => void;
  private edited = 0; // how many edits the user has made
  private saved = 0; // how many of them the server has
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private dead = false;

  constructor(
    id: string,
    epoch: string,
    model: SheetModel,
    onState: (s: SaveState) => void
  ) {
    this.id = id;
    this.epoch = epoch;
    this.model = model;
    this.onState = onState;
  }

  // The user changed something.
  edit() {
    this.edited++;
    if (!this.inFlight) this.onState("unsaved");
    this.schedule(700);
  }

  // We found unsaved work from a previous visit.
  restoredFromDraft() {
    this.edited = 1;
    this.onState("unsaved");
    this.schedule(300);
  }

  retry() {
    this.schedule(0);
  }

  persist() {
    if (this.edited > this.saved) this.writeDraft();
  }

  dispose() {
    this.persist();
    this.dead = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(ms: number) {
    if (this.dead) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  private writeDraft() {
    try {
      localStorage.setItem(
        draftKey(this.id),
        JSON.stringify({ epoch: this.epoch, entries: this.model.entries() })
      );
    } catch {
      // storage full or blocked: the save still goes to the server
    }
  }

  private clearDraft() {
    try {
      localStorage.removeItem(draftKey(this.id));
    } catch {
      // ignore
    }
  }

  private async flush(): Promise<void> {
    if (this.dead || this.inFlight || this.edited === this.saved) return;
    const target = this.edited;
    this.inFlight = true;
    this.onState("saving");
    this.writeDraft(); // keep a copy first, so a failed save loses nothing
    let ok = false;
    try {
      const res = await fetch(`/api/sheet?id=${encodeURIComponent(this.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells: this.model.entries() }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    this.inFlight = false;
    if (ok) this.saved = target;
    if (this.dead) {
      if (this.edited === this.saved) this.clearDraft();
      return;
    }
    if (!ok) {
      this.onState("failed");
      return;
    }
    if (this.edited > this.saved) {
      // the user kept typing while the save was in flight: save again
      this.onState("unsaved");
      this.schedule(0);
    } else {
      this.clearDraft();
      this.onState("saved");
    }
  }
}