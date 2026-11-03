import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";

test("accepts legal moves and rejects illegal moves", () => {
  const chess = new Chess();
  assert.equal(chess.move("e4").san, "e4");
  assert.equal(chess.move("e5").san, "e5");
  assert.throws(() => chess.move("Qh5"), /Invalid move|Invalid move:/);
});

test("recognises checkmate", () => {
  const chess = new Chess();
  for (const san of ["f3", "e5", "g4", "Qh4#"]) chess.move(san);
  assert.equal(chess.isCheckmate(), true);
});

test("round-trips a PGN", () => {
  const original = new Chess();
  for (const san of ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4"]) original.move(san);
  const restored = new Chess();
  restored.loadPgn(original.pgn());
  assert.deepEqual(restored.history(), original.history());
  assert.equal(restored.fen(), original.fen());
});

test("loads a non-standard starting position from PGN", () => {
  const chess = new Chess();
  chess.loadPgn('[SetUp "1"]\n[FEN "8/8/8/8/8/8/4k3/4K3 w - - 0 1"]\n\n1. Kd2');
  assert.equal(chess.history().length, 1);
});