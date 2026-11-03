import { Chess } from "chess.js";

export function parseUciInfo(line) {
  if (typeof line !== "string" || !line.startsWith("info ")) return null;
  const tokens = line.trim().split(/\s+/);
  const depthIndex = tokens.indexOf("depth");
  const multipvIndex = tokens.indexOf("multipv");
  const scoreIndex = tokens.indexOf("score");
  const pvIndex = tokens.indexOf("pv");

  if (scoreIndex < 0 || !["cp", "mate"].includes(tokens[scoreIndex + 1])) return null;
  const value = Number(tokens[scoreIndex + 2]);
  if (!Number.isInteger(value)) return null;

  return {
    depth: depthIndex >= 0 ? Number(tokens[depthIndex + 1]) || 0 : 0,
    multipv: multipvIndex >= 0 ? Number(tokens[multipvIndex + 1]) || 1 : 1,
    scoreType: tokens[scoreIndex + 1],
    score: value,
    pv: pvIndex >= 0 ? tokens.slice(pvIndex + 1) : [],
  };
}

export function formatUciScore(info, sideToMove = "w") {
  if (!info || !["w", "b"].includes(sideToMove)) return "—";
  const value = sideToMove === "w" ? info.score : -info.score;
  if (info.scoreType === "mate") {
    if (value === 0) return "M0";
    return (value > 0 ? "+M" : "−M") + Math.abs(value);
  }
  const pawns = value / 100;
  if (Math.abs(pawns) < 0.005) return "0.00";
  return (pawns > 0 ? "+" : "−") + Math.abs(pawns).toFixed(2);
}

export function uciPvToSan(fen, uciMoves) {
  const chess = new Chess(fen);
  const san = [];
  for (const uci of uciMoves) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) break;
    let move;
    try {
      move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        ...(uci.length > 4 ? { promotion: uci[4] } : {}),
      });
    } catch {
      move = null;
    }
    if (!move) break;
    san.push(move.san);
  }
  return san.join(" ");
}
