const COLORS = new Set(["G","R","Y","B"]);
const NAGS = new Set(["$1","$2","$3","$4","$5","$6","$10","$13"]);

export function emptyBoardMarks() {
  return { squares: [], arrows: [] };
}

function cleanMarks(value) {
  const squares = Array.isArray(value?.squares) ? value.squares : [];
  const arrows = Array.isArray(value?.arrows) ? value.arrows : [];
  return {
    squares: squares.filter((mark) => mark && /^[a-h][1-8]$/.test(mark.square || "") && COLORS.has(mark.color)),
    arrows: arrows.filter((mark) => mark && /^[a-h][1-8]$/.test(mark.from || "") && /^[a-h][1-8]$/.test(mark.to || "") && mark.from !== mark.to && COLORS.has(mark.color)),
  };
}

export function parseBoardMarks(comment = "") {
  const marks = emptyBoardMarks();
  const squareTag = String(comment).match(/\\[%csl\\s+([^\\]]+)\\]/i);
  const arrowTag = String(comment).match(/\\[%cal\\s+([^\\]]+)\\]/i);
  if (squareTag) {
    for (const token of squareTag[1].split(",")) {
      const match = token.trim().match(/^([GRYB])([a-h][1-8])$/i);
      if (match) marks.squares.push({ color: match[1].toUpperCase(), square: match[2] });
    }
  }
  if (arrowTag) {
    for (const token of arrowTag[1].split(",")) {
      const match = token.trim().match(/^([GRYB])([a-h][1-8])([a-h][1-8])$/i);
      if (match) marks.arrows.push({ color: match[1].toUpperCase(), from: match[2], to: match[3] });
    }
  }
  return cleanMarks(marks);
}

export function stripBoardMarkTags(comment = "") {
  return String(comment).replace(/\\s*\\[%csl\\s+[^\\]]+\\]/gi, "").replace(/\\s*\\[%cal\\s+[^\\]]+\\]/gi, "").trim();
}

export function encodeBoardMarks(comment = "", value = emptyBoardMarks()) {
  const marks = cleanMarks(value);
  const note = stripBoardMarkTags(comment);
  const squareTokens = marks.squares.map((mark) => mark.color + mark.square);
  const arrowTokens = marks.arrows.map((mark) => mark.color + mark.from + mark.to);
  const tags = [];
  if (squareTokens.length) tags.push("[%csl " + squareTokens.join(",") + "]");
  if (arrowTokens.length) tags.push("[%cal " + arrowTokens.join(",") + "]");
  return [note, ...tags].filter(Boolean).join(" ");
}

export function toggleSquareMark(value, square, color) {
  const marks = cleanMarks(value);
  const existing = marks.squares.find((mark) => mark.square === square);
  if (existing?.color === color) marks.squares = marks.squares.filter((mark) => mark.square !== square);
  else {
    marks.squares = marks.squares.filter((mark) => mark.square !== square);
    marks.squares.push({ square, color });
  }
  return marks;
}

export function toggleArrowMark(value, from, to, color) {
  const marks = cleanMarks(value);
  const existing = marks.arrows.find((mark) => mark.from === from && mark.to === to);
  if (existing?.color === color) marks.arrows = marks.arrows.filter((mark) => !(mark.from === from && mark.to === to));
  else {
    marks.arrows = marks.arrows.filter((mark) => !(mark.from === from && mark.to === to));
    marks.arrows.push({ from, to, color });
  }
  return marks;
}

export function normalizeNag(value) {
  return NAGS.has(value) ? value : "";
}

export function nagsToSymbols(nags = []) {
  return (Array.isArray(nags) ? nags : []).map((nag) => ({ "$1":"!","$2":"?","$3":"!!","$4":"??","$5":"!?","$6":"?!","$10":"=","$13":"∞" })[nag] || "").join("");
}
