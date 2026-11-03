import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { RepertoireTree } from "../src/repertoire-tree.js";
import {
  analyzeOpponentPgn,
  buildWeaknessHeatmap,
  createErrorFlashcard,
  createMistakeFlashcards,
  getDueStudyCards,
  getTranspositionGroups,
  gradeStudyCard,
} from "../src/study-tools.js";

test("creates one FSRS flashcard when a game deviates from a known repertoire position", () => {
  const tree = RepertoireTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *");
  const result = createMistakeFlashcards(tree, "1. e4 c5 *");
  assert.equal(result.gamesRead, 1);
  assert.equal(result.cards.length, 1);
  assert.deepEqual(result.cards[0].expectedSan, ["e5"]);
  assert.equal(result.cards[0].actualSan, "c5");
  assert.equal(result.cards[0].source, "pgn-analysis");
});

test("does not generate duplicate cards for the same missed repertoire continuation", () => {
  const tree = RepertoireTree.fromPgn("1. e4 e5 *");
  const first = createMistakeFlashcards(tree, "1. e4 c5 *");
  const second = createMistakeFlashcards(tree, "1. e4 c5 *", first.cards);
  assert.equal(first.cards.length, 1);
  assert.equal(second.cards.length, 0);
});

test("creates and schedules error cards with FSRS review ratings", () => {
  const now = new Date("2026-01-01T12:00:00.000Z");
  const card = createErrorFlashcard({
    fen: new Chess().fen(),
    expectedSan: ["e4", "d4"],
    actualSan: "f3",
    now,
  });
  assert.equal(getDueStudyCards([card], now).length, 1);
  const reviewed = gradeStudyCard(card, "good", now);
  assert.equal(reviewed.reviewCount, 1);
  assert.equal(reviewed.lastRating, "good");
  assert.ok(reviewed.schedulerCard.due instanceof Date);
  assert.equal(reviewed.schedulerCard.reps, 1);
});

test("heatmap leaves positions without review data unmeasured", () => {
  const tree = RepertoireTree.fromPgn("1. e4 e5 *");
  const rows = buildWeaknessHeatmap(tree, []);
  assert.ok(rows.length >= 2);
  assert.ok(rows.every((row) => row.status === "unmeasured"));
});

test("opponent analysis counts openings, first moves and game results", () => {
  const pgn = [
    '[Event "Game 1"]',
    '[Opening "Sicilian Defense"]',
    '[ECO "B20"]',
    '[Result "0-1"]',
    "",
    "1. e4 c5 2. Nf3 d6 0-1",
    "",
    '[Event "Game 2"]',
    '[Opening "French Defense"]',
    '[Result "1/2-1/2"]',
    "",
    "1. e4 e6 2. d4 d5 1/2-1/2",
  ].join("\n");
  const report = analyzeOpponentPgn(pgn, "black");
  assert.equal(report.gameCount, 2);
  assert.equal(report.results.wins, 1);
  assert.equal(report.results.draws, 1);
  assert.equal(report.firstMoves[0].label, "c5");
  assert.equal(report.openings.length, 2);
});

test("shows the distinct paths that converge on a transposed position", () => {
  const tree = RepertoireTree.fromPgn("1. e4 (1. Nf3 Nc6 2. e4 e5) e5 2. Nf3 Nc6 *");
  const groups = getTranspositionGroups(tree);
  assert.ok(groups.length >= 1);
  assert.ok(groups.some((group) => group.paths.length >= 2));
});
