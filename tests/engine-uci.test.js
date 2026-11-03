import test from "node:test";
import assert from "node:assert/strict";
import { formatUciScore, parseUciInfo, uciPvToSan } from "../src/engine-uci.js";

test("parses Stockfish MultiPV centipawn output", () => {
  const result = parseUciInfo("info depth 18 seldepth 24 multipv 2 score cp -34 nodes 1000 nps 250000 time 40 pv e2e4 e7e5 g1f3");
  assert.deepEqual(result, {
    depth: 18,
    multipv: 2,
    scoreType: "cp",
    score: -34,
    pv: ["e2e4", "e7e5", "g1f3"],
  });
});

test("formats scores from White's perspective", () => {
  const score = parseUciInfo("info depth 10 score cp 47 pv e2e4");
  assert.equal(formatUciScore(score, "w"), "+0.47");
  assert.equal(formatUciScore(score, "b"), "−0.47");
});

test("formats mate scores and flips them for Black to move", () => {
  const mate = parseUciInfo("info depth 16 score mate 3 pv e2e4");
  assert.equal(formatUciScore(mate, "w"), "+M3");
  assert.equal(formatUciScore(mate, "b"), "−M3");
});

test("converts a UCI principal variation to SAN and stops at invalid moves", () => {
  assert.equal(
    uciPvToSan("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", ["e2e4", "e7e5", "g1f3", "a1a8"]),
    "e4 e5 Nf3",
  );
});

test("ignores incomplete or non-info lines", () => {
  assert.equal(parseUciInfo("bestmove e2e4"), null);
  assert.equal(parseUciInfo("info depth 12 nodes 100"), null);
});
