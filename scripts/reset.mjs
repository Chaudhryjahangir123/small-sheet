import { rmSync } from "node:fs";

rmSync("data", { recursive: true, force: true });
console.log("Fixtures reset. They are rebuilt on the next request.");