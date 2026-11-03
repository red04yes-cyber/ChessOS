import { Chess } from "chess.js";
import { RepertoireTree } from "./repertoire-tree.js";
import { classifyMoveLoss, explainMove, scoreToWhiteCentipawns } from "./chess-coach.js";
import { uciPvToSan } from "./engine-uci.js";

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

function moveUci(move) {
  return move.from + move.to + (move.promotion || "");
}

export function timelineFromPgn(pgn) {
  const tree = RepertoireTree.fromPgn(pgn);
  const chess = new Chess(tree.rootFen);
  const positions = [chess.fen()];
  const moves = [];
  for (const edgeId of tree.mainlinePath()) {
    const edge = tree.getEdge(edgeId);
    const uci = edge.uci;
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      ...(uci.length > 4 ? { promotion: uci[4] } : {}),
    });
    if (!move) throw new Error("La partita contiene una mossa non riproducibile: " + edge.san);
    moves.push(move);
    positions.push(chess.fen());
  }
  return { headers: tree.headers, positions, moves };
}

function materialSacrificeCandidate(fen, uci) {
  const chess = new Chess(fen);
  let move;
  try {
    move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      ...(uci.length > 4 ? { promotion: uci[4] } : {}),
    });
  } catch {
    return false;
  }
  if (!move || move.captured || (PIECE_VALUE[move.piece] || 0) < 3) return false;
  return chess.moves({ verbose: true }).some((reply) =>
    reply.to === move.to && Boolean(reply.captured)
  );
}

export function classifyMoveQuality(lossCp, brilliant = false, isBest = false) {
  if (!Number.isFinite(lossCp)) return "Non valutabile";
  if (brilliant && lossCp <= 15) return "Brillante";
  if (isBest && lossCp <= 10) return "Migliore";
  if (lossCp <= 20) return "Eccellente";
  if (lossCp <= 50) return "Buona";
  if (lossCp <= 100) return "Imprecisione";
  if (lossCp <= 200) return "Errore";
  return "Svista";
}

export function accuracyFromLosses(losses) {
  const valid = losses.filter(Number.isFinite).map((loss) => Math.max(0, loss));
  if (!valid.length) return null;
  const averageLoss = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  // Indicatore proprietario e leggibile: non replica la formula di Chess.com o Lichess.
  return Math.round(Math.max(0, Math.min(100, 100 * Math.exp(-averageLoss / 400))) * 10) / 10;
}

function playerSideFromHeaders(headers, usernames) {
  const names = (Array.isArray(usernames) ? usernames : [usernames])
    .map((name) => String(name || "").trim().toLocaleLowerCase())
    .filter(Boolean);
  if (!names.length) return null;
  const white = String(headers?.White || "").trim().toLocaleLowerCase();
  const black = String(headers?.Black || "").trim().toLocaleLowerCase();
  if (names.includes(white)) return "w";
  if (names.includes(black)) return "b";
  return null;
}

export function buildMoveReview(positions, moves, evaluations, options = {}) {
  const rows = [];
  const whiteLosses = [];
  const blackLosses = [];
  const evals = [];
  const puzzles = [];
  const playerSide = playerSideFromHeaders(options.headers, options.playerNames);

  for (let index = 0; index < positions.length; index += 1) {
    const side = positions[index].split(/\s+/)[1] || "w";
    const score = scoreToWhiteCentipawns(evaluations[index]?.info, side);
    evals.push(score);
    if (index >= moves.length) continue;
    const afterSide = positions[index + 1].split(/\s+/)[1] || (side === "w" ? "b" : "w");
    const before = score;
    const after = scoreToWhiteCentipawns(evaluations[index + 1]?.info, afterSide);
    if (before === null || after === null) continue;
    const mover = side;
    const loss = Math.max(0, mover === "w" ? before - after : after - before);
    (mover === "w" ? whiteLosses : blackLosses).push(loss);
    const move = moves[index];
    const uci = moveUci(move);
    const bestInfo = evaluations[index]?.info;
    const bestUci = bestInfo?.pv?.[0] || "";
    const bestLine = bestInfo?.pv?.length ? uciPvToSan(positions[index], bestInfo.pv) : "";
    const brilliant = loss <= 15 && materialSacrificeCandidate(positions[index], uci);
    const quality = classifyMoveQuality(loss, brilliant, Boolean(bestUci && bestUci === uci));
    const label = mover === "w"
      ? Math.ceil((index + 1) / 2) + ". " + move.san
      : Math.ceil((index + 1) / 2) + "... " + move.san;
    const row = {
      ply: index + 1,
      label,
      san: move.san,
      mover,
      uci,
      loss: Math.round(loss),
      evalAfter: after,
      quality,
      classification: quality,
      best: bestLine.split(" ").slice(0, 6).join(" "),
      bestUci,
      explanation: loss >= 50
        ? explainMove(positions[index], uci, bestInfo, loss)
        : brilliant
          ? "Sacrificio candidato: la linea del motore mantiene la valutazione nonostante il pezzo risulti attaccabile."
          : bestUci === uci
            ? "La mossa coincide con la prima scelta di Stockfish."
            : "La mossa mantiene una valutazione vicina alla migliore continuazione.",
    };
    rows.push(row);

    const belongsToPlayer = playerSide ? mover === playerSide : true;
    if (belongsToPlayer && loss >= 120 && bestUci && bestUci !== uci) {
      puzzles.push({
        id: positions[index] + "|" + bestUci,
        fen: positions[index],
        solutionUci: bestUci,
        moveLabel: label,
        quality,
        loss: Math.round(loss),
        explanation: row.explanation,
      });
    }
  }

  const whiteAccuracy = accuracyFromLosses(whiteLosses);
  const blackAccuracy = accuracyFromLosses(blackLosses);
  const accuracy = accuracyFromLosses([...whiteLosses, ...blackLosses]);
  const playerAccuracy = playerSide === "w"
    ? whiteAccuracy
    : playerSide === "b"
      ? blackAccuracy
      : accuracy;
  const counts = rows.reduce((result, row) => {
    result[row.quality] = (result[row.quality] || 0) + 1;
    return result;
  }, {});
  return {
    rows,
    evals,
    puzzles,
    counts,
    accuracy,
    whiteAccuracy,
    blackAccuracy,
    playerAccuracy,
    playerSide,
    averageLoss: [...whiteLosses, ...blackLosses].length
      ? Math.round([...whiteLosses, ...blackLosses].reduce((sum, value) => sum + value, 0)
        / [...whiteLosses, ...blackLosses].length)
      : null,
  };
}
