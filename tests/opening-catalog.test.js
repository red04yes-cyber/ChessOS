import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  buildOpeningIndex, createOpeningPreset, getOpeningFamilyCount,
  getOpeningRows, identifyOpeningFromFens, openingCatalogueStats, positionSignature,
} from "../src/opening-catalog.js";

test("bundles every ECO code A00-E99 and the complete curated Lichess entry set", () => {
  const stats = openingCatalogueStats();
  assert.equal(stats.entries, 3865);
  assert.equal(stats.ecoCodes, 500);
  assert.equal(stats.families, 150);
  const codes = new Set(getOpeningRows().map((row) => row.eco));
  for (const volume of "ABCDE") {
    for (let number = 0; number < 100; number += 1) {
      assert.ok(codes.has(volume + String(number).padStart(2, "0")), "Missing ECO " + volume + String(number).padStart(2, "0"));
    }
  }
});

test("validates every bundled opening move sequence with chess.js", () => {
  const result = buildOpeningIndex();
  assert.equal(result.errors.length, 0, result.errors.slice(0, 5).map((entry) => entry.eco + " " + entry.name + ": " + entry.message).join("\n"));
  assert.ok(result.index.size > 3000);
});

test("recognises the Sicilian Defence from the played position", () => {
  const chess = new Chess();
  chess.move("e4");
  chess.move("c5");
  const result = identifyOpeningFromFens([new Chess().fen(), chess.fen()]);
  assert.ok(result);
  assert.equal(result.eco, "B20");
  assert.match(result.name, /Sicilian Defense/);
});

test("creates complete starter repertoires from every curated family line", () => {
  for (const family of ["Sicilian Defense", "Italian Game", "French Defense", "Caro-Kann Defense"]) {
    const preset = createOpeningPreset(family);
    assert.equal(preset.rows, getOpeningFamilyCount(family));
    assert.ok(preset.tree.edges.size > preset.rows, family + " should include shared prefixes and multiple variations");
    assert.equal(preset.tree.getOutgoing(preset.tree.rootId).length, 1, family + " should start from the recognised main opening move");
    let nodeId = preset.tree.rootId;
    let hasBranches = false;
    for (let depth = 0; depth < 8; depth += 1) {
      const next = preset.tree.getOutgoing(nodeId);
      if (next.length > 1) { hasBranches = true; break; }
      if (!next.length) break;
      nodeId = next[0].to;
    }
    assert.ok(hasBranches, family + " should include its full set of named alternatives");
  }
});


test("keeps castling rights and en-passant state in position signatures but ignores counters", () => {
  const base = "8/8/8/8/8/8/8/8 w KQkq - 0 1";
  assert.equal(positionSignature(base), positionSignature("8/8/8/8/8/8/8/8 w KQkq - 99 42"));
  assert.notEqual(positionSignature(base), positionSignature("8/8/8/8/8/8/8/8 w KQkq e3 0 1"));
  assert.notEqual(positionSignature(base), positionSignature("8/8/8/8/8/8/8/8 w - - 0 1"));
});

test("deduplicates identical catalogue rows in the opening index", () => {
  const row = getOpeningRows()[0];
  const result = buildOpeningIndex([row, { ...row }]);
  const chess = new Chess();
  chess.loadPgn(row.pgn);
  const matches = result.index.get(positionSignature(chess.fen()));
  assert.equal(result.errors.length, 0);
  assert.equal(matches.filter((entry) => entry.eco === row.eco && entry.name === row.name).length, 1);
});

test("reports an invalid catalogue entry without discarding valid rows", () => {
  const valid = getOpeningRows()[0];
  const result = buildOpeningIndex([
    valid,
    { eco: "Z99", name: "Invalid test row", pgn: "1. e4 Qh9 *" },
  ]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].eco, "Z99");
  assert.ok(result.index.size > 0);
});

test("returns no opening for empty or unmatched position histories", () => {
  assert.equal(identifyOpeningFromFens([]), null);
  assert.equal(identifyOpeningFromFens(["not a FEN"]), null);
});

test("rejects requests for unknown starter repertoire families", () => {
  assert.throws(() => createOpeningPreset("Unknown opening family"), /non trovato/i);
});
