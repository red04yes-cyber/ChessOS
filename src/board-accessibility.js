const PIECES = Object.freeze({
  k: { name: "Re", feminine: false },
  q: { name: "Donna", feminine: true },
  r: { name: "Torre", feminine: true },
  b: { name: "Alfiere", feminine: false },
  n: { name: "Cavallo", feminine: false },
  p: { name: "Pedone", feminine: false },
});

export function squareAccessibleLabel(piece, square) {
  if (!/^[a-h][1-8]$/.test(String(square || ""))) return "Casa non valida";
  if (!piece) return "Casa vuota " + square;

  const descriptor = PIECES[piece.type];
  if (!descriptor || (piece.color !== "w" && piece.color !== "b")) {
    return "Pezzo in " + square;
  }

  const adjective = descriptor.feminine
    ? (piece.color === "w" ? "bianca" : "nera")
    : (piece.color === "w" ? "bianco" : "nero");
  return descriptor.name + " " + adjective + " in " + square;
}
