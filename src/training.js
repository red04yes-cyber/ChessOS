import { Chess } from "chess.js";

/**
 * Create an isolated replay session from a repertoire root and its selected
 * move path. The root FEN is authoritative: custom PGN SetUp/FEN positions
 * must never silently fall back to the standard initial position.
 */
export function createTrainingSession(rootFen, moves) {
  if (typeof rootFen !== "string" || !rootFen.trim()) {
    throw new Error("Posizione iniziale del ripasso non valida.");
  }
  if (!Array.isArray(moves)) {
    throw new Error("Percorso delle mosse del ripasso non valido.");
  }

  const game = new Chess(rootFen);
  const trainingMoves = moves.map((move) => {
    if (!move || typeof move.from !== "string" || typeof move.to !== "string" || typeof move.san !== "string") {
      throw new Error("Mossa del ripasso non valida.");
    }
    return {
      from: move.from,
      to: move.to,
      san: move.san,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    };
  });

  return {
    startFen: game.fen(),
    game,
    moves: trainingMoves,
  };
}
