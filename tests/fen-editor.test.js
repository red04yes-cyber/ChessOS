import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { editorStateToFen, fenToEditorState, validateEditorFen } from "../src/fen-editor.js";

test("round trips the standard starting FEN through the visual editor state", () => {
  const source = new Chess().fen();
  const parsed = fenToEditorState(source);
  assert.equal(editorStateToFen(parsed), source);
});

test("accepts a custom legal position with black to move and no castling rights", () => {
  const source = "4k3/8/8/8/8/8/4K3/8 b - - 7 23";
  const result = validateEditorFen(source);
  assert.equal(result.fen, source);
  assert.equal(result.state.turn, "b");
});

test("rejects missing kings, pawns on promotion ranks and castling without the rook", () => {
  const base = fenToEditorState(new Chess().fen());
  const missingKing = { ...base, pieces: { ...base.pieces, e1: undefined } };
  assert.throws(() => editorStateToFen(missingKing), /un re bianco e un re nero/i);
  const invalidPawn = { ...base, pieces: { ...base.pieces, a8: "wP" } };
  assert.throws(() => editorStateToFen(invalidPawn), /pedone/i);
  const noRook = { ...base, pieces: { ...base.pieces, h1: undefined } };
  assert.throws(() => editorStateToFen(noRook), /arrocco/i);
});

test("validates side-specific en-passant targets and the pawn that just advanced", () => {
  const base = fenToEditorState(new Chess().fen());
  const afterE5 = {
    ...base,
    pieces: { ...base.pieces, e7: undefined, e5: "bP", d5: "wP" },
    turn: "w",
    enPassant: "e6",
    halfmove: 0,
  };
  assert.match(editorStateToFen(afterE5), / e6 0 1$/);
  assert.throws(() => editorStateToFen({ ...afterE5, enPassant: "e3" }), /colore che deve muovere/i);
  assert.throws(() => editorStateToFen({ ...afterE5, pieces: { ...afterE5.pieces, e5: undefined } }), /doppia spinta/i);
});


test("rejects invalid square names and unknown piece codes", () => {
  const base = fenToEditorState(new Chess().fen());
  assert.throws(() => editorStateToFen({
    ...base,
    pieces: { ...base.pieces, z9: "wQ" },
  }), /Pezzo o casa non valido/i);
  assert.throws(() => editorStateToFen({
    ...base,
    pieces: { ...base.pieces, a3: "wX" },
  }), /Pezzo o casa non valido/i);
});

test("rejects invalid side-to-move, duplicate castling rights and unsupported rights", () => {
  const base = fenToEditorState(new Chess().fen());
  assert.throws(() => editorStateToFen({ ...base, turn: "x" }), /deve muovere/i);
  assert.throws(() => editorStateToFen({ ...base, castling: ["K", "K"] }), /Diritti di arrocco/i);
  assert.throws(() => editorStateToFen({ ...base, castling: ["K", "X"] }), /Diritti di arrocco/i);
});

test("enforces non-negative halfmove and positive fullmove counters", () => {
  const base = fenToEditorState(new Chess().fen());
  assert.throws(() => editorStateToFen({ ...base, halfmove: -1 }), /Contatore/i);
  assert.throws(() => editorStateToFen({ ...base, halfmove: 1.5 }), /Contatore/i);
  assert.throws(() => editorStateToFen({ ...base, fullmove: 0 }), /Numero della mossa/i);
  assert.throws(() => editorStateToFen({ ...base, fullmove: 2.5 }), /Numero della mossa/i);
});

test("rejects an occupied en-passant target square", () => {
  const base = fenToEditorState(new Chess().fen());
  const afterE5 = {
    ...base,
    pieces: { ...base.pieces, e7: undefined, e5: "bP", d5: "wP", e6: "wN" },
    turn: "w",
    enPassant: "e6",
    halfmove: 0,
  };
  assert.throws(() => editorStateToFen(afterE5), /casa en passant/i);
});
