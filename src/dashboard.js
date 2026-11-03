function parseMetadata(log) {
  const raw = log?.stateJson ?? log?.state_json;
  if (typeof raw !== "string") return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function timestampOf(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function localDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function startOfLocalWeek(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const dayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayOffset);
  return date;
}

function addLocalDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function addLocalWeeks(value, weeks) {
  return addLocalDays(value, weeks * 7);
}

function percent(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : null;
}

function aggregateLogs(logs) {
  const reviews = logs.length;
  const recalled = logs.reduce((sum, log) => sum + (log.recalled ? 1 : 0), 0);
  const elapsedMs = logs.reduce((sum, log) => sum + log.elapsedMs, 0);
  return {
    reviews,
    recalled,
    missed: reviews - recalled,
    accuracy: percent(recalled, reviews),
    minutes: Math.round(elapsedMs / 60000),
  };
}

function goalFor(period, goals) {
  return goals.find((goal) => goal.period === period) || {
    period,
    targetReviews: period === "daily" ? 20 : 100,
    targetMinutes: period === "daily" ? 20 : 120,
    targetAccuracy: 80,
  };
}

function goalProgress(goal, actual) {
  return {
    ...goal,
    actualReviews: actual.reviews,
    actualMinutes: actual.minutes,
    actualAccuracy: actual.accuracy,
    reviewPercent: Math.min(100, percent(actual.reviews, goal.targetReviews) ?? 0),
    minutePercent: Math.min(100, percent(actual.minutes, goal.targetMinutes) ?? 0),
    accuracyPercent: actual.accuracy == null
      ? 0
      : Math.min(100, percent(actual.accuracy, goal.targetAccuracy) ?? 0),
  };
}

export function buildDashboardSnapshot({
  repertoires = [],
  reviewCards = [],
  reviewLogs = [],
  sessions = [],
  goals = [],
  examAttempts = [],
} = {}, now = new Date()) {
  const cardById = new Map(reviewCards.map((card) => [card.id, card]));
  const normalizedLogs = reviewLogs.map((log) => {
    const metadata = parseMetadata(log);
    const cardId = log.cardId ?? log.card_id;
    const card = cardById.get(cardId);
    const elapsedMs = Number(log.elapsedMs ?? log.elapsed_ms);
    return {
      cardId,
      repertoireId: card?.repertoireId ?? card?.repertoire_id ?? null,
      reviewedAt: log.reviewedAt ?? log.reviewed_at,
      timestamp: timestampOf(log.reviewedAt ?? log.reviewed_at),
      recalled: typeof metadata.recalled === "boolean"
        ? metadata.recalled
        : Number(log.rating) > 1,
      elapsedMs: Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0,
    };
  }).filter((log) => log.timestamp > 0);

  const today = localDayKey(now);
  const weekStart = startOfLocalWeek(now);
  const nextWeekStart = addLocalWeeks(weekStart, 1);
  const todayLogs = normalizedLogs.filter((log) => localDayKey(log.reviewedAt) === today);
  const weekLogs = normalizedLogs.filter((log) => (
    log.timestamp >= weekStart.getTime() && log.timestamp < nextWeekStart.getTime()
  ));
  const dailyActual = aggregateLogs(todayLogs);
  const weeklyActual = aggregateLogs(weekLogs);

  const dailyTrend = Array.from({ length: 7 }, (_, index) => {
    const date = addLocalDays(now, index - 6);
    const key = localDayKey(date);
    const summary = aggregateLogs(normalizedLogs.filter((log) => localDayKey(log.reviewedAt) === key));
    return { key, label: new Intl.DateTimeFormat("it-IT", { weekday: "short" }).format(date), ...summary };
  });

  const weeklyTrend = Array.from({ length: 6 }, (_, index) => {
    const start = addLocalWeeks(weekStart, index - 5);
    const end = addLocalWeeks(start, 1);
    const summary = aggregateLogs(normalizedLogs.filter((log) => (
      log.timestamp >= start.getTime() && log.timestamp < end.getTime()
    )));
    return {
      key: localDayKey(start),
      label: new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short" }).format(start),
      ...summary,
    };
  });

  const repertoireSummaries = repertoires.map((line) => {
    const cards = reviewCards.filter((card) => card.repertoireId === line.id);
    const cardIds = new Set(cards.map((card) => card.id));
    const logs = normalizedLogs.filter((log) => cardIds.has(log.cardId));
    const summary = aggregateLogs(logs);
    const reviewedCards = new Set(logs.map((log) => log.cardId)).size;
    const lastReview = logs.reduce((latest, log) => Math.max(latest, log.timestamp), 0);
    return {
      id: line.id,
      title: line.title || "Linea senza nome",
      moveCount: cards.length,
      reviewedCards,
      accuracy: summary.accuracy,
      reviews: summary.reviews,
      lastReview: lastReview ? new Date(lastReview).toISOString() : null,
      reviewCoverage: cards.length ? Math.round((reviewedCards / cards.length) * 100) : 0,
    };
  }).sort((a, b) => b.reviews - a.reviews || a.title.localeCompare(b.title, "it"));

  const sessionsToday = sessions.filter((session) => localDayKey(session.startedAt ?? session.started_at) === today).length;
  const sessionsThisWeek = sessions.filter((session) => {
    const startedAt = timestampOf(session.startedAt ?? session.started_at);
    return startedAt >= weekStart.getTime() && startedAt < nextWeekStart.getTime();
  }).length;

  const dailyGoal = goalProgress(goalFor("daily", goals), dailyActual);
  const weeklyGoal = goalProgress(goalFor("weekly", goals), weeklyActual);
  const reviewedCards = new Set(normalizedLogs.map((log) => log.cardId).filter(Boolean)).size;
  const totalMoves = reviewCards.length;
  const totalReviews = normalizedLogs.length;
  const totalRecall = aggregateLogs(normalizedLogs);
  const dueCards = reviewCards.filter((card) => timestampOf(card.fsrs?.due) <= now.getTime()).length;

  return {
    today: { ...dailyActual, sessions: sessionsToday, goal: dailyGoal },
    week: { ...weeklyActual, sessions: sessionsThisWeek, goal: weeklyGoal },
    dailyTrend,
    weeklyTrend,
    repertoires: repertoireSummaries,
    overview: {
      repertoireCount: repertoires.length,
      totalMoves,
      reviewedCards,
      totalReviews,
      overallAccuracy: totalRecall.accuracy,
      dueCards,
    },
    exams: [...examAttempts].sort((a, b) => (
      timestampOf(b.startedAt ?? b.started_at) - timestampOf(a.startedAt ?? a.started_at)
    )).slice(0, 10),
  };
}

export function selectExamQuestions(cards, {
  repertoireId,
  side = "both",
  count = 10,
  random = Math.random,
} = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    throw new RangeError("Numero di domande non valido.");
  }
  const candidates = cards.filter((card) => (
    card.repertoireId === repertoireId && (side === "both" || card.side === side)
  ));
  if (!candidates.length) return [];
  const shuffled = [...candidates];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const sample = random();
    const swapIndex = Math.min(index, Math.max(0, Math.floor(sample * (index + 1))));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, Math.min(count, candidates.length));
}

export function calculateExamResult(answers, passThreshold = 70) {
  if (!Number.isInteger(passThreshold) || passThreshold < 1 || passThreshold > 100) {
    throw new RangeError("Soglia di superamento non valida.");
  }
  const total = answers.length;
  const correct = answers.filter((answer) => answer.correct === true || answer.correct === 1).length;
  const accuracy = percent(correct, total);
  return {
    total,
    correct,
    incorrect: total - correct,
    accuracy: accuracy ?? 0,
    passed: total > 0 && accuracy >= passThreshold,
    passThreshold,
  };
}

export function normalizeStudyGoal(goal) {
  const period = goal?.period;
  if (period !== "daily" && period !== "weekly") throw new RangeError("Periodo obiettivo non valido.");
  const targetReviews = Number(goal.targetReviews);
  const targetMinutes = Number(goal.targetMinutes);
  const targetAccuracy = Number(goal.targetAccuracy);
  if (!Number.isInteger(targetReviews) || targetReviews < 1 || targetReviews > 10000) {
    throw new RangeError("Obiettivo ripassi non valido.");
  }
  if (!Number.isInteger(targetMinutes) || targetMinutes < 1 || targetMinutes > 10000) {
    throw new RangeError("Obiettivo minuti non valido.");
  }
  if (!Number.isInteger(targetAccuracy) || targetAccuracy < 1 || targetAccuracy > 100) {
    throw new RangeError("Obiettivo precisione non valido.");
  }
  return { period, targetReviews, targetMinutes, targetAccuracy };
}
