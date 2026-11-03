import { createFsrsCard, gradeFsrsCard } from "./fsrs-review.js";

function stableId(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return "mistake-" + (hash >>> 0).toString(16).padStart(8, "0");
}

export function upsertMistakeFlashcards(existing = [], mistakes = [], now = new Date()) {
  const byId = new Map(
    (Array.isArray(existing) ? existing : [])
      .filter((card) => card && typeof card.id === "string")
      .map((card) => [card.id, card]),
  );
  let added = 0;
  let updated = 0;
  for (const mistake of mistakes) {
    if (!mistake?.fen || !mistake?.bestUci || !mistake?.bestSan) continue;
    const positionKey = String(mistake.fen).trim().split(/\\s+/).slice(0, 4).join(" ");
    const id = stableId(positionKey + "|" + mistake.bestUci);
    const previous = byId.get(id);
    if (previous) {
      byId.set(id, {
        ...previous,
        playedSan: mistake.playedSan || previous.playedSan,
        lossCp: Math.max(Number(previous.lossCp) || 0, Number(mistake.lossCp) || 0),
        opening: mistake.opening || previous.opening,
        lastSeenAt: now.toISOString(),
      });
      updated += 1;
    } else {
      byId.set(id, {
        id,
        fen: mistake.fen,
        expectedUci: mistake.bestUci,
        expectedSan: mistake.bestSan,
        playedSan: mistake.playedSan || "",
        lossCp: Number(mistake.lossCp) || 0,
        category: mistake.category || "mistake",
        opening: mistake.opening || "Apertura non indicata",
        sourceGame: [mistake.white, mistake.black].filter(Boolean).join(" – "),
        fsrs: createFsrsCard(now),
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
      });
      added += 1;
    }
  }
  return { cards: [...byId.values()], added, updated };
}

export function selectDueMistakeFlashcards(cards = [], now = new Date(), limit = 20) {
  const timestamp = now.getTime();
  return [...cards]
    .filter((card) => {
      const due = new Date(card?.fsrs?.due || 0).getTime();
      return Number.isFinite(due) && due <= timestamp;
    })
    .sort((a, b) => new Date(a.fsrs.due) - new Date(b.fsrs.due))
    .slice(0, Math.max(0, Math.min(100, Number(limit) || 20)));
}

export function gradeMistakeFlashcard(card, rating, now = new Date()) {
  if (!card?.id || !card?.fsrs) throw new TypeError("Carta di errore non valida.");
  const result = gradeFsrsCard(card.fsrs, rating, now);
  return {
    ...card,
    fsrs: result.card,
    lastReviewedAt: now.toISOString(),
    lastRating: String(rating),
  };
}
