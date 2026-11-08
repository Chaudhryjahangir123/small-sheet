// 0 -> "A", 25 -> "Z", 26 -> "AA"
export function colToLabel(col: number): string {
  let n = col + 1;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export function addr(col: number, row: number): string {
  return `${colToLabel(col)}${row + 1}`;
}

// "B7" -> { r: 6, c: 1 }. Returns null if it is not an address.
export function parseAddr(s: string): { r: number; c: number } | null {
  const m = /^([A-Za-z]{1,3})(\d{1,6})$/.exec(s.trim());
  if (!m) return null;
  let c = 0;
  for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}