import { Chess } from "chess.js";
import openingRows from "./data/lichess-openings.js";
import { RepertoireTree } from "./repertoire-tree.js";

const POSITION_FIELDS = 4;
let openingIndex = null;
let catalogueReport = null;

export function openingCatalogueStats() {
  const ecos = new Set(openingRows.map((row) => row.eco));
  const families = new Set(openingRows.map((row) => row.name.split(":")[0]));
  return {
    entries: openingRows.length,
    ecoCodes: ecos.size,
    families: families.size,
    expectedEcoCodes: 500,
  };
}

export function getOpeningRows() {
  return openingRows;
}

export function getOpeningFamilyCount(family) {
  return openingRows.filter((row) => row.name === family || row.name.startsWith(family + ":")).length;
}

export function getOpeningFamilies() {
  return [...new Set(openingRows.map((row) => row.name.split(":")[0]))].sort((a,b)=>a.localeCompare(b));
}

export function positionSignature(fen) {
  return String(fen || "").trim().split(/\s+/).slice(0, POSITION_FIELDS).join(" ");
}

export function buildOpeningIndex(rows = openingRows) {
  const index = new Map();
  const errors = [];
  for (const row of rows) {
    try {
      const chess = new Chess();
      chess.loadPgn(row.pgn);
      const key = positionSignature(chess.fen());
      const entry = { eco: row.eco, name: row.name, pgn: row.pgn, ply: chess.history().length };
      const matches = index.get(key) || [];
      matches.push(entry);
      index.set(key, matches);
    } catch (error) {
      errors.push({ eco: row.eco, name: row.name, pgn: row.pgn, message: error.message });
    }
  }
  for (const [key, matches] of index) {
    const unique = [...new Map(matches.map((entry) => [entry.eco + "|" + entry.name, entry])).values()];
    unique.sort((a,b)=>b.ply-a.ply || a.name.localeCompare(b.name));
    index.set(key, unique);
  }
  return { index, errors };
}

export function getOpeningIndex() {
  if (!openingIndex) {
    const result = buildOpeningIndex();
    openingIndex = result.index;
    catalogueReport = { valid: openingRows.length - result.errors.length, errors: result.errors };
  }
  return openingIndex;
}

export function getOpeningCatalogueReport() {
  if (!catalogueReport) getOpeningIndex();
  return catalogueReport;
}

export function identifyOpeningFromFens(fens) {
  const index = getOpeningIndex();
  let found = null;
  for (let ply = 0; ply < fens.length; ply += 1) {
    const matches = index.get(positionSignature(fens[ply]));
    if (!matches?.length) continue;
    found = { ...matches[0], alternatives: matches, matchedPly: ply };
  }
  return found;
}

export function createOpeningPreset(family) {
  const rows = openingRows.filter((row) => row.name === family || row.name.startsWith(family + ":"));
  if (!rows.length) throw new Error("Repertorio iniziale non trovato: " + family);
  const rootFen = new Chess().fen();
  const tree = new RepertoireTree(rootFen, {
    Event: "Chess OS opening repertoire",
    Opening: family,
    Source: "Lichess chess-openings (CC0)",
  });
  for (const row of rows) {
    const source = RepertoireTree.fromPgn(row.pgn);
    const chess = new Chess(rootFen);
    let nodeId = tree.rootId;
    for (const edgeId of source.mainlinePath()) {
      const sourceEdge = source.getEdge(edgeId);
      const move = chess.move({
        from: sourceEdge.uci.slice(0,2),
        to: sourceEdge.uci.slice(2,4),
        ...(sourceEdge.uci.length > 4 ? { promotion: sourceEdge.uci[4] } : {}),
      });
      if (!move) throw new Error("Variante non legale nel catalogo: " + row.eco + " " + row.name);
      const edge = tree.addMove(nodeId, move, chess.fen(), { comment: sourceEdge.comment });
      nodeId = edge.to;
    }
  }
  return { family, rows: rows.length, tree };
}
