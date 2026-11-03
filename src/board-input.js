/**
 * Resolve a two-square board action using chess.js legal-move generation.
 * Both pointer dragging and click-to-move use this same classifier.
 */
export function classifyBoardMove(chess, from, to) {
  if (!chess || typeof chess.get !== "function" || typeof chess.moves !== "function") {
    throw new TypeError("Partita non valida.");
  }
  if (!/^[a-h][1-8]$/.test(from || "") || !/^[a-h][1-8]$/.test(to || "")) {
    return { kind: "invalid" };
  }
  if (from === to) return { kind: "same-square" };

  const source = chess.get(from);
  if (!source || source.color !== chess.turn()) return { kind: "invalid" };

  const target = chess.get(to);
  if (target && target.color === source.color) {
    return { kind: "select", square: to };
  }

  const moves = chess.moves({ square: from, verbose: true }).filter((move) => move.to === to);
  if (!moves.length) return { kind: "illegal" };

  const promotions = moves.filter((move) => Boolean(move.promotion));
  if (promotions.length) return { kind: "promotion", moves: promotions };
  return { kind: "move", move: moves[0] };
}
