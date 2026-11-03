import test from "node:test";
import assert from "node:assert/strict";
import { parsePgnCollection, splitPgnGames } from "../src/pgn-import.js";
import { classifyMoveLoss, scoreToWhiteCentipawns, explainMove } from "../src/chess-coach.js";

const collection = [
  '[Event "Italian Game"]',
  '[White "Alpha"]',
  '[Black "Beta"]',
  "",
  "1. e4 e5 2. Nf3 Nc6 *",
  "",
  '[Event "Sicilian Defense"]',
  '[White "Gamma"]',
  '[Black "Delta"]',
  "",
  "1. e4 c5 2. Nf3 d6 *",
].join("\n");

test("splits multi-game PGN into independent valid games", () => {
  assert.equal(splitPgnGames(collection).length, 2);
  const result = parsePgnCollection(collection);
  assert.equal(result.total, 2);
  assert.equal(result.games.length, 2);
  assert.equal(result.games[0].title, "Italian Game · Alpha – Beta");
  assert.equal(result.games[1].tree.edges.size, 4);
});

test("preserves legal games and reports an invalid game by index", () => {
  const source = [
    '[Event "Valid"]', "", "1. e4 e5 *", "",
    '[Event "Invalid"]', "", "1. Qh5 *", "",
    '[Event "Valid two"]', "", "1. d4 d5 *",
  ].join("\n");
  const result = parsePgnCollection(source);
  assert.equal(result.games.length, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].index, 2);
});

test("enforces collection size and game-count limits", () => {
  assert.match(parsePgnCollection("x".repeat(10_000_001)).errors[0].message, /10 MB/);
  const many = Array.from({ length: 101 }, (_, i) => '[Event "G' + i + '"]\n\n1. e4 *').join("\n\n");
  assert.match(parsePgnCollection(many).errors[0].message, /100 partite/);
});

test("converts engine scores to White perspective", () => {
  assert.equal(scoreToWhiteCentipawns({ scoreType: "cp", score: 55 }, "b"), -55);
  assert.equal(scoreToWhiteCentipawns({ scoreType: "mate", score: 3 }, "b"), -99_700);
});

test("classifies inaccuracies, mistakes and blunders", () => {
  assert.equal(classifyMoveLoss(20), "buona");
  assert.equal(classifyMoveLoss(85), "imprecisione");
  assert.equal(classifyMoveLoss(180), "errore");
  assert.equal(classifyMoveLoss(320), "svista");
});

test("explains a move that leaves a piece en prise", () => {
  const fen = "2r1k3/8/8/8/8/8/8/1N2K3 w - - 0 1";
  const explanation = explainMove(fen, "b1c3", { pv: ["e1f2"] }, 300);
  assert.match(explanation, /sicurezza dei pezzi|catture/i);
});

test("explains losses without inventing a tactical motif", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const explanation = explainMove(fen, "g1f3", { pv: ["e2e4", "e7e5"] }, 120);
  assert.match(explanation, /Stockfish|sicurezza del re/i);
});
