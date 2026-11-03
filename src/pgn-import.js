import { RepertoireTree } from "./repertoire-tree.js";

const HEADER_LINE = /^\s*\[([A-Za-z][A-Za-z0-9_]*)\s+"((?:\\.|[^"\\])*)"\]\s*$/;

export function normalizeTags(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set(); const tags = [];
  for (const candidate of source) {
    const tag = String(candidate || "").trim().replace(/\s+/g, " ").slice(0, 32);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key); tags.push(tag);
    if (tags.length === 32) break;
  }
  return tags;
}

export function splitPgnGames(input) {
  const source = String(input || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!source.trim()) return [];
  const chunks = []; let current = []; let seenHeader = false; let movetextStarted = false;
  const finish = () => { const game = current.join("\n").trim(); if (game) chunks.push(game); };
  for (const line of source.split("\n")) {
    const match = HEADER_LINE.exec(line);
    // Any tag pair after movetext starts a new game. Event is conventional,
    // but not mandatory in PGN collections.
    if (match && current.length && movetextStarted) {
      finish(); current = []; seenHeader = false; movetextStarted = false;
    }
    current.push(line);
    if (match) seenHeader = true;
    else if (line.trim() && !/^\s*(?:[;{}]|$)/.test(line) && seenHeader) movetextStarted = true;
  }
  finish(); return chunks;
}

function gameTitle(tree, index) {
  const headers = tree.headers || {};
  const event = (headers.Event || "").trim();
  const white = (headers.White || "").trim(); const black = (headers.Black || "").trim();
  const players = white && black && white !== "?" && black !== "?" ? white + " – " + black : "";
  if (event && event !== "?") return players ? event + " · " + players : event;
  return players || "Partita importata " + index;
}

export function parsePgnCollection(input) {
  const source = String(input || "");
  if (source.length > 10_000_000) return { total: 0, games: [], errors: [{ index: 1, message: "Il file PGN supera il limite di 10 MB." }] };
  const chunks = splitPgnGames(source);
  if (!chunks.length) return { total: 0, games: [], errors: [{ index: 1, message: "Nessuna partita PGN riconosciuta." }] };
  if (chunks.length > 100) return { total: chunks.length, games: [], errors: [{ index: 101, message: "Limite di 100 partite per importazione superato." }] };
  const games = []; const errors = [];
  chunks.forEach((pgn, offset) => {
    const index = offset + 1;
    try {
      const tree = RepertoireTree.fromPgn(pgn);
      if (!tree.edges.size) throw new Error("La partita non contiene mosse valide.");
      games.push({ index, title: gameTitle(tree, index), pgn, tree });
    } catch (error) { errors.push({ index, message: error instanceof Error ? error.message : String(error) }); }
  });
  return { total: chunks.length, games, errors };
}
