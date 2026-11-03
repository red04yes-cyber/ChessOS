import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { ENDGAME_CATALOG, ENDGAME_LESSONS } from "../src/endgame-catalog.js";
import { RepertoireTree } from "../src/repertoire-tree.js";
import { analyzeOpeningExplorer, buildRepertoireFromPgn } from "../src/chess-suite.js";

test("endgame curriculum has extensive coverage and every training FEN is parseable", () => {
  assert.equal(ENDGAME_CATALOG.length, 10);
  assert.ok(ENDGAME_LESSONS.length >= 130);
  for (const section of ENDGAME_CATALOG) {
    assert.ok(section.lessons.length > 0);
    for (const lesson of section.lessons) {
      assert.ok(lesson.objective.length > 10);
      assert.ok(lesson.method.length > 10);
      assert.ok(lesson.errors.length > 5);
      assert.doesNotThrow(() => new Chess(lesson.fen), lesson.title);
    }
  }
});

test("opening explorer counts observed moves and surfaces gaps against repertoire", () => {
  const repertoire = RepertoireTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *");
  const report = analyzeOpeningExplorer(repertoire.toPgn(), repertoire, { minimum: 1, maxPly: 8 });
  assert.equal(report.gamesRead, 1);
  assert.ok(report.positions.length > 0);

  const sample = "1. e4 c5 2. Nf3 d6 *";
  const gaps = analyzeOpeningExplorer(sample, repertoire, { minimum: 1, maxPly: 8 });
  assert.equal(gaps.gamesRead, 1);
  assert.ok(gaps.gapCount >= 1);
  const firstGap = gaps.positions.find((item) => item.missing.length > 0);
  assert.ok(firstGap);
  assert.equal(firstGap.missing[0].san, "c5");
});

test("repertoire generator merges common branches and records sample frequencies", () => {
  const pgn = [
    '[Event "Game 1"]',
    "",
    "1. e4 e5 2. Nf3 Nc6 *",
    "",
    '[Event "Game 2"]',
    "",
    "1. e4 e5 2. Nf3 d6 *",
    "",
    '[Event "Game 3"]',
    "",
    "1. d4 d5 2. c4 e6 *",
  ].join("\n");
  const result = buildRepertoireFromPgn(pgn, "white", 1, 10);
  assert.equal(result.gamesRead, 3);
  assert.ok(result.positionCount > 4);
  assert.ok(result.moveCount > 4);
  const e4 = [...result.tree.edges.values()].find((edge) => edge.san === "e4");
  assert.ok(e4);
  assert.match(e4.comment, /2 partite/);
  assert.equal(result.side, "white");
});

test("repertoire generator applies the minimum frequency filter", () => {
  const pgn = [
    '[Event "A"]',
    "",
    "1. e4 e5 2. Nf3 Nc6 *",
    "",
    '[Event "B"]',
    "",
    "1. e4 c5 2. Nf3 d6 *",
    "",
    '[Event "C"]',
    "",
    "1. e4 e5 2. Nf3 Nc6 *",
  ].join("\n");
  const result = buildRepertoireFromPgn(pgn, "white", 2, 10);
  const rootMoves = result.tree.getOutgoing(result.tree.rootId).map((edge) => edge.san);
  assert.deepEqual(rootMoves, ["e4"]);
  const afterE4 = result.tree.getOutgoing(result.tree.getEdge(result.tree.rootId + "|e2e4")?.to);
  assert.ok(afterE4.some((edge) => edge.san === "e5"));
  assert.ok(!afterE4.some((edge) => edge.san === "c5"));
});
