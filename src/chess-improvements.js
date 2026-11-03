import { Chess } from "chess.js";

export function splitPgnGames(source) {
  const text = String(source || "").trim();
  if (!text) return [];
  const starts = [...text.matchAll(/^\[Event\s/gm)].map((match) => match.index);
  if (starts.length <= 1) return [text];
  return starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.length).trim()).filter(Boolean);
}

export function classifyMoveLoss(lossCp) {
  if (!Number.isFinite(lossCp) || lossCp < 0) return "unknown";
  if (lossCp >= 200) return "blunder";
  if (lossCp >= 100) return "mistake";
  if (lossCp >= 50) return "inaccuracy";
  return "good";
}

export function centipawnLoss(before, after) {
  if (!Number.isFinite(before?.scoreCp) || !Number.isFinite(after?.scoreCp)) return null;
  // UCI score is from the root side-to-move perspective. The next position
  // belongs to the opponent, so adding the scores measures the mover's loss.
  return Math.max(0, Math.round(before.scoreCp + after.scoreCp));
}

export function isForcingTacticalMove(fen, uciLine = []) {
  const chess = new Chess(fen);
  for (const uci of uciLine.slice(0, 4)) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(String(uci))) break;
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        ...(uci.length > 4 ? { promotion: uci[4] } : {}),
      });
      if (!move) break;
      if (/[cep]/.test(move.flags) || chess.isCheck()) return true;
    } catch {
      break;
    }
  }
  return false;
}

function resultForSide(result, color) {
  if (result === "1/2-1/2") return "draw";
  if (result === "1-0") return color === "w" ? "win" : "loss";
  if (result === "0-1") return color === "b" ? "win" : "loss";
  return "unknown";
}

export function analyzeOpponentPreparation(pgn, opponentName = "", preferredSide = "both", maxPly = 24) {
  if (!["white", "black", "both"].includes(preferredSide)) throw new RangeError("Colore avversario non valido.");
  const games = splitPgnGames(pgn);
  if (!games.length) throw new Error("Importa o incolla una raccolta PGN.");
  const name = String(opponentName || "").trim().toLocaleLowerCase();
  const maximumPly = Math.max(4, Math.min(60, Number(maxPly) || 24));
  const openings = new Map();
  const movePreferences = new Map();
  const firstMoves = new Map();
  const results = { win: 0, draw: 0, loss: 0, unknown: 0 };
  const colors = { white: 0, black: 0 };
  let gamesRead = 0;
  let ignored = 0;

  for (const source of games) {
    const chess = new Chess();
    try { chess.loadPgn(source); } catch { ignored += 1; continue; }
    const headers = chess.getHeaders();
    const white = String(headers.White || "").trim();
    const black = String(headers.Black || "").trim();
    let targetColors = [];
    if (name) {
      const isWhite = white.toLocaleLowerCase() === name;
      const isBlack = black.toLocaleLowerCase() === name;
      if (isWhite) targetColors = ["w"];
      else if (isBlack) targetColors = ["b"];
      else { ignored += 1; continue; }
    } else {
      targetColors = preferredSide === "both" ? ["w", "b"] : [preferredSide === "white" ? "w" : "b"];
    }
    const moves = chess.history({ verbose: true }).slice(0, maximumPly);
    if (!moves.length) { ignored += 1; continue; }
    gamesRead += 1;
    const openingName = String(headers.Opening || headers.ECO || "Apertura non indicata").trim();
    const result = String(headers.Result || "*");
    const sideSet = new Set(targetColors);

    for (const color of targetColors) {
      const sideName = color === "w" ? "white" : "black";
      colors[sideName] += 1;
      const opening = openings.get(openingName) || { name: openingName, games: 0, white: 0, black: 0, wins: 0, draws: 0, losses: 0 };
      opening.games += 1;
      opening[color === "w" ? "white" : "black"] += 1;
      const outcome = resultForSide(result, color);
      opening[outcome === "win" ? "wins" : outcome === "draw" ? "draws" : outcome === "loss" ? "losses" : "unknown"] =
        (opening[outcome === "win" ? "wins" : outcome === "draw" ? "draws" : outcome === "loss" ? "losses" : "unknown"] || 0) + 1;
      openings.set(openingName, opening);
      results[outcome] += 1;

      const sideMoves = moves.filter((move) => move.color === color);
      sideMoves.forEach((move, ordinal) => {
        const preferenceKey = ordinal + 1;
        const preference = movePreferences.get(preferenceKey) || { turn: preferenceKey, total: 0, moves: new Map() };
        const item = preference.moves.get(move.san) || { san: move.san, count: 0 };
        item.count += 1;
        preference.total += 1;
        preference.moves.set(move.san, item);
        movePreferences.set(preferenceKey, preference);
        if (ordinal === 0) {
          const first = firstMoves.get(move.san) || { san: move.san, count: 0 };
          first.count += 1;
          firstMoves.set(move.san, first);
        }
      });
    }
  }

  const openingRows = [...openings.values()]
    .map((item) => ({ ...item, percentage: gamesRead ? Math.round((item.games / (gamesRead * (name ? 1 : targetSideCount(preferredSide))) ) * 100) : 0 }))
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  const moveRows = [...movePreferences.values()].sort((a, b) => a.turn - b.turn).map((item) => ({
    turn: item.turn,
    total: item.total,
    moves: [...item.moves.values()].map((move) => ({ ...move, percentage: Math.round((move.count / item.total) * 100) }))
      .sort((a, b) => b.count - a.count || a.san.localeCompare(b.san)).slice(0, 5),
  }));
  return {
    opponent: name || "Colore selezionato",
    gamesRead,
    ignored,
    colors,
    results,
    openings: openingRows.slice(0, 12),
    firstMoves: [...firstMoves.values()].sort((a, b) => b.count - a.count || a.san.localeCompare(b.san))
      .map((item) => ({ ...item, percentage: Math.round(item.count / Math.max(1, [...firstMoves.values()].reduce((sum, move) => sum + move.count, 0)) * 100) }))
      .slice(0, 8),
    movePreferences: moveRows,
  };
}

function targetSideCount(side) {
  return side === "both" ? 2 : 1;
}

function parseLog(log) {
  const raw = log?.stateJson ?? log?.state_json;
  if (typeof raw !== "string") return {};
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

export function buildWeaknessHeatmap(tree, cards = [], logs = [], now = new Date()) {
  if (!tree?.nodes || !tree?.edges) return { totalMoves: 0, reviewedMoves: 0, positions: [] };
  const edgeIds = new Set([...tree.edges.values()].map((edge) => edge.id));
  const activeCards = cards.filter((card) => edgeIds.has(card.edgeId));
  const logsByCard = new Map();
  for (const log of logs) {
    const cardId = log.cardId ?? log.card_id;
    if (!cardId) continue;
    const list = logsByCard.get(cardId) || [];
    list.push(log);
    logsByCard.set(cardId, list);
  }
  const groups = new Map();
  for (const card of activeCards) {
    const key = card.positionId || card.fen;
    const group = groups.get(key) || {
      key,
      fen: card.fen,
      moves: [],
      reviews: 0,
      misses: 0,
      overdue: 0,
      reviewedMoveIds: new Set(),
    };
    const cardLogs = logsByCard.get(card.id) || [];
    group.reviews += cardLogs.length;
    group.misses += cardLogs.filter((log) => {
      const meta = parseLog(log);
      return typeof meta.recalled === "boolean" ? !meta.recalled : Number(log.rating) === 1;
    }).length;
    if (cardLogs.length) group.reviewedMoveIds.add(card.id);
    const due = new Date(card.fsrs?.due || 0).getTime();
    if (Number.isFinite(due) && due <= now.getTime()) group.overdue += 1;
    group.moves.push(card.san);
    groups.set(key, group);
  }
  const positions = [...groups.values()].map((group) => {
    const reviewedMoves = group.reviewedMoveIds.size;
    const accuracy = group.reviews ? Math.round(((group.reviews - group.misses) / group.reviews) * 100) : null;
    const confidence = group.reviews >= 3 ? "buon campione" : group.reviews ? "campione ridotto" : "dati insufficienti";
    const weaknessScore = group.reviews
      ? Math.min(100, Math.round((group.misses / group.reviews) * 80 + (group.overdue / Math.max(1, group.moves.length)) * 20))
      : null;
    return {
      key: group.key,
      fen: group.fen,
      moves: group.moves,
      reviews: group.reviews,
      reviewedMoves,
      misses: group.misses,
      overdue: group.overdue,
      accuracy,
      weaknessScore,
      confidence,
      label: weaknessScore === null ? "Non ancora misurabile"
        : weaknessScore >= 60 ? "Debolezza alta"
        : weaknessScore >= 30 ? "Da consolidare" : "Solida",
    };
  }).sort((a, b) => (b.weaknessScore ?? -1) - (a.weaknessScore ?? -1) || b.reviews - a.reviews);
  return {
    totalMoves: activeCards.length,
    reviewedMoves: new Set(activeCards.filter((card) => (logsByCard.get(card.id) || []).length).map((card) => card.id)).size,
    positions,
  };
}

export async function analyzeGameWithStockfish(pgn, engine, options = {}) {
  if (!engine || typeof engine.analyze !== "function") throw new TypeError("Motore Stockfish non disponibile.");
  const games = splitPgnGames(pgn);
  if (!games.length) throw new Error("Importa o incolla una partita in formato PGN.");
  const maxGames = Math.max(1, Math.min(5, Number(options.maxGames) || 1));
  const maxPlies = Math.max(4, Math.min(80, Number(options.maxPlies) || 60));
  const depth = Math.max(8, Math.min(16, Number(options.depth) || 10));
  const threshold = Math.max(20, Math.min(300, Number(options.thresholdCp) || 50));
  const report = { gamesRead: 0, ignored: 0, pliesAnalyzed: 0, averageLossCp: 0, mistakes: [], categories: { inaccuracy: 0, mistake: 0, blunder: 0 } };
  let totalLoss = 0;
  let evaluatedMoves = 0;

  for (const [gameIndex, source] of games.slice(0, maxGames).entries()) {
    const chess = new Chess();
    try { chess.loadPgn(source); } catch { report.ignored += 1; continue; }
    const headers = chess.getHeaders();
    const moves = chess.history({ verbose: true }).slice(0, maxPlies);
    if (!moves.length) { report.ignored += 1; continue; }
    report.gamesRead += 1;
    const cache = new Map();
    const evaluate = async (fen, multiPv = 1) => {
      const key = fen.trim();
      if (!cache.has(key)) cache.set(key, engine.analyze(key, depth, multiPv));
      return cache.get(key);
    };

    for (let index = 0; index < moves.length; index += 1) {
      const move = moves[index];
      let before;
      let after;
      try {
        before = await evaluate(move.before, 2);
        after = await evaluate(move.after, 1);
      } catch (error) {
        throw new Error("Analisi interrotta alla mossa " + (move.moveNumber || Math.floor(index / 2) + 1) + ": " + (error?.message || String(error)));
      }
      report.pliesAnalyzed += 1;
      const lossCp = centipawnLoss(before, after);
      if (lossCp === null) continue;
      evaluatedMoves += 1;
      totalLoss += lossCp;
      const category = classifyMoveLoss(lossCp);
      if (category !== "good") {
        const uci = move.from + move.to + (move.promotion || "");
        report.categories[category] += 1;
        report.mistakes.push({
          id: headers.FEN ? headers.FEN + "|" + uci : move.before + "|" + uci,
          gameIndex,
          opening: headers.Opening || headers.ECO || "Apertura non indicata",
          white: headers.White || "Bianco",
          black: headers.Black || "Nero",
          result: headers.Result || "*",
          moveNumber: move.moveNumber || Math.floor(index / 2) + 1,
          color: move.color,
          fen: move.before,
          afterFen: move.after,
          playedUci: uci,
          playedSan: move.san,
          bestUci: before.bestmove && before.bestmove !== "(none)" ? before.bestmove : null,
          bestSan: before.bestSan || null,
          lossCp,
          category,
          pv: before.pvSan || [],
        });
      }
      options.onProgress?.({
        game: gameIndex + 1,
        games: Math.min(games.length, maxGames),
        ply: index + 1,
        plies: moves.length,
      });
    }
  }
  report.averageLossCp = evaluatedMoves ? Math.round(totalLoss / evaluatedMoves) : null;
  report.mistakes.sort((a, b) => b.lossCp - a.lossCp || a.moveNumber - b.moveNumber);
  return report;
}
