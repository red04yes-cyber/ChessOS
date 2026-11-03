import test from "node:test";
import assert from "node:assert/strict";
import { accuracyFromLosses, buildMoveReview, classifyMoveQuality, timelineFromPgn } from "../src/chess-metrics.js";

test("replays PGN into a legal list of FEN positions and moves", () => {
  const timeline = timelineFromPgn('[Event "Test"]\n[White "Player"]\n[Black "Other"]\n\n1. e4 e5 2. Nf3 *');
  assert.equal(timeline.moves.length, 3);
  assert.equal(timeline.positions.length, 4);
  assert.equal(timeline.positions[1].split(" ")[0], "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR");
});

test("calculates a bounded accuracy estimate from average centipawn loss", () => {
  assert.equal(accuracyFromLosses([0, 0]), 100);
  assert.ok(accuracyFromLosses([100]) < 100);
  assert.equal(accuracyFromLosses([]), null);
});

test("classifies every move quality band, including conservative brilliant candidates", () => {
  assert.equal(classifyMoveQuality(5, false, true), "Migliore");
  assert.equal(classifyMoveQuality(15), "Eccellente");
  assert.equal(classifyMoveQuality(40), "Buona");
  assert.equal(classifyMoveQuality(80), "Imprecisione");
  assert.equal(classifyMoveQuality(150), "Errore");
  assert.equal(classifyMoveQuality(300), "Svista");
  assert.equal(classifyMoveQuality(10, true), "Brillante");
});

test("review produces both-color accuracy, move rows and puzzles for the account side", () => {
  const timeline = timelineFromPgn('[Event "Test"]\n[White "myuser"]\n[Black "other"]\n\n1. e4 e5 *');
  const evaluations = [
    { info: { scoreType: "cp", score: 30, pv: ["e2e4", "e7e5"] } },
    { info: { scoreType: "cp", score: 30, pv: ["e7e5", "g1f3"] } },
    { info: { scoreType: "cp", score: -20, pv: ["g1f3"] } },
  ];
  const result = buildMoveReview(timeline.positions, timeline.moves, evaluations, {
    headers: timeline.headers,
    playerNames: ["myuser"],
  });
  assert.equal(result.playerSide, "w");
  assert.equal(result.rows.length, 2);
  assert.equal(typeof result.whiteAccuracy, "number");
  assert.equal(result.puzzles.length, 0);
});

test("turns a large account-side mistake into a one-move training puzzle", () => {
  const pgn = [
    '[Event "Puzzle source"]',
    '[SetUp "1"]',
    '[FEN "2r1k3/8/8/8/8/8/8/1N2K3 w - - 0 1"]',
    '[White "myuser"]',
    '[Black "opponent"]',
    "",
    "1. Nc3 *",
  ].join("\n");
  const timeline = timelineFromPgn(pgn);
  const result = buildMoveReview(timeline.positions, timeline.moves, [
    { info: { scoreType: "cp", score: 300, pv: ["e1f2"] } },
    { info: { scoreType: "cp", score: 0, pv: ["c8c3"] } },
  ], { headers: timeline.headers, playerNames: ["myuser"] });
  assert.equal(result.puzzles.length, 1);
  assert.equal(result.puzzles[0].solutionUci, "e1f2");
  assert.equal(result.puzzles[0].quality, "Svista");
});
