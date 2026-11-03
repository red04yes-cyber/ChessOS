import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeBoardMarks, emptyBoardMarks, nagsToSymbols, normalizeNag,
  parseBoardMarks, stripBoardMarkTags, toggleArrowMark, toggleSquareMark,
} from "../src/board-annotations.js";

test("round trips standard PGN square and arrow annotation tags", () => {
  const marks = {
    squares: [{ color: "G", square: "e4" }, { color: "R", square: "d5" }],
    arrows: [{ color: "Y", from: "g1", to: "f3" }],
  };
  const encoded = encodeBoardMarks("Develop the knight.", marks);
  assert.equal(encoded, "Develop the knight. [%csl Ge4,Rd5] [%cal Yg1f3]");
  assert.deepEqual(parseBoardMarks(encoded), marks);
  assert.equal(stripBoardMarkTags(encoded), "Develop the knight.");
});

test("toggles coloured squares and directional arrows", () => {
  let marks = emptyBoardMarks();
  marks = toggleSquareMark(marks, "e4", "G");
  assert.deepEqual(marks.squares, [{ square: "e4", color: "G" }]);
  marks = toggleSquareMark(marks, "e4", "G");
  assert.deepEqual(marks.squares, []);
  marks = toggleArrowMark(marks, "g1", "f3", "B");
  assert.deepEqual(marks.arrows, [{ from: "g1", to: "f3", color: "B" }]);
  marks = toggleArrowMark(marks, "g1", "f3", "B");
  assert.deepEqual(marks.arrows, []);
});

test("supports common move NAGs and renders their symbols", () => {
  assert.equal(normalizeNag("$3"), "$3");
  assert.equal(normalizeNag("$999"), "");
  assert.equal(nagsToSymbols(["$1", "$5", "$2"]), "!!!?");
});
