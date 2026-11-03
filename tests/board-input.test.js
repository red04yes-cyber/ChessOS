import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { classifyBoardMove } from "../src/board-input.js";

test("classifies a legal move from the standard position", () => {
  const chess = new Chess();
  const result = classifyBoardMove(chess, "e2", "e4");
  assert.equal(result.kind, "move");
  assert.equal(result.move.san, "e4");
});

test("rejects illegal moves and moves from the wrong side", () => {
  const chess = new Chess();
  assert.equal(classifyBoardMove(chess, "e2", "e5").kind, "illegal");
  assert.equal(classifyBoardMove(chess, "a7", "a6").kind, "invalid");
});

test("reselects another friendly piece and cancels a same-square attempt", () => {
  const chess = new Chess();
  assert.deepEqual(classifyBoardMove(chess, "e2", "d2"), { kind: "select", square: "d2" });
  assert.equal(classifyBoardMove(chess, "e2", "e2").kind, "same-square");
});

test("returns all four legal promotion choices", () => {
  const chess = new Chess("7k/P7/8/8/8/8/8/K7 w - - 0 1");
  const result = classifyBoardMove(chess, "a7", "a8");
  assert.equal(result.kind, "promotion");
  assert.deepEqual(result.moves.map((move) => move.promotion).sort(), ["b", "n", "q", "r"]);
});
