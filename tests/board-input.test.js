import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { classifyBoardMove } from "../src/board-input.js";

test("recognises legal, illegal and friendly-piece selections", () => {
  const chess = new Chess();
  assert.equal(classifyBoardMove(chess, "e2", "e4").move.san, "e4");
  assert.equal(classifyBoardMove(chess, "e2", "e5").kind, "illegal");
  assert.equal(classifyBoardMove(chess, "a7", "a6").kind, "invalid");
  assert.deepEqual(classifyBoardMove(chess, "e2", "d2"), { kind: "select", square: "d2" });
  assert.equal(classifyBoardMove(chess, "e2", "e2").kind, "same-square");
});

test("returns all four promotion choices", () => {
  const chess = new Chess("7k/P7/8/8/8/8/8/K7 w - - 0 1");
  const result = classifyBoardMove(chess, "a7", "a8");
  assert.equal(result.kind, "promotion");
  assert.deepEqual(result.moves.map((move) => move.promotion).sort(), ["b","n","q","r"]);
});

test("classifies castling, en passant and ordinary captures", () => {
  const castling = new Chess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const castle = classifyBoardMove(castling, "e1", "g1");
  assert.equal(castle.move.san, "O-O");
  assert.ok(castle.move.flags.includes("k"));
  const ep = new Chess("8/8/8/3pP3/8/8/8/K6k w - d6 0 1");
  const enPassant = classifyBoardMove(ep, "e5", "d6");
  assert.equal(enPassant.move.san, "exd6");
  assert.ok(enPassant.move.flags.includes("e"));
  const captures = new Chess("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
  const capture = classifyBoardMove(captures, "e4", "d5");
  assert.equal(capture.move.san, "exd5");
  assert.ok(capture.move.flags.includes("c"));
});
