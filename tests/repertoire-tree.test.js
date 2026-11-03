import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { RepertoireTree } from "../src/repertoire-tree.js";

const sampleWithVariations = [
  '[Event "RAV round-trip"]',
  "",
  "1. e4 (1. d4 d5) e5 2. Nf3 (2. Bc4) Nc6 *",
].join("\n");

test("imports RAV alternatives into the correct branching positions", () => {
  const tree = RepertoireTree.fromPgn(sampleWithVariations);
  const rootMoves = tree.getOutgoing(tree.rootId).map((edge) => edge.san);
  assert.deepEqual(rootMoves, ["e4", "d4"]);

  const e4 = tree.getOutgoing(tree.rootId).find((edge) => edge.san === "e4");
  const afterE4 = tree.getOutgoing(e4.to);
  assert.deepEqual(afterE4.map((edge) => edge.san), ["e5"]);

  const afterE5 = tree.getOutgoing(afterE4[0].to).map((edge) => edge.san);
  assert.deepEqual(afterE5, ["Nf3", "Bc4"]);
});

test("exports and re-imports a PGN with nested RAV branches", () => {
  const original = RepertoireTree.fromPgn(sampleWithVariations);
  const exported = original.toPgn();
  const restored = RepertoireTree.fromPgn(exported);

  const describe = (tree) => [...tree.edges.values()]
    .map((edge) => [edge.from, edge.uci, edge.to, edge.nags.join(","), edge.comment])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  assert.deepEqual(describe(restored), describe(original));
  assert.match(exported, /\(1\. d4/);
  assert.match(exported, /\(2\. Bc4/);
});

test("merges transposed positions reached through different move orders", () => {
  const pgn = [
    "1. Nf3 (1. g3 d5 2. Nf3 Nf6 3. Bg2) d5 2. g3 Nf6 3. Bg2 *",
  ].join("\n");
  const tree = RepertoireTree.fromPgn(pgn);
  const bishopMoves = [...tree.edges.values()].filter((edge) => edge.san === "Bg2");

  assert.equal(bishopMoves.length, 2);
  assert.equal(bishopMoves[0].to, bishopMoves[1].to);
  assert.equal(tree.getIncoming(bishopMoves[0].to).length, 2);
});

test("allows editing a branch and exporting the new continuation", () => {
  const tree = RepertoireTree.fromPgn("1. e4 (1. d4 d5) e5 *");
  const d4 = tree.getOutgoing(tree.rootId).find((edge) => edge.san === "d4");
  const afterD4 = new Chess(tree.getNode(d4.to).fen);
  const d5 = afterD4.move("d5");
  const edge = tree.addMove(d4.to, d5, afterD4.fen());

  assert.equal(tree.getOutgoing(d4.to).some((candidate) => candidate.id === edge.id), true);
  assert.match(tree.toPgn(), /1\. d4 1\.\.\. d5/);
});

test("preserves a non-standard starting FEN", () => {
  const pgn = [
    '[SetUp "1"]',
    '[FEN "k7/8/8/8/8/8/8/4K3 w - - 0 1"]',
    "",
    "1. Kf2 *",
  ].join("\n");
  const tree = RepertoireTree.fromPgn(pgn);
  const restored = RepertoireTree.fromPgn(tree.toPgn());

  assert.equal(restored.rootFen, tree.rootFen);
  assert.equal(restored.edges.size, 1);
});

test("rejects unbalanced and illegal PGN variations", () => {
  assert.throws(() => RepertoireTree.fromPgn("1. e4 (1. d4 d5"), /parentesi/i);
  assert.throws(() => RepertoireTree.fromPgn("1. e4 (1. Qh5) e5"), /mossa PGN non valida/i);
});
