// Run: node gen-golden.mjs   (rewrites the file the Android parity test reads)
import fs from "node:fs";
import { buildGolden } from "./golden.mjs";
const file = new URL("../android-client/app/src/test/resources/golden_parity.txt", import.meta.url);
fs.mkdirSync(new URL(".", file), { recursive: true });
const text = buildGolden();
fs.writeFileSync(file, text);
console.log("wrote", text.split("\n").length - 1, "lines");
