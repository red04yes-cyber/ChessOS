const FILES = "abcdefgh";
const DISPLAY_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export function getAdjacentSquare(square, key, flipped = false) {
  if (typeof square !== "string" || !/^[a-h][1-8]$/.test(square) || !DISPLAY_KEYS.has(key)) {
    return null;
  }

  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  let row = flipped ? rank - 1 : 8 - rank;
  let column = flipped ? 7 - file : file;

  switch (key) {
    case "ArrowUp": row -= 1; break;
    case "ArrowDown": row += 1; break;
    case "ArrowLeft": column -= 1; break;
    case "ArrowRight": column += 1; break;
    default: return null;
  }

  if (row < 0 || row > 7 || column < 0 || column > 7) return null;

  const nextFile = flipped ? 7 - column : column;
  const nextRank = flipped ? row + 1 : 8 - row;
  return FILES[nextFile] + String(nextRank);
}
