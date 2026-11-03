import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const packageBin = resolve("node_modules/stockfish/bin");
const publicDir = resolve("public/stockfish");
const files = ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm"];

mkdirSync(publicDir, { recursive: true });
for (const file of files) {
  const source = resolve(packageBin, file);
  const destination = resolve(publicDir, file);
  if (!existsSync(source)) {
    throw new Error("Stockfish asset missing: " + source + ". Run npm install first.");
  }
  copyFileSync(source, destination);
}
console.log("Prepared Stockfish 19 Lite single-threaded WebAssembly assets.");
