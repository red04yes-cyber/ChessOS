import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";

test("accepts legal moves and rejects illegal moves", () => {
  const chess = new Chess();
  assert.equal(chess.move("e4").san, "e4");
  assert.throws(() => chess.move({ from: "e4", to: "e6" }));
  assert.equal(chess.move("e5").san, "e5");
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
  chess.loadPgn('[SetUp "1"]\n[FEN "k7/8/8/8/8/8/8/4K3 w - - 0 1"]\n\n1. Kf2');
  assert.equal(chess.history().length, 1);
});

test("supports kingside and queenside castling", () => {
  const chess = new Chess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  assert.equal(chess.move({ from: "e1", to: "g1" }).san, "O-O");
  assert.equal(chess.get("f1").type, "r");
  assert.equal(chess.get("g1").type, "k");
  chess.undo();
  assert.equal(chess.move({ from: "e1", to: "c1" }).san, "O-O-O");
  assert.equal(chess.get("d1").type, "r");
});

test("supports en passant captures", () => {
  const chess = new Chess();
  for (const san of ["e4", "a6", "e5", "d5"]) chess.move(san);
  const capture = chess.move({ from: "e5", to: "d6" });
  assert.equal(capture.flags.includes("e"), true);
  assert.equal(chess.get("d5"), undefined);
  assert.equal(chess.get("d6").type, "p");
});

test("supports all four promotion choices, including underpromotion", () => {
  for (const promotion of ["q", "r", "b", "n"]) {
    const chess = new Chess("7k/P7/8/8/8/8/8/7K w - - 0 1");
    const move = chess.move({ from: "a7", to: "a8", promotion });
    assert.equal(move.promotion, promotion);
    assert.equal(chess.get("a8").type, promotion);
  }
});

test("recognises stalemate and insufficient material", () => {
  const stalemate = new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  assert.equal(stalemate.isStalemate(), true);
  const insufficient = new Chess("8/8/8/8/8/8/4k3/7K w - - 0 1");
  assert.equal(insufficient.isInsufficientMaterial(), true);
});
