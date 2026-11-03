import test from "node:test";
import assert from "node:assert/strict";
import { RepertoireTree } from "../src/repertoire-tree.js";
import {
  analyzeOpponentPreparation,
  buildWeaknessHeatmap,
  centipawnLoss,
  classifyMoveLoss,
  isForcingTacticalMove,
  analyzeGameWithStockfish,
} from "../src/chess-improvements.js";

test("classifies centipawn loss with conservative chess-training thresholds", () => {
  assert.equal(classifyMoveLoss(35), "good");
  assert.equal(classifyMoveLoss(50), "inaccuracy");
  assert.equal(classifyMoveLoss(145), "mistake");
  assert.equal(classifyMoveLoss(260), "blunder");
  assert.equal(classifyMoveLoss(null), "unknown");
  assert.equal(centipawnLoss({ scoreCp: 80 }, { scoreCp: -160 }), 0);
  assert.equal(centipawnLoss({ scoreCp: 80 }, { scoreCp: 70 }), 150);
  assert.equal(centipawnLoss({ scoreCp: null }, { scoreCp: 10 }), null);
});

test("accepts only forcing tactical PVs for puzzle candidates", () => {
  const captureFen = "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1";
  assert.equal(isForcingTacticalMove(captureFen, ["e4d5"]), true);
  assert.equal(isForcingTacticalMove(captureFen, ["e1e2"]), false);
  assert.equal(isForcingTacticalMove(captureFen, ["e1e2", "e8d7", "e2d3"]), false);
});

test("opponent preparation filters named players and reports openings and recurring moves", () => {
  const pgn = [
    '[Event "Game 1"]',
    '[White "Alice"]',
    '[Black "Bob"]',
    '[Opening "Italian Game"]',
    '[Date "2025.01.15"]',
    '[Result "1-0"]',
    "",
    "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 1-0",
    "",
    '[Event "Game 2"]',
    '[White "Carol"]',
    '[Black "Bob"]',
    '[Opening "Sicilian Defense"]',
    '[Date "2025.03.02"]',
    '[Result "0-1"]',
    "",
    "1. e4 c5 2. Nf3 d6 3. d4 cxd4 0-1",
    "",
    '[Event "Other"]',
    '[White "Alice"]',
    '[Black "Carol"]',
    '[Opening "French Defense"]',
    '[Result "1/2-1/2"]',
    "",
    "1. e4 e6 2. d4 d5 1/2-1/2",
  ].join("\n");
  const report = analyzeOpponentPreparation(pgn, "Bob", "both", 12);
  assert.equal(report.gamesRead, 2);
  assert.equal(report.colors.black, 2);
  assert.equal(report.openings.length, 2);
  assert.equal(report.openings[0].games, 1);
  assert.deepEqual(report.period, { from: "2025-01-15", to: "2025-03-02", datedGames: 2 });
  assert.equal(report.results.win, 1);
  assert.equal(report.results.loss, 1);
  assert.ok(report.firstMoves.some((move) => move.san === "e5"));
  assert.ok(report.movePreferences[0].moves.some((move) => move.san === "e5"));
});

test("weakness heatmap marks low-accuracy repertoire positions and flags missing evidence", () => {
  const tree = RepertoireTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *");
  const root = tree.getNode(tree.rootId);
  const e4 = tree.getOutgoing(root.id).find((edge) => edge.san === "e4");
  const e5 = tree.getOutgoing(e4.to).find((edge) => edge.san === "e5");
  const cards = [
    { id: "card-e4", edgeId: e4.id, positionId: e4.from, fen: root.fen, san: e4.san, fsrs: { due: "2026-11-02T00:00:00.000Z" } },
    { id: "card-e5", edgeId: e5.id, positionId: e5.from, fen: tree.getNode(e5.from).fen, san: e5.san, fsrs: { due: "2026-11-10T00:00:00.000Z" } },
  ];
  const logs = [
    { cardId: "card-e4", rating: 1, stateJson: JSON.stringify({ recalled: false }) },
    { cardId: "card-e4", rating: 1, stateJson: JSON.stringify({ recalled: false }) },
    { cardId: "card-e4", rating: 3, stateJson: JSON.stringify({ recalled: true }) },
  ];
  const report = buildWeaknessHeatmap(tree, cards, logs, new Date("2026-11-03T12:00:00.000Z"));
  assert.equal(report.totalMoves, 2);
  const weak = report.positions.find((position) => position.key === e4.from);
  assert.equal(weak.accuracy, 33);
  assert.equal(weak.label, "Debolezza alta");
  const unknown = report.positions.find((position) => position.key === e5.from);
  assert.equal(unknown.weaknessScore, null);
  assert.equal(unknown.label, "Non ancora misurabile");
});

test("game report classifies a played move only when Stockfish prefers another move", async () => {
  const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
  const afterE5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
  const values = new Map([
    [start, { scoreCp: 0, bestSan: "e4", bestmove: "e2e4", pvSan: ["e4"], pvUci: ["e2e4"] }],
    [afterE4, { scoreCp: 100, bestSan: "Nf6", bestmove: "g8f6", pvSan: ["Nf6"], pvUci: ["g8f6"] }],
    [afterE5, { scoreCp: 100, bestSan: "Nf3", bestmove: "g1f3", pvSan: ["Nf3"], pvUci: ["g1f3"] }],
  ]);
  const engine = {
    async analyze(fen) { return values.get(fen.trim()) || { scoreCp: 0, bestSan: null, bestmove: null, pvSan: [], pvUci: [] }; },
  };
  const report = await analyzeGameWithStockfish([
    '[Event "Test"]', '[White "Alice"]', '[Black "Bob"]', '[Result "*"]', "",
    "1. e4 e5 *",
  ].join("\n"), engine, { maxGames: 1, maxPlies: 4, depth: 10 });

  assert.equal(report.gamesRead, 1);
  assert.equal(report.pliesAnalyzed, 2);
  assert.equal(report.mistakes.length, 1);
  assert.equal(report.mistakes[0].playedSan, "e5");
  assert.equal(report.mistakes[0].bestSan, "Nf6");
  assert.equal(report.mistakes[0].lossCp, 200);
  assert.equal(report.categories.blunder, 1);
});
