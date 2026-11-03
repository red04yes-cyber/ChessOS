import test from "node:test";
import assert from "node:assert/strict";
import {
  gradeMistakeFlashcard,
  selectDueMistakeFlashcards,
  upsertMistakeFlashcards,
} from "../src/mistake-flashcards.js";

const now = new Date("2026-11-03T12:00:00.000Z");
const mistake = {
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  bestUci: "e2e4",
  bestSan: "e4",
  playedSan: "d4",
  lossCp: 180,
  category: "mistake",
  opening: "Italian Game",
};

test("creates stable FSRS flashcards from game mistakes and de-duplicates positions", () => {
  const created = upsertMistakeFlashcards([], [mistake, mistake], now);
  assert.equal(created.added, 1);
  assert.equal(created.updated, 1);
  assert.equal(created.cards.length, 1);
  assert.equal(created.cards[0].expectedSan, "e4");
  assert.equal(created.cards[0].fsrs.reps, 0);
  const samePositionDifferentCounters = upsertMistakeFlashcards([], [{
    ...mistake,
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 18 99",
  }], now);
  assert.equal(samePositionDifferentCounters.cards[0].id, created.cards[0].id);
});

test("updates mistake context without resetting FSRS scheduling state", () => {
  const first = upsertMistakeFlashcards([], [mistake], now).cards[0];
  const reviewed = gradeMistakeFlashcard(first, "good", now);
  const updated = upsertMistakeFlashcards([reviewed], [{ ...mistake, lossCp: 240, playedSan: "c4" }], new Date("2026-11-04T12:00:00.000Z"));
  assert.equal(updated.added, 0);
  assert.equal(updated.updated, 1);
  assert.equal(updated.cards[0].fsrs.reps, 1);
  assert.equal(updated.cards[0].playedSan, "c4");
  assert.equal(updated.cards[0].lossCp, 240);
});

test("selects only due cards and applies FSRS ratings", () => {
  const card = upsertMistakeFlashcards([], [mistake], now).cards[0];
  assert.equal(selectDueMistakeFlashcards([card], now).length, 1);
  const graded = gradeMistakeFlashcard(card, "again", now);
  assert.equal(graded.fsrs.reps, 1);
  assert.equal(graded.lastRating, "again");
  const next = selectDueMistakeFlashcards([graded], new Date("2026-11-03T12:00:30.000Z"));
  assert.equal(next.length, 0);
});
