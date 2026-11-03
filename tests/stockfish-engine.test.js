import test from "node:test";
import assert from "node:assert/strict";
import { parseStockfishAnalysis } from "../src/stockfish-engine.js";

test("parses centipawn evaluation, best SAN and a legal principal variation", () => {
  const parsed = parseStockfishAnalysis([
    "info depth 12 multipv 1 score cp 34 nodes 1200 pv e2e4 e7e5 g1f3",
    "info depth 12 multipv 2 score cp 10 nodes 800 pv d2d4 d7d5",
    "bestmove e2e4 ponder e7e5",
  ], "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");

  assert.equal(parsed.depth, 12);
  assert.equal(parsed.scoreCp, 34);
  assert.equal(parsed.mate, null);
  assert.equal(parsed.bestmove, "e2e4");
  assert.equal(parsed.bestSan, "e4");
  assert.deepEqual(parsed.pvUci, ["e2e4", "e7e5", "g1f3"]);
  assert.deepEqual(parsed.pvSan, ["e4", "e5", "Nf3"]);
});

test("prefers the main MultiPV line and parses forced-mate scores", () => {
  const parsed = parseStockfishAnalysis([
    "info depth 18 multipv 1 score mate -3 nodes 200 pv e2e4 e7e5",
    "info depth 18 multipv 2 score cp 900 nodes 100 pv d2d4 d7d5",
    "bestmove e2e4",
  ], "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");

  assert.equal(parsed.mate, -3);
  assert.equal(parsed.scoreCp, null);
  assert.deepEqual(parsed.pvSan, ["e4", "e5"]);
});

test("returns a partial legal variation and handles an empty best move", () => {
  const parsed = parseStockfishAnalysis([
    "info depth 8 score cp -12 pv e2e4 e7e5 h1h8",
    "bestmove (none)",
  ], "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");

  assert.equal(parsed.bestmove, "(none)");
  assert.equal(parsed.bestSan, null);
  assert.deepEqual(parsed.pvSan, ["e4", "e5"]);
});

test("returns neutral metadata when the engine has no completed info line", () => {
  const parsed = parseStockfishAnalysis(["bestmove (none)"], "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  assert.equal(parsed.depth, 0);
  assert.equal(parsed.scoreCp, null);
  assert.equal(parsed.mate, null);
  assert.deepEqual(parsed.pvSan, []);
});
