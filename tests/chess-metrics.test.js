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
