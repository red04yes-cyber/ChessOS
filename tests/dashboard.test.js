import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDashboardSnapshot,
  calculateExamResult,
  localDayKey,
  normalizeStudyGoal,
  selectExamQuestions,
  startOfLocalWeek,
} from "../src/dashboard.js";

const now = new Date(2026, 10, 3, 12, 0, 0);
const cards = [
  { id: "r1::e4", repertoireId: "r1", repertoireTitle: "Siciliana", side: "white", fsrs: { due: now.toISOString() } },
  { id: "r1::c5", repertoireId: "r1", repertoireTitle: "Siciliana", side: "black", fsrs: { due: now.toISOString() } },
  { id: "r2::d4", repertoireId: "r2", repertoireTitle: "Gambetto", side: "white", fsrs: { due: now.toISOString() } },
];

test("groups local-day reviews and calculates daily/weekly recall and time", () => {
  const snapshot = buildDashboardSnapshot({
    repertoires: [{ id: "r1", title: "Siciliana" }],
    reviewCards: cards,
    reviewLogs: [
      { cardId: "r1::e4", reviewedAt: now.toISOString(), elapsedMs: 60000, rating: 3, stateJson: JSON.stringify({ recalled: true }) },
      { cardId: "r1::c5", reviewedAt: now.toISOString(), elapsedMs: 30000, rating: 1, stateJson: JSON.stringify({ recalled: false }) },
    ],
    sessions: [{ startedAt: now.toISOString() }],
    goals: [],
  }, now);

  assert.equal(snapshot.today.reviews, 2);
  assert.equal(snapshot.today.recalled, 1);
  assert.equal(snapshot.today.accuracy, 50);
  assert.equal(snapshot.today.minutes, 2);
  assert.equal(snapshot.today.sessions, 1);
  assert.equal(snapshot.week.reviews, 2);
  assert.equal(snapshot.overview.totalMoves, 3);
  assert.equal(snapshot.overview.reviewedCards, 2);
  assert.equal(snapshot.repertoires[0].accuracy, 50);
});

test("builds a seven-day daily trend and six-week weekly trend", () => {
  const snapshot = buildDashboardSnapshot({}, now);
  assert.equal(snapshot.dailyTrend.length, 7);
  assert.equal(snapshot.weeklyTrend.length, 6);
  assert.equal(snapshot.dailyTrend.at(-1).key, localDayKey(now));
  assert.equal(startOfLocalWeek(now).getDay(), 1);
});

test("counts first attempts only once for repertoire coverage", () => {
  const snapshot = buildDashboardSnapshot({
    repertoires: [{ id: "r1", title: "Linea" }],
    reviewCards: cards,
    reviewLogs: [
      { cardId: "r1::e4", reviewedAt: now.toISOString(), rating: 3, stateJson: JSON.stringify({ recalled: true }) },
      { cardId: "r1::e4", reviewedAt: now.toISOString(), rating: 4, stateJson: JSON.stringify({ recalled: true }) },
    ],
  }, now);
  assert.equal(snapshot.repertoires[0].reviewedCards, 1);
  assert.equal(snapshot.repertoires[0].reviews, 2);
  assert.equal(snapshot.repertoires[0].reviewCoverage, 50);
});

test("selects unique exam questions within a repertoire and side", () => {
  const questions = selectExamQuestions(cards, {
    repertoireId: "r1",
    side: "white",
    count: 10,
    random: () => 0,
  });
  assert.equal(questions.length, 1);
  assert.equal(questions[0].id, "r1::e4");
});

test("calculates exam pass threshold", () => {
  assert.deepEqual(calculateExamResult([
    { correct: true }, { correct: true }, { correct: false }, { correct: true },
  ], 70), {
    total: 4, correct: 3, incorrect: 1, accuracy: 75, passed: true, passThreshold: 70,
  });
  assert.equal(calculateExamResult([{ correct: false }], 70).passed, false);
});

test("validates daily/weekly study goals", () => {
  assert.deepEqual(normalizeStudyGoal({
    period: "daily", targetReviews: "20", targetMinutes: "30", targetAccuracy: "85",
  }), { period: "daily", targetReviews: 20, targetMinutes: 30, targetAccuracy: 85 });
  assert.throws(() => normalizeStudyGoal({
    period: "monthly", targetReviews: 20, targetMinutes: 30, targetAccuracy: 85,
  }));
  assert.throws(() => normalizeStudyGoal({
    period: "daily", targetReviews: 20, targetMinutes: 30, targetAccuracy: 101,
  }));
});


test("ignores malformed review timestamps and reads legacy snake_case fields", () => {
  const snapshot = buildDashboardSnapshot({
    repertoires: [{ id: "r1", title: "Linea" }],
    reviewCards: [{ id: "card-1", repertoireId: "r1", repertoire_id: "r1", fsrs: { due: now.toISOString() } }],
    reviewLogs: [
      {
        card_id: "card-1",
        reviewed_at: now.toISOString(),
        elapsed_ms: 90_000,
        rating: 3,
        state_json: JSON.stringify({ recalled: true }),
      },
      { cardId: "card-1", reviewedAt: "not-a-date", elapsedMs: 60_000, rating: 1 },
    ],
    sessions: [{ started_at: now.toISOString() }],
  }, now);

  assert.equal(snapshot.today.reviews, 1);
  assert.equal(snapshot.today.minutes, 2);
  assert.equal(snapshot.today.accuracy, 100);
  assert.equal(snapshot.today.sessions, 1);
  assert.equal(snapshot.repertoires[0].reviews, 1);
});

test("returns neutral empty-state metrics when no reviews or cards exist", () => {
  const snapshot = buildDashboardSnapshot({}, now);
  assert.equal(snapshot.today.reviews, 0);
  assert.equal(snapshot.today.accuracy, null);
  assert.equal(snapshot.overview.totalReviews, 0);
  assert.equal(snapshot.overview.overallAccuracy, null);
  assert.equal(snapshot.overview.dueCards, 0);
});

test("starts the week on Monday for a Sunday input and rejects invalid day keys", () => {
  const sunday = new Date(2026, 10, 1, 14, 30);
  const monday = startOfLocalWeek(sunday);
  assert.equal(monday.getDay(), 1);
  assert.equal(localDayKey(monday), "2026-10-26");
  assert.equal(localDayKey(new Date("invalid")), "");
});

test("returns fewer exam questions when the eligible pool is smaller than requested", () => {
  const selected = selectExamQuestions(cards, {
    repertoireId: "r1",
    side: "both",
    count: 500,
    random: () => 0.5,
  });
  assert.equal(selected.length, 2);
  assert.equal(new Set(selected.map((card) => card.id)).size, 2);
  assert.deepEqual(selectExamQuestions(cards, { repertoireId: "missing", count: 10 }), []);
});

test("handles empty exams and rejects invalid question counts and thresholds", () => {
  assert.deepEqual(calculateExamResult([], 70), {
    total: 0, correct: 0, incorrect: 0, accuracy: 0, passed: false, passThreshold: 70,
  });
  assert.throws(() => selectExamQuestions(cards, { repertoireId: "r1", count: 0 }), /Numero di domande/i);
  assert.throws(() => selectExamQuestions(cards, { repertoireId: "r1", count: 501 }), /Numero di domande/i);
  assert.throws(() => calculateExamResult([], 0), /Soglia/i);
  assert.throws(() => calculateExamResult([], 101), /Soglia/i);
});

test("accepts study-goal boundaries and rejects fractional values", () => {
  assert.deepEqual(normalizeStudyGoal({
    period: "weekly", targetReviews: 10_000, targetMinutes: 1, targetAccuracy: 100,
  }), { period: "weekly", targetReviews: 10_000, targetMinutes: 1, targetAccuracy: 100 });
  assert.throws(() => normalizeStudyGoal({
    period: "daily", targetReviews: 1.5, targetMinutes: 20, targetAccuracy: 80,
  }), /ripassi/i);
});
