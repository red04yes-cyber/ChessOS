import test from "node:test";
import assert from "node:assert/strict";
import { getAdjacentSquare } from "../src/board-navigation.js";

test("moves focus by the visible grid direction when the board is unflipped", () => {
  assert.equal(getAdjacentSquare("e4", "ArrowUp"), "e5");
  assert.equal(getAdjacentSquare("e4", "ArrowDown"), "e3");
  assert.equal(getAdjacentSquare("e4", "ArrowLeft"), "d4");
  assert.equal(getAdjacentSquare("e4", "ArrowRight"), "f4");
});

test("reverses the file and rank mapping when the board is flipped", () => {
  assert.equal(getAdjacentSquare("e4", "ArrowUp", true), "e3");
  assert.equal(getAdjacentSquare("e4", "ArrowDown", true), "e5");
  assert.equal(getAdjacentSquare("e4", "ArrowLeft", true), "f4");
  assert.equal(getAdjacentSquare("e4", "ArrowRight", true), "d4");
});

test("does not wrap focus around board edges", () => {
  assert.equal(getAdjacentSquare("a8", "ArrowUp"), null);
  assert.equal(getAdjacentSquare("a8", "ArrowLeft"), null);
  assert.equal(getAdjacentSquare("h1", "ArrowDown"), null);
  assert.equal(getAdjacentSquare("h1", "ArrowRight"), null);
  assert.equal(getAdjacentSquare("h8", "ArrowDown", true), null);
});

test("rejects invalid squares and unrelated keys", () => {
  assert.equal(getAdjacentSquare("z9", "ArrowUp"), null);
  assert.equal(getAdjacentSquare("e4", "Enter"), null);
  assert.equal(getAdjacentSquare("", "ArrowLeft"), null);
});
