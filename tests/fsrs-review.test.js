import test from "node:test";
import assert from "node:assert/strict";
import { State } from "ts-fsrs";
import {
  buildReviewCards,
  countDueCards,
  countReviewsToday,
  createFsrsCard,
  gradeFsrsCard,
  getTodayReviewStats,
  FSRS_MODEL_VERSION,
  FSRS_PACKAGE_VERSION,
  parseUci,
  selectDailyCards,
} from "../src/fsrs-review.js";

const now = new Date("2026-11-03T12:00:00.000Z");
const line = {
  id: "sicilian",
  title: "Siciliana",
  pgn: "1. e4 c5 2. Nf3 d6 *",
};

test("creates one stable card per repertoire move, with the side to train", () => {
  const cards = buildReviewCards([line], [], now);
  assert.equal(cards.length, 4);
  assert.equal(cards[0].side, "white");
  assert.equal(cards[1].side, "black");
  assert.equal(cards[0].san, "e4");
  assert.equal(cards[1].san, "c5");
  assert.equal(cards[0].fen, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  assert.equal(new Set(cards.map((card) => card.id)).size, cards.length);
});

test("keeps existing FSRS memory when repertoire cards are rebuilt", () => {
  const first = buildReviewCards([line], [], now);
  const reviewed = gradeFsrsCard(first[0].fsrs, "good", now);
  const persisted = [{
    id: first[0].id,
    fsrsJson: JSON.stringify(reviewed.card),
    createdAt: "2026-11-01T10:00:00.000Z",
  }];
  const rebuilt = buildReviewCards([line], persisted, now);
  assert.equal(rebuilt[0].fsrs.reps, 1);
  assert.equal(rebuilt[0].fsrs.due, reviewed.card.due);
  assert.equal(rebuilt[0].createdAt, persisted[0].createdAt);
});

test("FSRS card state records and enforces its schema, model and package versions", () => {
  const fresh = createFsrsCard(now);
  assert.equal(fresh.fsrsModelVersion, FSRS_MODEL_VERSION);
  assert.equal(fresh.fsrsPackageVersion, FSRS_PACKAGE_VERSION);
  assert.throws(() => gradeFsrsCard({ ...fresh, fsrsModelVersion: "FSRS-7" }, "good", now));
});

test("FSRS-6 ratings produce ordered learning outcomes and a persisted review log", () => {
  const fresh = createFsrsCard(now);
  const again = gradeFsrsCard(fresh, "again", now);
  const hard = gradeFsrsCard(fresh, "hard", now);
  const good = gradeFsrsCard(fresh, "good", now);
  const easy = gradeFsrsCard(fresh, "easy", now);

  assert.equal(again.card.reps, 1);
  assert.equal(good.card.reps, 1);
  assert.equal(again.log.rating, 1);
  assert.equal(hard.log.rating, 2);
  assert.equal(good.log.rating, 3);
  assert.equal(easy.log.rating, 4);
  assert.ok(new Date(again.dueAt) < new Date(hard.dueAt));
  assert.ok(new Date(hard.dueAt) <= new Date(good.dueAt));
  assert.ok(new Date(good.dueAt) < new Date(easy.dueAt));
  assert.equal(good.log.review, now.toISOString());
});

test("daily selection filters by due date and side, limiting only new cards", () => {
  const cards = buildReviewCards([line], [], now);
  const overdueReview = {
    ...cards[1],
    fsrs: {
      ...cards[1].fsrs,
      state: State.Review,
      due: "2026-11-02T12:00:00.000Z",
    },
  };
  const notDue = {
    ...cards[2],
    fsrs: { ...cards[2].fsrs, due: "2026-11-04T12:00:00.000Z" },
  };
  const due = [cards[0], overdueReview, cards[3], notDue];
  assert.equal(countDueCards(due, now, "both"), 3);
  assert.equal(countDueCards(due, now, "black"), 2);
  const whiteOnly = selectDailyCards(due, now, "white", 1);
  assert.deepEqual(whiteOnly.map((card) => card.id), [cards[0].id]);
  const bothSides = selectDailyCards(due, now, "both", 1);
  assert.deepEqual(bothSides.map((card) => card.id), [overdueReview.id, cards[0].id]);
  assert.deepEqual(selectDailyCards(due, now, "both", 0).map((card) => card.id), [overdueReview.id]);
});

test("counts reviews made on the local calendar day", () => {
  const logs = [
    { reviewedAt: now.toISOString() },
    { reviewedAt: new Date(now.getTime() - 60_000).toISOString() },
    { reviewedAt: new Date(2026, 10, 2, 23, 59).toISOString() },
  ];
  assert.equal(countReviewsToday(logs, now), 2);
  assert.deepEqual(getTodayReviewStats([
    ...logs,
    {
      cardId: "new-card",
      reviewedAt: now.toISOString(),
      rating: 4,
      stateJson: JSON.stringify({ state: State.New, recalled: false }),
    },
    {
      cardId: "review-card",
      reviewedAt: now.toISOString(),
      rating: 2,
      stateJson: JSON.stringify({ state: State.Review, recalled: false }),
    },
    {
      cardId: "correct-card",
      reviewedAt: now.toISOString(),
      rating: 3,
      stateJson: JSON.stringify({ state: State.Review, recalled: true }),
    },
  ], now), {
    reviews: 5,
    again: 0,
    correct: 1,
    accuracy: 20,
    newCardsReviewed: 1,
  });
});

test("parses UCI moves including underpromotion", () => {
  assert.deepEqual(parseUci("e7e8n"), { from: "e7", to: "e8", promotion: "n" });
  assert.deepEqual(parseUci("e2e4"), { from: "e2", to: "e4" });
  assert.throws(() => parseUci("invalid"));
});
