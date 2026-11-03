import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { RepertoireTree } from "../src/repertoire-tree.js";
import { createTrainingSession } from "../src/training.js";

test("starts training from a custom PGN FEN and replays its moves", () => {
  const fen = "k7/8/8/8/8/8/8/4K3 w - - 0 1";
  const pgn = [
    '[SetUp "1"]',
    `[FEN "${fen}"]`,
    "",
    "1. Kf2 *",
  ].join("\n");
  const tree = RepertoireTree.fromPgn(pgn);
  const path = tree.mainlinePath();
  const snapshot = tree.replayPath(path);
  const session = createTrainingSession(tree.rootFen, snapshot.moves);

  assert.equal(session.startFen, fen);
  assert.equal(session.game.fen(), fen);
  assert.equal(session.moves.length, 1);
  assert.equal(session.moves[0].from, "e1");
  assert.equal(session.moves[0].to, "f2");
  session.game.move(session.moves[0]);
  assert.equal(session.game.fen(), snapshot.states[1]);
});

test("starts ordinary training from the standard initial position", () => {
  const source = new Chess();
  source.move("e4");
  source.move("e5");
  const tree = RepertoireTree.fromPgn(source.pgn());
  const snapshot = tree.replayPath(tree.mainlinePath());
  const session = createTrainingSession(tree.rootFen, snapshot.moves);

  assert.equal(session.startFen, new Chess().fen());
  assert.deepEqual(session.moves.map((move) => move.san), ["e4", "e5"]);
});

test("rejects invalid training input instead of silently using the standard board", () => {
  assert.throws(() => createTrainingSession("", []), /Posizione iniziale/i);
  assert.throws(() => createTrainingSession(new Chess().fen(), null), /Percorso/i);
  assert.throws(() => createTrainingSession(new Chess().fen(), [{ from: "e2" }]), /Mossa/i);
});
