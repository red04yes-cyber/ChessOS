import test from "node:test";
import assert from "node:assert/strict";
import { squareAccessibleLabel } from "../src/board-accessibility.js";

test("announces empty squares with an Italian accessible name", () => {
  assert.equal(squareAccessibleLabel(null, "e4"), "Casa vuota e4");
});

test("announces all twelve chess pieces with correct Italian names and agreement", () => {
  const cases = [
    [{ type: "k", color: "w" }, "e1", "Re bianco in e1"],
    [{ type: "q", color: "w" }, "d1", "Donna bianca in d1"],
    [{ type: "r", color: "w" }, "a1", "Torre bianca in a1"],
    [{ type: "b", color: "w" }, "c1", "Alfiere bianco in c1"],
    [{ type: "n", color: "w" }, "g1", "Cavallo bianco in g1"],
    [{ type: "p", color: "w" }, "e2", "Pedone bianco in e2"],
    [{ type: "k", color: "b" }, "e8", "Re nero in e8"],
    [{ type: "q", color: "b" }, "d8", "Donna nera in d8"],
    [{ type: "r", color: "b" }, "a8", "Torre nera in a8"],
    [{ type: "b", color: "b" }, "c8", "Alfiere nero in c8"],
    [{ type: "n", color: "b" }, "g8", "Cavallo nero in g8"],
    [{ type: "p", color: "b" }, "e7", "Pedone nero in e7"],
  ];
  for (const [piece, square, expected] of cases) {
    assert.equal(squareAccessibleLabel(piece, square), expected);
  }
});

test("falls back safely for malformed pieces and invalid squares", () => {
  assert.equal(squareAccessibleLabel({ type: "x", color: "w" }, "e4"), "Pezzo in e4");
  assert.equal(squareAccessibleLabel({ type: "k", color: "x" }, "e4"), "Pezzo in e4");
  assert.equal(squareAccessibleLabel(null, "z9"), "Casa non valida");
});
