import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  buildOpeningIndex, createOpeningPreset, getOpeningFamilyCount,
  getOpeningRows, identifyOpeningFromFens, openingCatalogueStats,
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
