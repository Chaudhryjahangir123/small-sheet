import { colToLabel } from "./address";
import { ROWS, type Entry } from "./sheet";

export type Fixture = { id: string; name: string; build: () => Entry[] };

const L = colToLabel;

// A budget: line items -> section subtotals -> expenses -> net -> margin,
// and a headline at the TOP that reads from the bottom.
function budget(): Entry[] {
  const out: Entry[] = [];
  const put = (r: number, c: number, v: string | number) =>
    out.push([r, c, String(v)]);

  ["Item", "Q1", "Q2", "Q3", "Q4", "Year"].forEach((h, c) => put(1, c, h));

  const sections = [
    { name: "Revenue", base: 48000, items: ["Plans", "Services", "Licensing", "Support", "Training"] },
    { name: "Operations", base: 6000, items: ["Rent", "Utilities", "Software", "Insurance", "Equipment", "Travel"] },
    { name: "Marketing", base: 5000, items: ["Ads", "Events", "Content", "Tools", "Sponsors"] },
    { name: "People", base: 14000, items: ["Salaries", "Benefits", "Recruiting", "Courses", "Agency", "Bonuses"] },
  ];

  let r = 2;
  const subtotal: number[] = [];
  sections.forEach((s, si) => {
    put(r, 0, s.name);
    r++;
    const start = r;
    s.items.forEach((item, ii) => {
      put(r, 0, item);
      for (let q = 0; q < 4; q++) {
        put(r, 1 + q, s.base + ((si * 131 + ii * 57 + q * 23) % 13) * 250 + ii * 1200);
      }
      put(r, 5, `=SUM(B${r + 1}:E${r + 1})`);
      r++;
    });
    const end = r - 1;
    put(r, 0, "Subtotal");
    for (let c = 1; c <= 5; c++)
      put(r, c, `=SUM(${L(c)}${start + 1}:${L(c)}${end + 1})`);
    subtotal.push(r);
    r += 2;
  });

  put(r, 0, "Expenses");
  for (let c = 1; c <= 5; c++)
    put(r, c, `=${L(c)}${subtotal[1] + 1}+${L(c)}${subtotal[2] + 1}+${L(c)}${subtotal[3] + 1}`);
  const expRow = r;
  r++;
  put(r, 0, "Net profit");
  for (let c = 1; c <= 5; c++)
    put(r, c, `=${L(c)}${subtotal[0] + 1}-${L(c)}${expRow + 1}`);
  const netRow = r;
  r++;
  put(r, 0, "Margin");
  for (let c = 1; c <= 5; c++)
    put(r, c, `=${L(c)}${netRow + 1}/${L(c)}${subtotal[0] + 1}`);
  const marginRow = r;

  put(0, 0, "Budget 2027");
  put(0, 2, "Net profit");
  put(0, 3, `=F${netRow + 1}`);
  put(0, 4, "Margin");
  put(0, 5, `=F${marginRow + 1}`);
  return out;
}

// 10,000 rows, 12 columns, a formula column down the whole length, a total at the end.
function big(): Entry[] {
  const out: Entry[] = [];
  const regions = ["North", "South", "East", "West", "Central"];
  [
    "ID", "Region", "Units", "Price", "Discount", "Cost",
    "Tax", "Ship", "Weight", "Rating", "Revenue", "Profit",
  ].forEach((h, c) => out.push([0, c, h]));

  const LAST = ROWS - 1;
  for (let r = 1; r < LAST; r++) {
    const x = r + 1;
    out.push([r, 0, String(r)]);
    out.push([r, 1, regions[(r * 7) % 5]]);
    out.push([r, 2, String(1 + ((r * 37) % 90))]);
    out.push([r, 3, String(5 + ((r * 53) % 400) / 4)]);
    out.push([r, 4, String((r * 11) % 25)]);
    out.push([r, 5, String(2 + ((r * 29) % 200) / 4)]);
    out.push([r, 6, String((r * 13) % 9)]);
    out.push([r, 7, String((r * 17) % 15)]);
    out.push([r, 8, String(1 + ((r * 19) % 50) / 2)]);
    out.push([r, 9, String(1 + ((r * 23) % 5))]);
    out.push([r, 10, `=C${x}*D${x}-E${x}`]);
    out.push([r, 11, `=K${x}-F${x}*C${x}`]);
  }
  out.push([LAST, 0, "TOTAL"]);
  out.push([LAST, 2, `=SUM(C2:C${LAST})`]);
  out.push([LAST, 10, `=SUM(K2:K${LAST})`]);
  out.push([LAST, 11, `=SUM(L2:L${LAST})`]);
  return out;
}

// Every kind of broken, each with what you should see.
function broken(): Entry[] {
  const rows: [string, string, string][] = [
    ["Case", "Formula", "You should see"],
    ["Healthy", "=1+2*3", "7"],
    ["Divide by zero", "=1/0", "#DIV/0!"],
    ["Uses a broken cell", "=B3+10", "#DIV/0!"],
    ["Cycle: itself", "=B5", "#CYCLE!"],
    ["Cycle: pair 1", "=B7", "#CYCLE!"],
    ["Cycle: pair 2", "=B6", "#CYCLE!"],
    ["Missing column", "=AA1", "#REF!"],
    ["Missing row", "=A99999", "#REF!"],
    ["Unknown function", "=FOO(1)", "#NAME?"],
    ["Text in math", "=A2+1", "#VALUE!"],
    ["Bad syntax", "=SUM(", "#ERROR!"],
    ["Uses two cycles", "=B5+B6", "#CYCLE!"],
    ["Sum over broken", "=SUM(B3:B4)", "#DIV/0!"],
  ];
  const out: Entry[] = [];
  rows.forEach((row, r) => row.forEach((v, c) => out.push([r, c, v])));
  return out;
}

export const FIXTURES: Fixture[] = [
  { id: "budget", name: "Budget", build: budget },
  { id: "big", name: "Big sheet", build: big },
  { id: "broken", name: "Broken", build: broken },
];