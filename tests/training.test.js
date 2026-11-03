import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { createTrainingSession } from "../src/training.js";

test("starts training from the PGN custom FEN position", () => {
  const fen = "k7/8/8/8/8/8/8/4K3 w - - 0 1";
  const pgn = `[SetUp "1"]\n[FEN "${fen}"]\n\n1. Kf2 *`;
  const session = createTrainingSession(pgn);

  assert.equal(session.game.fen(), fen);
  assert.equal(session.moves.length, 1);
  assert.equal(session.moves[0].from, "e1");
  assert.equal(session.moves[0].to, "f2");
});

test("starts ordinary training from the standard chess position", () => {
  const source = new Chess();
  source.move("e4");
  source.move("e5");

  const session = createTrainingSession(source.pgn());
  assert.equal(session.game.fen(), new Chess().fen());
  assert.deepEqual(session.moves.map((move) => move.san), ["e4", "e5"]);
});
