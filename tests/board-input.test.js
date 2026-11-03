import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { classifyBoardMove } from "../src/board-input.js";

test("recognises legal click/drag moves from the starting position", () => {
  const chess = new Chess();
  const result = classifyBoardMove(chess, "e2", "e4");
  assert.equal(result.kind, "move");
  assert.equal(result.move.san, "e4");
});

test("rejects illegal movement and pieces belonging to the opponent", () => {
  const chess = new Chess();
  assert.equal(classifyBoardMove(chess, "e2", "e5").kind, "illegal");
  assert.equal(classifyBoardMove(chess, "a7", "a6").kind, "invalid");
  assert.equal(classifyBoardMove(chess, "e9", "e4").kind, "invalid");
});

test("allows selecting another friendly piece while a piece is selected", () => {
  const chess = new Chess();
  assert.deepEqual(classifyBoardMove(chess, "e2", "d2"), { kind: "select", square: "d2" });
  assert.equal(classifyBoardMove(chess, "e2", "e2").kind, "same-square");
});

test("returns four promotion choices and preserves underpromotion", () => {
  const chess = new Chess("7k/P7/8/8/8/8/8/K7 w - - 0 1");
  const result = classifyBoardMove(chess, "a7", "a8");
  assert.equal(result.kind, "promotion");
  assert.deepEqual(result.moves.map((move) => move.promotion).sort(), ["b", "n", "q", "r"]);
});

test("recognises king-side castling through drag and click classification", () => {
  const chess = new Chess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const result = classifyBoardMove(chess, "e1", "g1");
  assert.equal(result.kind, "move");
  assert.equal(result.move.san, "O-O");
  assert.ok(result.move.flags.includes("k"));
});

test("recognises en passant as a legal capture", () => {
  const chess = new Chess("8/8/8/3pP3/8/8/8/K6k w - d6 0 1");
  const result = classifyBoardMove(chess, "e5", "d6");
  assert.equal(result.kind, "move");
  assert.equal(result.move.san, "exd6");
  assert.ok(result.move.flags.includes("e"));
});

test("recognises ordinary captures through the shared classifier", () => {
  const chess = new Chess("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
  const result = classifyBoardMove(chess, "e4", "d5");
  assert.equal(result.kind, "move");
  assert.equal(result.move.san, "exd5");
  assert.ok(result.move.flags.includes("c"));
});
