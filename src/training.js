import { Chess } from "chess.js";

/**
 * Build a fresh training game from a PGN, preserving a custom starting FEN.
 * chess.js keeps the PGN headers after loadPgn(), including the FEN header.
 */
export function createTrainingSession(pgn) {
  const sourceGame = new Chess();
  sourceGame.loadPgn(pgn);

  const initialFen = sourceGame.getHeaders().FEN;
  return {
    game: new Chess(initialFen || undefined),
    moves: sourceGame.history({ verbose: true }),
  };
}
