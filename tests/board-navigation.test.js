import test from "node:test";
import assert from "node:assert/strict";
import { nextBoardSquare } from "../src/board-navigation.js";

test("moves keyboard focus one visual square in all four directions", () => {
  assert.equal(nextBoardSquare("e4", "ArrowLeft"), "d4");
  assert.equal(nextBoardSquare("e4", "ArrowRight"), "f4");
  assert.equal(nextBoardSquare("e4", "ArrowUp"), "e5");
  assert.equal(nextBoardSquare("e4", "ArrowDown"), "e3");
});

test("reverses visual directions when the board is flipped", () => {
  assert.equal(nextBoardSquare("e4", "ArrowLeft", true), "f4");
  assert.equal(nextBoardSquare("e4", "ArrowRight", true), "d4");
  assert.equal(nextBoardSquare("e4", "ArrowUp", true), "e3");
  assert.equal(nextBoardSquare("e4", "ArrowDown", true), "e5");
});

test("does not wrap at board edges or react to invalid input", () => {
  assert.equal(nextBoardSquare("a4", "ArrowLeft"), null);
  assert.equal(nextBoardSquare("h4", "ArrowRight"), null);
  assert.equal(nextBoardSquare("e8", "ArrowUp"), null);
  assert.equal(nextBoardSquare("e1", "ArrowDown"), null);
  assert.equal(nextBoardSquare("z9", "ArrowRight"), null);
  assert.equal(nextBoardSquare("e4", "Enter"), null);
});
