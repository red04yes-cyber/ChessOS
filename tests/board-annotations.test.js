import test from "node:test";
import assert from "node:assert/strict";
import { RepertoireTree } from "../src/repertoire-tree.js";
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
  assert.equal(nagsToSymbols(["$1", "$5", "$2"]), "!!??");
});

test("round trips move comments and visual markings through PGN storage", () => {
  const source = '1. e4 {Plan the center. [%csl Ge4] [%cal Gg1f3]} e5 *';
  const tree = RepertoireTree.fromPgn(source);
  const edge = tree.getOutgoing(tree.rootId)[0];
  assert.equal(stripBoardMarkTags(edge.comment), "Plan the center.");
  assert.deepEqual(parseBoardMarks(edge.comment), {
    squares: [{ color: "G", square: "e4" }],
    arrows: [{ color: "G", from: "g1", to: "f3" }],
  });
  const restored = RepertoireTree.fromPgn(tree.toPgn());
  const restoredEdge = restored.getOutgoing(restored.rootId)[0];
  assert.deepEqual(parseBoardMarks(restoredEdge.comment), parseBoardMarks(edge.comment));
  assert.equal(stripBoardMarkTags(restoredEdge.comment), "Plan the center.");
});


test("ignores malformed square and arrow tokens while preserving valid marks", () => {
  assert.deepEqual(parseBoardMarks(
    "Plan [%csl Ge4,Rz9,Xd5] [%cal Gg1f3,Yz1a1,Ba1a1]",
  ), {
    squares: [{ color: "G", square: "e4" }],
    arrows: [{ color: "G", from: "g1", to: "f3" }],
  });
});

test("filters invalid marks when encoding and preserves ordinary comments", () => {
  const encoded = encodeBoardMarks("Keep this note", {
    squares: [{ square: "z9", color: "G" }, { square: "e4", color: "X" }, null],
    arrows: [{ from: "a1", to: "a1", color: "G" }, { from: "a1", to: "h8", color: "X" }],
  });
  assert.equal(encoded, "Keep this note");
  assert.equal(stripBoardMarkTags("Keep [%csl Ge4] and [%cal Gg1f3] this"), "Keep and this");
});

test("recolors an existing square or arrow without creating duplicates", () => {
  let marks = toggleSquareMark(emptyBoardMarks(), "e4", "G");
  marks = toggleSquareMark(marks, "e4", "R");
  assert.deepEqual(marks.squares, [{ square: "e4", color: "R" }]);

  marks = toggleArrowMark(marks, "g1", "f3", "G");
  marks = toggleArrowMark(marks, "g1", "f3", "B");
  assert.deepEqual(marks.arrows, [{ from: "g1", to: "f3", color: "B" }]);
});
