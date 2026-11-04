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