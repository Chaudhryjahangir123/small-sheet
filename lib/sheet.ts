export const ROWS = 10000;
export const COLS = 26;

export type CellErr = { err: string };
export type Value = number | string | CellErr;
export type Change = { r: number; c: number; before: string; after: string };
export type CellInfo = {
  text: string;
  kind: "empty" | "text" | "number" | "error";
  formula: boolean;
};

type Range = { t: "range"; r1: number; c1: number; r2: number; c2: number };
type Node =
  | { t: "num"; v: number }
  | { t: "ref"; r: number; c: number }
  | { t: "badref" }
  | Range
  | { t: "neg"; a: Node }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "fn"; name: string; args: Node[] };
type Tok =
  | { k: "num"; v: number }
  | { k: "id"; v: string }
  | { k: "op"; v: string };

class ParseError extends Error {}

const err = (code: string): CellErr => ({ err: code });
const isErr = (v: unknown): v is CellErr =>
  typeof v === "object" && v !== null;
const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
const EMPTY: CellInfo = { text: "", kind: "empty", formula: false };

export function formatNumber(n: number): string {
  return String(parseFloat(n.toPrecision(12)));
}

function labelToCol(label: string): number {
  let n = 0;
  for (const ch of label) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ---------- tokenizer: text -> list of pieces ----------
function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const v = Number(src.slice(i, j));
      if (Number.isNaN(v)) throw new ParseError();
      toks.push({ k: "num", v });
      i = j;
    } else if (/[A-Za-z$]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9$_]/.test(src[j])) j++;
      toks.push({
        k: "id",
        v: src.slice(i, j).replace(/\$/g, "").toUpperCase(),
      });
      i = j;
    } else if ("+-*/(),:".includes(ch)) {
      toks.push({ k: "op", v: ch });
      i++;
    } else {
      throw new ParseError();
    }
  }
  return toks;
}

// ---------- parser: pieces -> tree (handles order of operations) ----------
function parseFormula(src: string): Node {
  const toks = tokenize(src);
  let pos = 0;

  const isOp = (v: string): boolean => {
    const t = toks[pos];
    return t !== undefined && t.k === "op" && t.v === v;
  };
  const eat = (v: string) => {
    if (!isOp(v)) throw new ParseError();
    pos++;
  };
  const refOf = (id: string): Node => {
    const m = /^([A-Z]+)(\d+)$/.exec(id);
    if (!m) throw new ParseError();
    const c = labelToCol(m[1]);
    const r = Number(m[2]) - 1;
    if (c >= COLS || r < 0 || r >= ROWS) return { t: "badref" };
    return { t: "ref", r, c };
  };

  const primary = (): Node => {
    const t = toks[pos];
    if (!t) throw new ParseError();
    if (t.k === "num") {
      pos++;
      return { t: "num", v: t.v };
    }
    if (t.k === "op" && t.v === "(") {
      pos++;
      const e = expr();
      eat(")");
      return e;
    }
    if (t.k === "id") {
      pos++;
      if (isOp("(")) {
        pos++;
        const args: Node[] = [];
        if (!isOp(")")) {
          args.push(expr());
          while (isOp(",")) {
            pos++;
            args.push(expr());
          }
        }
        eat(")");
        return { t: "fn", name: t.v, args };
      }
      const a = refOf(t.v);
      if (isOp(":")) {
        pos++;
        const nt = toks[pos];
        if (!nt || nt.k !== "id") throw new ParseError();
        pos++;
        const b = refOf(nt.v);
        if (a.t !== "ref" || b.t !== "ref") return { t: "badref" };
        return {
          t: "range",
          r1: Math.min(a.r, b.r),
          c1: Math.min(a.c, b.c),
          r2: Math.max(a.r, b.r),
          c2: Math.max(a.c, b.c),
        };
      }
      return a;
    }
    throw new ParseError();
  };

  const unary = (): Node => {
    if (isOp("-")) {
      pos++;
      return { t: "neg", a: unary() };
    }
    if (isOp("+")) {
      pos++;
      return unary();
    }
    return primary();
  };
  const term = (): Node => {
    let left = unary();
    while (isOp("*") || isOp("/")) {
      const op = (toks[pos++] as { v: string }).v;
      left = { t: "bin", op, a: left, b: unary() };
    }
    return left;
  };
  const expr = (): Node => {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = (toks[pos++] as { v: string }).v;
      left = { t: "bin", op, a: left, b: term() };
    }
    return left;
  };

  const node = expr();
  if (pos < toks.length) throw new ParseError();
  return node;
}

function collectRefs(n: Node, refs: number[], ranges: Range[]) {
  switch (n.t) {
    case "ref":
      refs.push(n.r * COLS + n.c);
      break;
    case "range":
      ranges.push(n);
      break;
    case "neg":
      collectRefs(n.a, refs, ranges);
      break;
    case "bin":
      collectRefs(n.a, refs, ranges);
      collectRefs(n.b, refs, ranges);
      break;
    case "fn":
      n.args.forEach((a) => collectRefs(a, refs, ranges));
      break;
  }
}

// ---------- the model ----------
export class SheetModel {
  // What the user typed. Key = row * COLS + col. Empty cells are absent.
  private raws = new Map<number, string>();
  // Parsed formulas (or a parse error).
  private formulas = new Map<number, Node | CellErr>();
  // Cached results. A missing entry means "needs computing".
  private values = new Map<number, Value>();
  // Dependency graph: cell -> formulas that point at it.
  private dependents = new Map<number, Set<number>>();
  private refsOf = new Map<number, number[]>();
  private rangesOf = new Map<number, Range[]>();
  private visiting = new Set<number>();

  getRaw(r: number, c: number): string {
    return this.raws.get(r * COLS + c) ?? "";
  }

  setRaw(r: number, c: number, raw: string): Change[] {
    return this.apply([{ r, c, before: "", after: raw }]);
  }

  // Apply changes, then throw away cached results only for affected cells.
  apply(changes: Change[]): Change[] {
    const applied: Change[] = [];
    const touched: number[] = [];
    for (const ch of changes) {
      const k = ch.r * COLS + ch.c;
      const before = this.raws.get(k) ?? "";
      if (before === ch.after) continue;
      applied.push({ r: ch.r, c: ch.c, before, after: ch.after });
      this.store(k, ch.after);
      touched.push(k);
    }
    this.invalidate(touched);
    return applied;
  }

  clearRange(r1: number, c1: number, r2: number, c2: number): Change[] {
    const changes: Change[] = [];
    const area = (r2 - r1 + 1) * (c2 - c1 + 1);
    if (area <= this.raws.size) {
      for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++)
          if (this.raws.has(r * COLS + c))
            changes.push({ r, c, before: "", after: "" });
    } else {
      for (const k of this.raws.keys()) {
        const r = Math.floor(k / COLS);
        const c = k % COLS;
        if (r >= r1 && r <= r2 && c >= c1 && c <= c2)
          changes.push({ r, c, before: "", after: "" });
      }
    }
    return this.apply(changes);
  }

  cellInfo(r: number, c: number): CellInfo {
    const raw = this.raws.get(r * COLS + c);
    if (raw === undefined) return EMPTY;
    const formula = raw.startsWith("=");
    let v: Value;
    try {
      v = this.getValue(r, c);
    } catch {
      v = err("#ERROR!");
    }
    if (isErr(v)) return { text: v.err, kind: "error", formula };
    if (typeof v === "number")
      return { text: formatNumber(v), kind: "number", formula };
    return { text: v, kind: "text", formula };
  }

  stats(r1: number, c1: number, r2: number, c2: number) {
    let sum = 0;
    let nums = 0;
    let count = 0;
    try {
      this.forEachInRange(r1, c1, r2, c2, (v) => {
        count++;
        if (typeof v === "number") {
          sum += v;
          nums++;
        }
      });
    } catch {
      // a very deep chain of formulas: show what we have
    }
    return { sum, count, nums, avg: nums > 0 ? sum / nums : null };
  }

  // ---------- internals ----------
  private store(k: number, raw: string) {
    this.unindex(k);
    if (raw === "") {
      this.raws.delete(k);
      this.formulas.delete(k);
      return;
    }
    this.raws.set(k, raw);
    if (!raw.startsWith("=")) {
      this.formulas.delete(k);
      return;
    }
    try {
      const node = parseFormula(raw.slice(1));
      this.formulas.set(k, node);
      const refs: number[] = [];
      const ranges: Range[] = [];
      collectRefs(node, refs, ranges);
      this.refsOf.set(k, refs);
      this.rangesOf.set(k, ranges);
      for (const t of refs) {
        let set = this.dependents.get(t);
        if (!set) this.dependents.set(t, (set = new Set()));
        set.add(k);
      }
    } catch {
      this.formulas.set(k, err("#ERROR!"));
    }
  }

  private unindex(k: number) {
    const refs = this.refsOf.get(k);
    if (refs) {
      for (const t of refs) {
        const set = this.dependents.get(t);
        if (set) {
          set.delete(k);
          if (set.size === 0) this.dependents.delete(t);
        }
      }
    }
    this.refsOf.delete(k);
    this.rangesOf.delete(k);
  }

  // Walk "who depends on me" outwards and forget only those cached values.
  private invalidate(start: number[]) {
    const seen = new Set<number>(start);
    const queue = [...start];
    while (queue.length > 0) {
      const k = queue.pop() as number;
      this.values.delete(k);
      const direct = this.dependents.get(k);
      if (direct) {
        for (const d of direct) {
          if (!seen.has(d)) {
            seen.add(d);
            queue.push(d);
          }
        }
      }
      const r = Math.floor(k / COLS);
      const c = k % COLS;
      for (const [fk, ranges] of this.rangesOf) {
        if (seen.has(fk)) continue;
        for (const g of ranges) {
          if (r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2) {
            seen.add(fk);
            queue.push(fk);
            break;
          }
        }
      }
    }
  }

  private getValue(r: number, c: number): Value {
    const k = r * COLS + c;
    const cached = this.values.get(k);
    if (cached !== undefined) return cached;
    const raw = this.raws.get(k);
    if (raw === undefined) return "";

    let v: Value;
    if (raw.startsWith("=")) {
      if (this.visiting.has(k)) return err("#CYCLE!");
      const f = this.formulas.get(k);
      this.visiting.add(k);
      try {
        v = f && "t" in f ? this.evalNode(f) : (f ?? err("#ERROR!"));
      } finally {
        this.visiting.delete(k);
      }
      if (typeof v === "number" && !Number.isFinite(v)) v = err("#NUM!");
    } else {
      v = NUMBER_RE.test(raw.trim()) ? Number(raw) : raw;
    }
    this.values.set(k, v);
    return v;
  }

  private toNum(v: Value): number | CellErr {
    if (isErr(v)) return v;
    if (typeof v === "number") return v;
    if (v === "") return 0;
    return err("#VALUE!");
  }

  private evalNode(n: Node): Value {
    switch (n.t) {
      case "num":
        return n.v;
      case "ref":
        return this.getValue(n.r, n.c);
      case "badref":
        return err("#REF!");
      case "range":
        return err("#VALUE!");
      case "neg": {
        const x = this.toNum(this.evalNode(n.a));
        return isErr(x) ? x : -x;
      }
      case "bin": {
        const a = this.toNum(this.evalNode(n.a));
        if (isErr(a)) return a;
        const b = this.toNum(this.evalNode(n.b));
        if (isErr(b)) return b;
        if (n.op === "+") return a + b;
        if (n.op === "-") return a - b;
        if (n.op === "*") return a * b;
        return b === 0 ? err("#DIV/0!") : a / b;
      }
      case "fn":
        return this.evalFn(n.name, n.args);
    }
  }

  private evalFn(name: string, args: Node[]): Value {
    if (name !== "SUM" && name !== "AVG" && name !== "AVERAGE")
      return err("#NAME?");
    let sum = 0;
    let count = 0;
    const fail: { e: CellErr | null } = { e: null };
    const add = (v: Value) => {
      if (fail.e || v === "") return;
      if (isErr(v)) fail.e = v;
      else if (typeof v === "number") {
        sum += v;
        count++;
      }
    };
    for (const a of args) {
      if (fail.e) break;
      if (a.t === "range") {
        this.forEachInRange(a.r1, a.c1, a.r2, a.c2, add);
      } else {
        const v = this.evalNode(a);
        if (typeof v === "string" && v !== "") fail.e = err("#VALUE!");
        else add(v);
      }
    }
    if (fail.e) return fail.e;
    if (name === "SUM") return sum;
    return count === 0 ? err("#DIV/0!") : sum / count;
  }

  // Visits only non-empty cells, whichever way is cheaper.
  private forEachInRange(
    r1: number,
    c1: number,
    r2: number,
    c2: number,
    fn: (v: Value) => void
  ) {
    const area = (r2 - r1 + 1) * (c2 - c1 + 1);
    if (area <= this.raws.size) {
      for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++)
          if (this.raws.has(r * COLS + c)) fn(this.getValue(r, c));
    } else {
      for (const k of this.raws.keys()) {
        const r = Math.floor(k / COLS);
        const c = k % COLS;
        if (r >= r1 && r <= r2 && c >= c1 && c <= c2)
          fn(this.getValue(r, c));
      }
    }
  }
}