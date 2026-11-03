import { RepertoireTree } from "./repertoire-tree.js";

const HEADER_LINE = /^\s*\[([A-Za-z][A-Za-z0-9_]*)\s+"((?:\\.|[^"\\])*)"\]\s*$/;

export function splitPgnGames(input) {
  const source = String(input || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!source.trim()) return [];
  const chunks = [];
  let current = [];
  let seenHeader = false;
  let movetextStarted = false;
  const finish = () => {
    const value = current.join("\n").trim();
    if (value) chunks.push(value);
  };
  for (const line of source.split("\n")) {
    const match = HEADER_LINE.exec(line);
    const startsEvent = match?.[1]?.toLowerCase() === "event";
    if (startsEvent && current.length && (seenHeader || movetextStarted)) {
      finish();
      current = [];
      seenHeader = false;
      movetextStarted = false;
    }
    current.push(line);
    if (match) seenHeader = true;
    else if (line.trim() && !/^\s*(?:[;{}]|$)/.test(line) && seenHeader) movetextStarted = true;
  }
  finish();
  return chunks;
}

function gameTitle(tree, index) {
  const headers = tree.headers || {};
  const event = String(headers.Event || "").trim();
  const white = String(headers.White || "").trim();
  const black = String(headers.Black || "").trim();
  const players = white && black && white !== "?" && black !== "?"
    ? white + " – " + black
    : "";
  if (event && event !== "?") return (players ? event + " · " + players : event).slice(0, 70);
  return (players || "Partita importata " + index).slice(0, 70);
}

export function parsePgnCollection(input) {
  const source = String(input || "");
  if (source.length > 10_000_000) {
    return { total: 0, games: [], errors: [{ index: 1, message: "Il PGN supera il limite di 10 MB." }] };
  }
  const chunks = splitPgnGames(source);
  if (!chunks.length) {
    return { total: 0, games: [], errors: [{ index: 1, message: "Nessuna partita PGN riconosciuta." }] };
  }
  if (chunks.length > 100) {
    return { total: chunks.length, games: [], errors: [{ index: 101, message: "Limite di 100 partite per importazione superato." }] };
  }
  const games = [];
  const errors = [];
  chunks.forEach((pgn, offset) => {
    const index = offset + 1;
    try {
      const tree = RepertoireTree.fromPgn(pgn);
      if (!tree.edges.size) throw new Error("La partita non contiene mosse valide.");
      games.push({ index, title: gameTitle(tree, index), pgn, tree });
    } catch (error) {
      errors.push({ index, message: error instanceof Error ? error.message : String(error) });
    }
  });
  return { total: chunks.length, games, errors };
}
