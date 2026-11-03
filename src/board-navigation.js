const FILES = "abcdefgh";
const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

export function nextBoardSquare(square, key, boardFlipped = false) {
  if (!/^[a-h][1-8]$/.test(String(square || "")) || !ARROW_KEYS.has(key)) return null;

  let file = FILES.indexOf(square[0]);
  let rank = Number(square[1]);
  const direction = key === "ArrowLeft" || key === "ArrowRight"
    ? (key === "ArrowLeft" ? -1 : 1) * (boardFlipped ? -1 : 1)
    : 0;
  const rankDirection = key === "ArrowUp" || key === "ArrowDown"
    ? (key === "ArrowUp" ? 1 : -1) * (boardFlipped ? -1 : 1)
    : 0;

  file += direction;
  rank += rankDirection;
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return FILES[file] + rank;
}
