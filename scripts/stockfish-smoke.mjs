import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const enginePath = path.resolve("src-tauri/resources/stockfish/stockfish.exe");
if (!existsSync(enginePath)) {
  throw new Error("Stockfish executable missing. Run npm run stockfish:install first.");
}

const child = spawn(enginePath, [], {
  cwd: path.dirname(enginePath),
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

const lines = [];
let wake = null;
let closed = false;
let processError = null;
const collect = (chunk) => {
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    if (line.trim()) lines.push(line.trim());
  }
  wake?.();
  wake = null;
};
child.stdout.on("data", collect);
child.stderr.on("data", collect);
child.on("error", (error) => { processError = error; wake?.(); });
child.on("close", () => { closed = true; wake?.(); });

async function waitForLine(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processError) throw processError;
    if (closed) throw new Error("Stockfish exited before " + label + ".");
    const index = lines.findIndex(predicate);
    if (index >= 0) return lines.splice(index, 1)[0];
    await Promise.race([
      new Promise((resolve) => { wake = resolve; }),
      delay(Math.max(1, deadline - Date.now())),
    ]);
  }
  throw new Error("Timeout waiting for " + label + ".");
}

try {
  child.stdin.write("uci\n");
  await waitForLine((line) => line === "uciok", 15000, "uciok");
  child.stdin.write("isready\n");
  await waitForLine((line) => line === "readyok", 15000, "readyok");
  child.stdin.write("position startpos\ngo depth 7\n");
  const bestMove = await waitForLine((line) => line.startsWith("bestmove "), 20000, "bestmove");
  if (!/^bestmove [a-h][1-8][a-h][1-8][qrbn]?/.test(bestMove)) {
    throw new Error("Stockfish returned an invalid bestmove: " + bestMove);
  }
  console.log("Stockfish smoke test passed: " + bestMove);
} finally {
  if (!closed) {
    child.stdin.write("quit\n");
    await Promise.race([
      new Promise((resolve) => child.once("close", resolve)),
      delay(2000),
    ]);
    if (!closed) child.kill();
  }
}
