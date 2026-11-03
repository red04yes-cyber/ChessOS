import { Chess } from "chess.js";

const FILES = "abcdefgh";
const PIECES = new Set(["wK","wQ","wR","wB","wN","wP","bK","bQ","bR","bB","bN","bP"]);

export function fenToEditorState(fen) {
  const chess = new Chess(fen);
  const fields = chess.fen().split(/\\s+/);
  const pieces = {};
  chess.board().forEach((rank, row) => rank.forEach((piece, col) => {
    if (piece) {
      const square = FILES[col] + String(8 - row);
      pieces[square] = piece.color + piece.type.toUpperCase();
    }
  }));
  return {
    pieces,
    turn: fields[1],
    castling: fields[2] === "-" ? [] : fields[2].split(""),
    enPassant: fields[3] === "-" ? "" : fields[3],
    halfmove: Number(fields[4]),
    fullmove: Number(fields[5]),
  };
}

export function editorStateToFen(state) {
  if (!state || typeof state !== "object" || !state.pieces || typeof state.pieces !== "object") {
    throw new Error("Configurazione della posizione non valida.");
  }
  if (!["w","b"].includes(state.turn)) throw new Error("Scegli chi deve muovere.");
  const castling = Array.isArray(state.castling) ? state.castling : String(state.castling || "").split("");
  const normalizedCastling = ["K","Q","k","q"].filter((right) => castling.includes(right));
  if (new Set(castling).size !== castling.length || castling.some((right) => !["K","Q","k","q"].includes(right))) {
    throw new Error("Diritti di arrocco non validi.");
  }
  const halfmove = Number(state.halfmove);
  const fullmove = Number(state.fullmove);
  if (!Number.isInteger(halfmove) || halfmove < 0 || halfmove > 1000000) throw new Error("Contatore delle 50 mosse non valido.");
  if (!Number.isInteger(fullmove) || fullmove < 1 || fullmove > 1000000) throw new Error("Numero della mossa non valido.");

  const rows = [];
  for (let rank = 8; rank >= 1; rank -= 1) {
    let empty = 0, row = "";
    for (const file of FILES) {
      const square = file + rank;
      const code = state.pieces[square] || "";
      if (!code) { empty += 1; continue; }
      if (!PIECES.has(code)) throw new Error("Pezzo non valido in " + square + ".");
      if (empty) { row += empty; empty = 0; }
      const symbol = code[1];
      row += code[0] === "w" ? symbol : symbol.toLowerCase();
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const boardFen = rows.join("/");
  const pieceAt = (square) => state.pieces[square] || "";
  for (const square of FILES.split("").map((file) => file + "1").concat(FILES.split("").map((file) => file + "8"))) {
    if (pieceAt(square).endsWith("P")) throw new Error("Un pedone non può restare in prima o ottava traversa (" + square + ").");
  }
  const all = Object.values(state.pieces);
  if (all.filter((piece) => piece === "wK").length !== 1 || all.filter((piece) => piece === "bK").length !== 1) {
    throw new Error("La posizione deve contenere esattamente un re bianco e un re nero.");
  }

  const requiredPieces = { K:["wK","e1"], Q:["wK","e1"], k:["bK","e8"], q:["bK","e8"] };
  for (const right of normalizedCastling) {
    const [king, kingSquare] = requiredPieces[right];
    const rookSquare = right === "K" ? "h1" : right === "Q" ? "a1" : right === "k" ? "h8" : "a8";
    const rook = right === "K" || right === "Q" ? "wR" : "bR";
    if (pieceAt(kingSquare) !== king || pieceAt(rookSquare) !== rook) {
      throw new Error("Il diritto di arrocco " + right + " richiede re e torre nelle case iniziali.");
    }
  }

  const enPassant = String(state.enPassant || "").trim();
  if (enPassant && !/^[a-h][36]$/.test(enPassant)) throw new Error("La casa en passant deve essere vuota e sulla traversa 3 o 6.");
  if (enPassant) {
    const rank = Number(enPassant[1]);
    if ((state.turn === "w" && rank !== 6) || (state.turn === "b" && rank !== 3)) {
      throw new Error("La casa en passant non corrisponde al colore che deve muovere.");
    }
    const file = enPassant[0];
    const capturedSquare = file + (state.turn === "w" ? "5" : "4");
    const originSquare = file + (state.turn === "w" ? "7" : "2");
    const capturedPawn = state.turn === "w" ? "bP" : "wP";
    if (pieceAt(enPassant) || pieceAt(capturedSquare) !== capturedPawn || pieceAt(originSquare)) {
      throw new Error("La casa en passant non corrisponde a una doppia spinta valida.");
    }
  }

  const fen = [
    boardFen,
    state.turn,
    normalizedCastling.join("") || "-",
    enPassant || "-",
    halfmove,
    fullmove,
  ].join(" ");
  const chess = new Chess(fen);
  return chess.fen();
}

export function validateEditorFen(fen) {
  const state = fenToEditorState(fen);
  return { state, fen: editorStateToFen(state) };
}
