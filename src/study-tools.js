import { Chess } from "chess.js";
import { createEmptyCard, fsrs, Rating } from "ts-fsrs";

export const STUDY_CARDS_KEY = "chess-os.study-cards.v1";
export const OPPONENT_REPORT_KEY = "chess-os.opponent-report.v1";

const scheduler = fsrs();
const gradeValues = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const makeId = () => globalThis.crypto?.randomUUID?.()
  ?? "card-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);

export function positionKey(fen) {
  const fields = String(fen).trim().split(/\s+/);
  if (fields.length < 4) throw new Error("FEN non valida.");
  return fields.slice(0, 4).join(" ");
}

export function readStudyCards(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(STUDY_CARDS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((card) => (
      card && typeof card.id === "string" && card.schedulerCard && card.fen
    )) : [];
  } catch {
    return [];
  }
}

export function saveStudyCards(cards, storage = globalThis.localStorage) {
  if (!storage) throw new Error("Memoria locale non disponibile.");
  storage.setItem(STUDY_CARDS_KEY, JSON.stringify(cards));
}

export function createErrorFlashcard({ fen, expectedSan, actualSan, source = "game", now = new Date() }) {
  const key = positionKey(fen);
  const expected = Array.isArray(expectedSan) ? expectedSan : [expectedSan];
  const correct = expected.filter((san) => typeof san === "string" && san.trim());
  if (!correct.length) throw new Error("Serve almeno una mossa corretta per creare la carta.");
  return {
    id: makeId(),
    type: "repertoire-error",
    source,
    fen,
    positionKey: key,
    front: actualSan ? "Nella partita hai giocato " + actualSan + ". Quale continuazione prevede il repertorio?" : "Da questa posizione, quale continuazione prevede il repertorio?",
    back: correct.join(" · "),
    expectedSan: correct,
    actualSan: actualSan || "",
    createdAt: now.toISOString(),
    schedulerCard: createEmptyCard(now),
    reviewCount: 0,
    lapses: 0,
    lastRating: null,
    reviewHistory: [],
  };
}

function splitPgnGames(pgn) {
  const text = String(pgn || "").trim();
  if (!text) return [];
  const starts = [...text.matchAll(/^\[Event\s/gm)].map((match) => match.index);
  if (starts.length <= 1) return [text];
  return starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.length).trim()).filter(Boolean);
}

function headerValue(pgn, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return pgn.match(new RegExp("^\\[" + escaped + '\\s+"((?:\\\\.|[^"])*)"\\]', "m"))?.[1] || "";
}

export function createMistakeFlashcards(tree, pgn, existingCards = [], now = new Date()) {
  if (!tree || typeof tree.getOutgoing !== "function") throw new Error("Repertorio non valido.");
  const known = new Set(existingCards.map((card) => card.positionKey + "|" + (card.expectedSan || []).join(",")));
  const created = [];
  const ignoredGames = [];
  const games = splitPgnGames(pgn);
  if (!games.length) throw new Error("Incolla almeno una partita PGN.");

  for (const source of games) {
    const chess = new Chess();
    try {
      chess.loadPgn(source);
    } catch (error) {
      ignoredGames.push(error.message || "PGN non valido");
      continue;
    }

    for (const move of chess.history({ verbose: true })) {
      const key = positionKey(move.before);
      const nodeIds = tree.nodesByPosition?.get(key) || [];
      if (!nodeIds.length) continue;
      const actualUci = move.from + move.to + (move.promotion || "");
      const candidates = nodeIds
        .map((id) => tree.getNode(id))
        .filter(Boolean)
        .map((node) => ({ node, edges: tree.getOutgoing(node.id) }))
        .filter(({ edges }) => edges.length > 0);
      if (!candidates.length || candidates.some(({ edges }) => edges.some((edge) => edge.uci === actualUci))) continue;
      const candidate = candidates[0];

      const expected = candidate.edges.map((edge) => edge.san);
      const fingerprint = key + "|" + expected.join(",");
      if (known.has(fingerprint)) continue;
      const card = createErrorFlashcard({
        fen: move.before,
        expectedSan: expected,
        actualSan: move.san,
        source: "pgn-analysis",
        now,
      });
      created.push(card);
      known.add(fingerprint);
    }
  }

  return { cards: created, gamesRead: games.length - ignoredGames.length, ignoredGames };
}

function reviveSchedulerCard(card) {
  const saved = card.schedulerCard;
  return {
    ...saved,
    due: new Date(saved.due),
    last_review: saved.last_review ? new Date(saved.last_review) : null,
  };
}

export function gradeStudyCard(card, grade, now = new Date()) {
  const rating = gradeValues[String(grade).toLowerCase()];
  if (!rating) throw new Error("Valutazione FSRS non valida.");
  const result = scheduler.next(reviveSchedulerCard(card), now, rating);
  return {
    ...card,
    schedulerCard: result.card,
    reviewCount: (card.reviewCount || 0) + 1,
    lapses: result.card.lapses ?? card.lapses ?? 0,
    lastRating: String(grade).toLowerCase(),
    lastReviewedAt: now.toISOString(),
    lastScheduledDays: result.log.scheduled_days,
    reviewHistory: [
      ...(card.reviewHistory || []),
      {
        rating: String(grade).toLowerCase(),
        reviewedAt: now.toISOString(),
        scheduledDays: result.log.scheduled_days,
        dueAt: result.card.due.toISOString(),
        stability: result.card.stability,
        difficulty: result.card.difficulty,
        state: result.card.state,
      },
    ],
  };
}

export function getDueStudyCards(cards, now = new Date()) {
  const timestamp = now.getTime();
  return cards.filter((card) => new Date(card.schedulerCard.due).getTime() <= timestamp)
    .sort((a, b) => new Date(a.schedulerCard.due) - new Date(b.schedulerCard.due));
}

function buildShortestPathMap(tree) {
  const paths = new Map([[tree.rootId, []]]);
  const queue = [tree.rootId];
  while (queue.length) {
    const nodeId = queue.shift();
    for (const edge of tree.getOutgoing(nodeId)) {
      if (paths.has(edge.to)) continue;
      paths.set(edge.to, [...paths.get(nodeId), edge.id]);
      queue.push(edge.to);
    }
  }
  return paths;
}

export function buildWeaknessHeatmap(tree, cards, now = new Date()) {
  const paths = buildShortestPathMap(tree);
  const cardsByKey = new Map();
  for (const card of cards) {
    const list = cardsByKey.get(card.positionKey) || [];
    list.push(card);
    cardsByKey.set(card.positionKey, list);
  }
  const priority = { weak: 0, learning: 1, stable: 2, unmeasured: 3 };
  return [...tree.nodes.values()].map((node) => {
    const related = cardsByKey.get(node.key) || [];
    let status = "unmeasured";
    if (related.length) {
      const due = related.some((card) => new Date(card.schedulerCard.due).getTime() <= now.getTime());
      const repeatedErrors = related.some((card) => (card.lapses || 0) >= 2);
      const reviewed = related.every((card) => (card.reviewCount || 0) >= 2);
      status = due || repeatedErrors ? "weak" : reviewed ? "stable" : "learning";
    }
    return {
      nodeId: node.id,
      fen: node.fen,
      key: node.key,
      line: (paths.get(node.id) || []).map((edgeId) => tree.getEdge(edgeId)?.san).filter(Boolean).join(" "),
      incoming: node.incoming.length,
      outgoing: node.outgoing.length,
      cardCount: related.length,
      status,
      lapses: related.reduce((sum, card) => sum + (card.lapses || 0), 0),
      reviews: related.reduce((sum, card) => sum + (card.reviewCount || 0), 0),
    };
  }).sort((a, b) => priority[a.status] - priority[b.status] || b.lapses - a.lapses || a.fen.localeCompare(b.fen));
}

export function analyzeOpponentPgn(pgn, side = "black") {
  if (!["white", "black"].includes(side)) throw new Error("Scegli Bianco o Nero da analizzare.");
  const games = splitPgnGames(pgn);
  if (!games.length) throw new Error("Incolla le partite PGN dell'avversario.");
  const openings = new Map();
  const firstMoves = new Map();
  const moveSequences = new Map();
  const results = { wins: 0, draws: 0, losses: 0, unknown: 0 };
  const ignoredGames = [];
  let totalPlies = 0;
  let analyzed = 0;

  for (const source of games) {
    const chess = new Chess();
    try {
      chess.loadPgn(source);
    } catch (error) {
      ignoredGames.push(error.message || "PGN non valido");
      continue;
    }
    const moves = chess.history({ verbose: true });
    if (!moves.length) continue;
    analyzed += 1;
    totalPlies += moves.length;
    const openingHeader = headerValue(source, "Opening");
    const eco = headerValue(source, "ECO");
    const opening = openingHeader || moves.slice(0, 8).map((move) => move.san).join(" ");
    const openingLabel = (eco ? eco + " · " : "") + opening;
    openings.set(openingLabel, (openings.get(openingLabel) || 0) + 1);

    const sideCode = side === "white" ? "w" : "b";
    const opponentMoves = moves.filter((move) => move.color === sideCode);
    if (opponentMoves[0]) {
      firstMoves.set(opponentMoves[0].san, (firstMoves.get(opponentMoves[0].san) || 0) + 1);
      const sequence = opponentMoves.slice(0, 3).map((move) => move.san).join(" ");
      moveSequences.set(sequence, (moveSequences.get(sequence) || 0) + 1);
    }

    const result = headerValue(source, "Result");
    if (result === "1/2-1/2") results.draws += 1;
    else if (result === "1-0" || result === "0-1") {
      const whiteWon = result === "1-0";
      const sideWon = side === "white" ? whiteWon : !whiteWon;
      if (sideWon) results.wins += 1;
      else results.losses += 1;
    } else results.unknown += 1;
  }

  const top = (map) => [...map.entries()]
    .map(([label, count]) => ({ label, count, percentage: analyzed ? Math.round(count / analyzed * 100) : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 8);

  return {
    side,
    gameCount: analyzed,
    ignoredGames,
    averagePlies: analyzed ? Math.round(totalPlies / analyzed) : 0,
    results,
    openings: top(openings),
    firstMoves: top(firstMoves),
    moveSequences: top(moveSequences),
  };
}


export function getTranspositionGroups(tree) {
  const shortestPaths = buildShortestPathMap(tree);
  const groups = [];
  for (const node of tree.nodes.values()) {
    if (node.incoming.length < 2) continue;
    const paths = [];
    for (const edge of tree.getIncoming(node.id)) {
      const prefix = shortestPaths.get(edge.from);
      if (!prefix) continue;
      const ids = [...prefix, edge.id];
      const sans = ids.map((id) => tree.getEdge(id)?.san).filter(Boolean);
      paths.push({ edgeId: edge.id, moves: sans.join(" "), ply: sans.length });
    }
    if (paths.length > 1) groups.push({ nodeId: node.id, fen: node.fen, paths });
  }
  return groups.sort((a, b) => b.paths.length - a.paths.length || a.nodeId.localeCompare(b.nodeId));
}
