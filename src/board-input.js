/**
 * Classify a move attempt from one square to another.
 * Keeps click-to-move and drag-and-drop on the same legality path.
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

  const choices = chess.moves({ square: from, verbose: true })
    .filter((move) => move.to === to);
  if (!choices.length) return { kind: "illegal" };

  const promotions = choices.filter((move) => Boolean(move.promotion));
  if (promotions.length) return { kind: "promotion", moves: promotions };
  return { kind: "move", move: choices[0] };
}
