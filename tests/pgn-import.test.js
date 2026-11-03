import test from "node:test";
import assert from "node:assert/strict";
import { parsePgnCollection, normalizeTags, splitPgnGames } from "../src/pgn-import.js";

const collection = [
  '[Event "Italian Game"]',
  '[White "White Player"]',
  '[Black "Black Player"]',
  "",
  "1. e4 e5 2. Nf3 Nc6 *",
  "",
  '[Event "Sicilian Defense"]',
  '[White "Another White"]',
  '[Black "Another Black"]',
  "",
  "1. e4 c5 2. Nf3 d6 *",
].join("\n");

test("splits a multi-game PGN on Event headers and preserves headers", () => {
  const games = splitPgnGames(collection);
  assert.equal(games.length, 2);
  const parsed = parsePgnCollection(collection);
  assert.equal(parsed.total, 2);
  assert.equal(parsed.games.length, 2);
  assert.equal(parsed.games[0].title, "Italian Game · White Player – Black Player");
  assert.equal(parsed.games[1].tree.edges.size, 4);
  assert.deepEqual(parsed.errors, []);
});

test("reports a broken game independently while keeping valid games", () => {
  const input = [
    '[Event "Valid one"]',
    "",
    "1. e4 e5 *",
    "",
    '[Event "Broken"]',
    "",
    "1. Qh5 *",
    "",
    '[Event "Valid two"]',
    "",
    "1. d4 d5 *",
  ].join("\n");
  const parsed = parsePgnCollection(input);
  assert.equal(parsed.total, 3);
  assert.equal(parsed.games.length, 2);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0].index, 2);
});

test("normalizes tags, removes case-insensitive duplicates and enforces limits", () => {
  assert.deepEqual(normalizeTags(" Siciliana, apertura, SICILIANA, , Repertorio 2026 "), ["Siciliana", "apertura", "Repertorio 2026"]);
  assert.equal(normalizeTags(Array.from({ length: 40 }, (_, i) => "tag" + i)).length, 32);
});

test("rejects empty PGN input and oversized collections with diagnostics", () => {
  assert.equal(parsePgnCollection("  ").errors[0].message, "Nessuna partita PGN riconosciuta.");
  assert.match(parsePgnCollection("x".repeat(10_000_001)).errors[0].message, /10 MB/);
});

test("splits consecutive games even when Event tag is omitted", () => {
  const input = [
    '[White "First"]',
    "",
    "1. e4 e5 *",
    "",
    '[White "Second"]',
    "",
    "1. d4 d5 *",
  ].join("\n");
  const parsed = parsePgnCollection(input);
  assert.equal(parsed.total, 2);
  assert.deepEqual(parsed.games.map((game) => game.title), ["First", "Second"]);
  assert.deepEqual(parsed.errors, []);
});
