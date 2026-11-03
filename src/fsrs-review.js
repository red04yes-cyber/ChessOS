import { Chess } from "chess.js";
import { createEmptyCard, fsrs, Rating, State } from "ts-fsrs";
import { RepertoireTree } from "./repertoire-tree.js";

export const FSRS_PACKAGE_VERSION = "5.4.2";
export const FSRS_MODEL_VERSION = "FSRS-6";
export const NEW_CARDS_PER_DAY = 20;

export const FSRS_SETTINGS = Object.freeze({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
});

const scheduler = fsrs(FSRS_SETTINGS);
const ratingMap = Object.freeze({
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
});
const stateNames = Object.freeze({
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
});

export function createFsrsCard(now = new Date()) {
  return serializeFsrsCard(createEmptyCard(now));
}

export function serializeFsrsCard(card) {
  return {
    ...card,
    due: new Date(card.due).toISOString(),
    last_review: card.last_review ? new Date(card.last_review).toISOString() : null,
  };
}

export function hydrateFsrsCard(card) {
  if (!card || typeof card !== "object") throw new TypeError("Stato FSRS mancante.");
  const due = new Date(card.due);
  if (Number.isNaN(due.getTime())) throw new TypeError("Scadenza FSRS non valida.");
  const lastReview = card.last_review ? new Date(card.last_review) : undefined;
  if (lastReview && Number.isNaN(lastReview.getTime())) {
    throw new TypeError("Data dell'ultimo ripasso non valida.");
  }
  return {
    ...card,
    due,
    last_review: lastReview,
  };
}

function storedFsrsState(record) {
  if (record?.fsrs && typeof record.fsrs === "object") return record.fsrs;
  if (typeof record?.fsrsJson === "string") {
    try { return JSON.parse(record.fsrsJson); } catch { return null; }
  }
  return null;
}

function makeCardId(repertoireId, edgeId) {
  return encodeURIComponent(repertoireId) + "::" + encodeURIComponent(edgeId);
}

export function buildReviewCards(repertoires, persistedCards = [], now = new Date()) {
  const savedById = new Map(persistedCards.map((card) => [card.id, card]));
  const cards = [];

  for (const line of repertoires) {
    let tree;
    try {
      tree = line.tree ? RepertoireTree.fromJSON(line.tree) : RepertoireTree.fromPgn(line.pgn);
    } catch {
      continue;
    }

    for (const node of tree.nodes.values()) {
      const chess = new Chess(node.fen);
      const side = chess.turn() === "w" ? "white" : "black";
      for (const edge of tree.getOutgoing(node.id)) {
        const id = makeCardId(line.id, edge.id);
        const saved = savedById.get(id);
        const savedState = storedFsrsState(saved);
        let fsrsCard = createFsrsCard(now);
        if (savedState) {
          try { fsrsCard = serializeFsrsCard(hydrateFsrsCard(savedState)); } catch { /* Ricrea solo lo stato corrotto. */ }
        }
        cards.push({
          id,
          repertoireId: line.id,
          repertoireTitle: line.title || "Linea senza nome",
          edgeId: edge.id,
          positionId: node.id,
          fen: node.fen,
          uci: edge.uci,
          san: edge.san,
          side,
          fsrs: fsrsCard,
          createdAt: saved?.createdAt || now.toISOString(),
          updatedAt: saved?.updatedAt || now.toISOString(),
        });
      }
    }
  }

  return cards;
}

export function gradeFsrsCard(cardState, ratingName, now = new Date()) {
  const rating = ratingMap[String(ratingName).toLowerCase()];
  if (!rating) throw new RangeError("Valutazione FSRS non riconosciuta.");
  const result = scheduler.next(hydrateFsrsCard(cardState), now, rating);
  return {
    card: serializeFsrsCard(result.card),
    state: stateNames[result.card.state] || "unknown",
    log: {
      rating: result.log.rating,
      state: result.log.state,
      due: result.log.due.toISOString(),
      stability: result.log.stability,
      difficulty: result.log.difficulty,
      elapsedDays: result.log.elapsed_days,
      lastElapsedDays: result.log.last_elapsed_days,
      scheduledDays: result.log.scheduled_days,
      learningSteps: result.log.learning_steps,
      review: result.log.review.toISOString(),
    },
    scheduledDays: result.log.scheduled_days,
    dueAt: result.card.due.toISOString(),
  };
}

function stateOf(card) {
  const state = Number(card?.fsrs?.state);
  return Number.isInteger(state) ? state : State.New;
}

export function selectDailyCards(cards, now = new Date(), side = "both", newLimit = NEW_CARDS_PER_DAY) {
  const timestamp = now.getTime();
  const eligible = cards.filter((card) => {
    const due = new Date(card.fsrs.due).getTime();
    return Number.isFinite(due) && due <= timestamp && (side === "both" || card.side === side);
  });
  const dueReviews = eligible.filter((card) => stateOf(card) !== State.New);
  const dueNew = eligible.filter((card) => stateOf(card) === State.New).slice(0, Math.max(0, newLimit));
  const byDue = (a, b) => new Date(a.fsrs.due) - new Date(b.fsrs.due);
  return [...dueReviews.sort(byDue), ...dueNew.sort(byDue)];
}

export function countDueCards(cards, now = new Date(), side = "both") {
  const timestamp = now.getTime();
  return cards.filter((card) => (
    (side === "both" || card.side === side)
    && new Date(card.fsrs.due).getTime() <= timestamp
  )).length;
}

function localDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function countReviewsToday(logs, now = new Date()) {
  const today = localDayKey(now);
  return logs.filter((log) => localDayKey(log.reviewedAt || log.review) === today).length;
}

export function getTodayReviewStats(logs, now = new Date()) {
  const today = localDayKey(now);
  const reviews = logs.filter((log) => localDayKey(log.reviewedAt || log.review) === today);
  const again = reviews.filter((log) => Number(log.rating) === Rating.Again).length;
  const correct = reviews.length - again;
  return {
    reviews: reviews.length,
    again,
    correct,
    accuracy: reviews.length ? Math.round((correct / reviews.length) * 100) : 0,
  };
}

export function parseUci(uci) {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(String(uci || ""));
  if (!match) throw new TypeError("Mossa UCI non valida.");
  return { from: match[1], to: match[2], ...(match[3] ? { promotion: match[3] } : {}) };
}

export function ratingLabel(name) {
  return ({ again: "Again", hard: "Hard", good: "Good", easy: "Easy" })[name] || name;
}
