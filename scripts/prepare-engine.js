import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const packageBin = resolve("node_modules/stockfish/bin");
const publicDir = resolve("public/stockfish");
const files = ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm"];
const licenceSource = resolve("licenses/Stockfish-GPL-3.0.txt");
const licenceDestination = resolve(publicDir, "COPYING.txt");

mkdirSync(publicDir, { recursive: true });
for (const file of files) {
  const source = resolve(packageBin, file);
  const destination = resolve(publicDir, file);
  if (!existsSync(source)) {
    throw new Error("Stockfish asset missing: " + source + ". Run npm install first.");
  }
  copyFileSync(source, destination);
}
if (!existsSync(licenceSource)) {
  throw new Error("Stockfish GPL-3.0 licence text missing: " + licenceSource);
}
copyFileSync(licenceSource, licenceDestination);
console.log("Prepared Stockfish 19 Lite worker, WASM and GPL-3.0 licence notice.");
