import { Chess } from "chess.js";
import { RepertoireTree } from "./repertoire-tree.js";
import { ENDGAME_CATALOG, ENDGAME_LESSONS } from "./endgame-catalog.js";
import { stockfish } from "./stockfish-engine.js";

const GAME_IMPORT_KEY = "chess-os.imported-games.v1";
const MAX_IMPORT_GAMES = 300;
const SYMBOLS = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};
const files = "abcdefgh";

function $(selector) { return document.querySelector(selector); }
function message(selector, value) { const el = $(selector); if (el) el.textContent = value; }
function positionKey(fen) { return fen.trim().split(/\s+/).slice(0, 4).join(" "); }
function splitPgnGames(source) {
  const text = String(source || "").trim();
  if (!text) return [];
  const starts = [...text.matchAll(/^\[Event\s/gm)].map((match) => match.index);
  if (starts.length <= 1) return [text];
  return starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.length).trim()).filter(Boolean);
}
function parseUci(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length > 4 ? { promotion: uci[4] } : {}) };
}
function countPieces(fen) { return (fen.split(/\s+/)[0].match(/[pnbrqk]/gi) || []).length; }
function setButtonBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  if (busy) { button.dataset.originalLabel = button.textContent; button.textContent = label || "Elaborazione…"; }
  else if (button.dataset.originalLabel) { button.textContent = button.dataset.originalLabel; delete button.dataset.originalLabel; }
}
function getStoredGames() {
  try { return localStorage.getItem(GAME_IMPORT_KEY) || ""; } catch { return ""; }
}
function persistGames(pgn) {
  try { localStorage.setItem(GAME_IMPORT_KEY, pgn); } catch { throw new Error("Archivio locale pieno: esporta le partite o riduci il numero importato."); }
}
function fillPgnFields(pgn) {
  for (const selector of ["#mistake-pgn", "#opponent-pgn", "#opening-pgn", "#tactics-pgn"]) {
    const field = $(selector);
    if (field) field.value = pgn;
  }
}

export async function fetchLichessGames(username, maxGames = 100) {
  const name = String(username || "").trim();
  if (!/^[\w-]{2,30}$/.test(name)) throw new Error("Username Lichess non valido.");
  const max = Math.max(1, Math.min(MAX_IMPORT_GAMES, Number(maxGames) || 100));
  const url = new URL("https://lichess.org/api/games/user/" + encodeURIComponent(name));
  url.searchParams.set("max", String(max));
  url.searchParams.set("moves", "true");
  url.searchParams.set("tags", "true");
  url.searchParams.set("opening", "true");
  const response = await fetch(url, { headers: { Accept: "application/x-chess-pgn" } });
  if (response.status === 429) throw new Error("Lichess ha imposto un limite temporaneo. Attendi almeno un minuto prima di riprovare.");
  if (!response.ok) throw new Error("Lichess ha risposto con HTTP " + response.status + ".");
  const pgn = (await response.text()).trim();
  if (!pgn) throw new Error("Non sono state trovate partite pubbliche per questo account.");
  return pgn;
}

export async function fetchChessComGames(username, maxGames = 100) {
  const name = String(username || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,25}$/.test(name)) throw new Error("Username Chess.com non valido.");
  const max = Math.max(1, Math.min(MAX_IMPORT_GAMES, Number(maxGames) || 100));
  const root = "https://api.chess.com/pub/player/" + encodeURIComponent(name) + "/games";
  const archivesResponse = await fetch(root + "/archives", { headers: { Accept: "application/json" } });
  if (archivesResponse.status === 429) throw new Error("Chess.com ha imposto un limite temporaneo. Riprova più tardi.");
  if (!archivesResponse.ok) throw new Error("Chess.com ha risposto con HTTP " + archivesResponse.status + ".");
  const archives = (await archivesResponse.json()).archives;
  if (!Array.isArray(archives) || !archives.length) throw new Error("Nessun archivio pubblico trovato per questo account.");

  const pgnParts = [];
  // Chess.com raccomanda richieste seriali: non parallelizzare gli archivi.
  for (const archiveUrl of [...archives].reverse()) {
    if (pgnParts.length >= max) break;
    const response = await fetch(archiveUrl, { headers: { Accept: "application/json" } });
    if (response.status === 429) throw new Error("Chess.com ha imposto un limite temporaneo durante il download. Riprova più tardi.");
    if (!response.ok) continue;
    const archive = await response.json();
    if (!Array.isArray(archive.games)) continue;
    const games = archive.games
      .map((game) => typeof game.pgn === "string" ? game.pgn.trim() : "")
      .filter(Boolean);
    pgnParts.push(...games.slice(0, Math.max(0, max - pgnParts.length)));
  }
  if (!pgnParts.length) throw new Error("Nessuna partita PGN pubblica disponibile nei mesi consultati.");
  return pgnParts.slice(0, max).join("\n\n");
}

export function analyzeOpeningExplorer(pgn, tree, options = {}) {
  const maxPly = Math.max(4, Math.min(60, Number(options.maxPly) || 24));
  const minimum = Math.max(1, Number(options.minimum) || 2);
  const games = splitPgnGames(pgn);
  if (!games.length) throw new Error("Importa o incolla una raccolta PGN.");
  const positions = new Map();
  let gamesRead = 0;
  let ignored = 0;

  for (const source of games) {
    const chess = new Chess();
    try { chess.loadPgn(source); } catch { ignored += 1; continue; }
    const moves = chess.history({ verbose: true }).slice(0, maxPly);
    if (!moves.length) { ignored += 1; continue; }
    gamesRead += 1;
    for (const move of moves) {
      const key = positionKey(move.before);
      const data = positions.get(key) || { key, fen: move.before, visits: 0, moves: new Map() };
      data.visits += 1;
      const item = data.moves.get(move.from + move.to + (move.promotion || "")) || {
        uci: move.from + move.to + (move.promotion || ""),
        san: move.san,
        count: 0,
      };
      item.count += 1;
      data.moves.set(item.uci, item);
      positions.set(key, data);
    }
  }

  const rows = [];
  for (const item of positions.values()) {
    if (item.visits < minimum) continue;
    const moves = [...item.moves.values()].sort((a, b) => b.count - a.count || a.san.localeCompare(b.san));
    const knownNodes = tree?.nodesByPosition?.get(item.key) || [];
    const repertoireEdges = knownNodes.flatMap((id) => tree.getOutgoing(id));
    const knownUci = new Set(repertoireEdges.map((edge) => edge.uci));
    const missing = moves.filter((move) => !knownUci.has(move.uci));
    rows.push({
      fen: item.fen,
      visits: item.visits,
      moves: moves.slice(0, 8).map((move) => ({ ...move, percentage: Math.round(move.count / item.visits * 100) })),
      repertoireMoves: repertoireEdges.map((edge) => edge.san),
      missing: missing.slice(0, 5).map((move) => ({ ...move, percentage: Math.round(move.count / item.visits * 100) })),
    });
  }
  rows.sort((a, b) => b.visits - a.visits);
  return { gamesRead, ignored, positions: rows, gapCount: rows.reduce((sum, row) => sum + row.missing.length, 0) };
}

export function buildRepertoireFromPgn(pgn, side = "white", minimumFrequency = 1, maxPly = 24) {
  if (!["white", "black"].includes(side)) throw new Error("Seleziona Bianco o Nero.");
  const games = splitPgnGames(pgn);
  if (!games.length) throw new Error("Importa una raccolta PGN prima di generare il repertorio.");
  const max = Math.max(4, Math.min(60, Number(maxPly) || 24));
  const minimum = Math.max(1, Number(minimumFrequency) || 1);
  const parsed = [];
  const counts = new Map();
  let ignored = 0;
  for (const source of games) {
    const chess = new Chess();
    try { chess.loadPgn(source); } catch { ignored += 1; continue; }
    const moves = chess.history({ verbose: true }).slice(0, max);
    if (!moves.length) { ignored += 1; continue; }
    parsed.push(moves);
    for (const move of moves) {
      const key = positionKey(move.before) + "|" + move.from + move.to + (move.promotion || "");
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  if (!parsed.length) throw new Error("Nessuna partita valida nella raccolta PGN.");

  const tree = new RepertoireTree();
  tree.headers = { Event: "ChessOS generated repertoire", Site: "Imported PGN collection", White: side === "white" ? "Repertoire" : "Opponent", Black: side === "black" ? "Repertoire" : "Opponent" };
  let includedMoves = 0;
  for (const moves of parsed) {
    let nodeId = tree.rootId;
    for (const move of moves) {
      const key = positionKey(move.before) + "|" + move.from + move.to + (move.promotion || "");
      if ((counts.get(key) || 0) < minimum) break;
      const edge = tree.addMove(nodeId, move, move.after);
      nodeId = edge.to;
      includedMoves += 1;
    }
  }
  for (const edge of tree.edges.values()) {
    const from = tree.getNode(edge.from);
    const frequency = counts.get(from.key + "|" + edge.uci) || 0;
    const ratio = parsed.length ? Math.round(frequency / parsed.length * 100) : 0;
    edge.comment = `Frequenza nel campione: ${frequency} partite (${ratio}% del campione; ${parsed.length} partite)`;
  }
  return { tree, gamesRead: parsed.length, ignored, includedMoves, positionCount: tree.nodes.size, moveCount: tree.edges.size, side, minimumFrequency: minimum };
}

export function renderMiniBoard(element, chess, selectedSquare, onSquare) {
  if (!element) return;
  const board = chess.board();
  element.replaceChildren();
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const square = files[col] + String(8 - row);
      const piece = board[row][col];
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.square = square;
      button.className = "mini-square " + ((row + col) % 2 ? "dark" : "light") + (selectedSquare === square ? " selected" : "");
      if (piece) {
        button.textContent = SYMBOLS[piece.color][piece.type];
        button.classList.add(piece.color === "w" ? "white-piece" : "black-piece");
        button.setAttribute("aria-label", (piece.color === "w" ? "Bianco " : "Nero ") + piece.type + " " + square);
      } else button.setAttribute("aria-label", square);
      button.addEventListener("click", () => onSquare(square));
      element.append(button);
    }
  }
}

function createBoardController(element, getGame, onChange, canInteract = () => true) {
  let selected = null;
  const render = () => renderMiniBoard(element, getGame(), selected, onSquare);
  const onSquare = (square) => {
    if (!canInteract()) return;
    const chess = getGame();
    if (chess.isGameOver()) return;
    const piece = chess.get(square);
    if (!selected) {
      if (piece && piece.color === chess.turn()) selected = square;
      render();
      return;
    }
    if (selected === square) { selected = null; render(); return; }
    if (piece && piece.color === chess.turn()) { selected = square; render(); return; }
    const moves = chess.moves({ square: selected, verbose: true }).filter((move) => move.to === square);
    if (!moves.length) { selected = null; render(); return; }
    try {
      chess.move({ from: selected, to: square, ...(moves[0].promotion ? { promotion: "q" } : {}) });
      selected = null;
      render();
      onChange?.(chess);
    } catch {
      selected = null;
      render();
    }
  };
  return { render, clear() { selected = null; render(); } };
}

function formatEngineResult(result) {
  const evaluation = result.mate !== null
    ? "Matto in " + result.mate
    : result.scoreCp === null ? "valutazione non disponibile" : (result.scoreCp > 0 ? "+" : "") + (result.scoreCp / 100).toFixed(2);
  return { evaluation, best: result.bestSan || "—", pv: result.pvSan.join(" ") || "—", depth: result.depth };
}

export function initializeChessSuite({ getCurrentTree, loadGeneratedTree, getCurrentFen, getCurrentEdge, onAnnotationSaved, onError }) {
  const engine = stockfish;
  let endgameGame = new Chess();
  let endgameBoard;
  let sparringGame = new Chess();
  let sparringBoard;
  let sparringColor = "w";
  let sparringBusy = false;
  let puzzleQueue = [];
  let currentPuzzle = null;
  let tacticsBoard;
  let tacticsGame = null;
  let tacticsLoading = false;
  let importedPgn = getStoredGames();
  let endgameLesson = ENDGAME_LESSONS[0];
  let endgameCards = readEndgameProgress();

  function readEndgameProgress() {
    try { return JSON.parse(localStorage.getItem("chess-os.endgame-progress.v1") || "{}"); } catch { return {}; }
  }
  function saveEndgameProgress() {
    try { localStorage.setItem("chess-os.endgame-progress.v1", JSON.stringify(endgameCards)); } catch { /* Keep this session usable even when storage is full. */ }
  }
  function updateEndgameSummary() {
    const completed = Object.values(endgameCards).filter((entry) => entry.completed).length;
    const mastered = Object.values(endgameCards).filter((entry) => entry.mastered).length;
    message("#endgame-summary", `${ENDGAME_LESSONS.length} lezioni · ${ENDGAME_CATALOG.length} capitoli · ${completed} completate · ${mastered} padroneggiate`);
  }
  function selectedEndgameLesson() {
    const id = $("#endgame-topic")?.value;
    return ENDGAME_LESSONS.find((lesson) => lesson.id === id) || endgameLesson;
  }
  function populateEndgameTopics() {
    const category = $("#endgame-category");
    const topics = $("#endgame-topic");
    if (!category || !topics) return;
    const selected = ENDGAME_CATALOG.find((item) => item.id === category.value) || ENDGAME_CATALOG[0];
    topics.replaceChildren();
    for (const item of selected.lessons) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.title + " · " + item.level;
      topics.append(option);
    }
    endgameLesson = selected.lessons[0] || ENDGAME_LESSONS[0];
    renderEndgameLesson();
    loadEndgamePosition();
  }
  function renderEndgameLesson() {
    endgameLesson = selectedEndgameLesson();
    const area = $("#endgame-lesson");
    if (area) {
      area.replaceChildren();
      const heading = document.createElement("strong");
      heading.textContent = endgameLesson.title + " · " + endgameLesson.level;
      const focus = document.createElement("p");
      focus.textContent = endgameLesson.focus;
      const objective = document.createElement("p");
      objective.textContent = "Obiettivo: " + endgameLesson.objective;
      const method = document.createElement("p");
      method.textContent = "Metodo: " + endgameLesson.method;
      const errors = document.createElement("p");
      errors.textContent = "Errore tipico: " + endgameLesson.errors;
      area.append(heading, focus, objective, method, errors);
    }
    const fenInput = $("#endgame-fen");
    if (fenInput) fenInput.value = endgameLesson.fen;
    const progress = endgameCards[endgameLesson.id];
    message("#endgame-progress", progress?.mastered ? "Padroneggiato" : progress?.completed ? "Completato · da consolidare" : progress?.attempts ? "Tentativi effettuati · da completare" : "Non ancora completato");
    const masteredButton = $("#endgame-mastered");
    if (masteredButton) masteredButton.textContent = progress?.mastered ? "Rimuovi stato appreso" : "Segna come appreso";
    updateEndgameSummary();
  }
  function loadEndgamePosition() {
    const fen = $("#endgame-fen").value.trim();
    try {
      endgameGame = new Chess(fen);
      endgameBoard.render();
      message("#endgame-status", "Posizione caricata · " + (endgameGame.turn() === "w" ? "Bianco" : "Nero") + " al tratto.");
      message("#endgame-evaluation", "Usa il motore o la Syzygy Tablebase per verificare la posizione.");
    } catch (error) { message("#endgame-status", "FEN non valida: " + error.message); }
  }
  async function analyzeEndgame() {
    const button = $("#endgame-analyze");
    setButtonBusy(button, true, "Analisi in corso…");
    try {
      const result = await engine.analyze(endgameGame.fen(), 17, 3);
      const view = formatEngineResult(result);
      message("#endgame-evaluation", `Stockfish · ${view.evaluation} · profondità ${view.depth} · migliore: ${view.best} · linea: ${view.pv}`);
    } catch (error) { message("#endgame-evaluation", "Analisi non disponibile: " + error.message); }
    finally { setButtonBusy(button, false); }
  }
  async function engineEndgameMove() {
    const button = $("#endgame-engine-move");
    setButtonBusy(button, true, "Il motore sta giocando…");
    try {
      const result = await engine.bestMove(endgameGame.fen(), 12);
      if (!result.bestmove || result.bestmove === "(none)") throw new Error("La posizione non ha mosse legali.");
      endgameGame.move(parseUci(result.bestmove));
      endgameBoard.render();
      message("#endgame-status", "Mossa Stockfish: " + result.bestSan + ". " + (endgameGame.isGameOver() ? "Partita terminata." : "Continua lo studio."));
    } catch (error) { message("#endgame-status", error.message); }
    finally { setButtonBusy(button, false); }
  }
  function markEndgameMastered() {
    const progress = endgameCards[endgameLesson.id] || { attempts: 0, completed: false, mastered: false };
    if (progress.mastered) {
      progress.mastered = false;
      progress.completed = false;
      delete progress.masteredAt;
    } else {
      progress.completed = true;
      progress.mastered = true;
      progress.masteredAt = new Date().toISOString();
    }
    endgameCards[endgameLesson.id] = progress;
    saveEndgameProgress();
    renderEndgameLesson();
    message("#endgame-status", progress.mastered ? "Lezione segnata come appresa." : "Stato di padronanza rimosso.");
  }

  async function probeEndgameTablebase() {
    const button = $("#endgame-tablebase");
    const fen = endgameGame.fen();
    const pieces = countPieces(fen);
    if (pieces > 7) { message("#endgame-tablebase-result", `Syzygy copre al massimo 7 pezzi: questa posizione ne contiene ${pieces}.`); return; }
    setButtonBusy(button, true, "Interrogazione tablebase…");
    try {
      const url = "https://tablebase.lichess.ovh/standard?fen=" + encodeURIComponent(fen);
      const response = await fetch(url);
      if (response.status === 429) throw new Error("Limite tablebase raggiunto. Attendi prima di riprovare.");
      if (!response.ok) throw new Error("Tablebase HTTP " + response.status + ".");
      const data = await response.json();
      const labels = { win: "Vinta", cursedWin: "Vinta ma patta con regola 50 mosse", draw: "Patta", blessedLoss: "Persa ma patta con regola 50 mosse", loss: "Persa" };
      const lines = (data.moves || []).slice(0, 12).map((move) => `${move.san}: ${labels[move.category] || move.category} · DTZ ${move.dtz ?? "—"}`);
      message("#endgame-tablebase-result", `Syzygy: ${labels[data.category] || data.category || "risultato non disponibile"} · DTZ ${data.dtz ?? "—"}. ${lines.join(" | ")}`);
      const progress = endgameCards[endgameLesson.id] || { completed: false, mastered: false, attempts: 0 };
      progress.attempts += 1;
      progress.lastWdl = data.category || null;
      progress.lastProbedAt = new Date().toISOString();
      progress.mastered = Boolean(progress.mastered);
      endgameCards[endgameLesson.id] = progress;
      saveEndgameProgress();
      renderEndgameLesson();
    } catch (error) { message("#endgame-tablebase-result", "Tablebase non disponibile: " + error.message); }
    finally { setButtonBusy(button, false); }
  }

  function renderSparring() {
    sparringBoard.render();
    const status = sparringGame.isGameOver()
      ? (sparringGame.isCheckmate() ? "Matto · vince " + (sparringGame.turn() === "w" ? "Nero" : "Bianco") : "Patta")
      : "Al tratto: " + (sparringGame.turn() === "w" ? "Bianco" : "Nero");
    message("#sparring-status", status);
    message("#sparring-moves", sparringGame.history().join(" "));
  }
  async function engineSparringMove() {
    if (sparringBusy || sparringGame.isGameOver()) return;
    sparringBusy = true;
    const button = $("#sparring-start");
    setButtonBusy(button, true, "L'avversario sta pensando…");
    try {
      const elo = Number($("#sparring-elo").value) || 1600;
      const result = await engine.bestMove(sparringGame.fen(), 11, elo);
      if (!result.bestmove || result.bestmove === "(none)") throw new Error("Il motore non ha una mossa legale.");
      const move = sparringGame.move(parseUci(result.bestmove));
      renderSparring();
      message("#sparring-status", "Avversario: " + move.san + " · " + (sparringGame.isGameOver() ? "Partita terminata." : "Tocca a te."));
    } catch (error) { message("#sparring-status", "Motore non disponibile: " + error.message); }
    finally { sparringBusy = false; setButtonBusy(button, false); }
  }
  function onSparringMove(chess) {
    if (chess.isGameOver()) { renderSparring(); return; }
    renderSparring();
    if (chess.turn() !== sparringColor) void engineSparringMove();
  }
  function startSparring() {
    sparringColor = $("#sparring-color").value === "black" ? "b" : "w";
    sparringGame = new Chess();
    sparringBoard.render();
    renderSparring();
    if (sparringGame.turn() !== sparringColor) void engineSparringMove();
  }

  async function importAccountGames() {
    const button = $("#account-import");
    const provider = $("#account-provider").value;
    const username = $("#account-username").value.trim();
    const max = Number($("#account-max").value) || 100;
    setButtonBusy(button, true, "Download sequenziale…");
    message("#account-import-status", "Connessione a " + provider + "…");
    try {
      const pgn = provider === "lichess" ? await fetchLichessGames(username, max) : await fetchChessComGames(username, max);
      const games = splitPgnGames(pgn);
      importedPgn = pgn;
      persistGames(pgn);
      fillPgnFields(pgn);
      message("#account-import-status", `Importate ${games.length} partite da ${provider}. Le partite sono disponibili in Opening Explorer, Tactics e preparazione avversario.`);
      message("#opening-summary", `Archivio pronto: ${games.length} partite importate.`);
    } catch (error) { message("#account-import-status", "Importazione non riuscita: " + error.message); }
    finally { setButtonBusy(button, false); }
  }

  function analyzeOpenings() {
    const pgn = $("#opening-pgn").value.trim() || importedPgn;
    try {
      const report = analyzeOpeningExplorer(pgn, getCurrentTree(), { maxPly: Number($("#opening-max-ply").value), minimum: Number($("#opening-minimum").value) });
      const target = $("#opening-report");
      target.replaceChildren();
      const summary = document.createElement("p");
      summary.textContent = `${report.gamesRead} partite valide · ${report.positions.length} posizioni esplorate · ${report.gapCount} risposte viste nel campione ma non incluse nel repertorio.`;
      target.append(summary);
      for (const row of report.positions.slice(0, 18)) {
        const card = document.createElement("div");
        card.className = "suite-report-row";
        const head = document.createElement("strong");
        head.textContent = `${row.visits} visite · ${row.fen.split(/\s+/)[0]}`;
        card.append(head);
        const popular = document.createElement("p");
        popular.textContent = "Più giocate: " + row.moves.slice(0, 4).map((item) => `${item.san} (${item.percentage}%)`).join(" · ");
        card.append(popular);
        if (row.missing.length) {
          const gaps = document.createElement("p");
          gaps.className = "suite-warning";
          gaps.textContent = "Gap: " + row.missing.map((item) => `${item.san} (${item.percentage}%)`).join(" · ");
          card.append(gaps);
        }
        target.append(card);
      }
      message("#opening-summary", "Gap Finder aggiornato. Le percentuali descrivono solo il campione importato.");
    } catch (error) { message("#opening-summary", "Analisi aperture non riuscita: " + error.message); }
  }

  function generateRepertoire() {
    const pgn = $("#generator-pgn").value.trim() || importedPgn;
    try {
      const result = buildRepertoireFromPgn(pgn, $("#generator-side").value, Number($("#generator-frequency").value), Number($("#generator-depth").value));
      loadGeneratedTree(result.tree, "Repertorio generato · " + (result.side === "white" ? "Bianco" : "Nero"));
      message("#generator-status", `Generato da ${result.gamesRead} partite · ${result.positionCount} posizioni · ${result.moveCount} mosse/varianti · ${result.ignored} PGN ignorati. Salva la linea in Studio per conservarla.`);
    } catch (error) { message("#generator-status", "Generazione non riuscita: " + error.message); }
  }

  function refreshAnnotation() {
    const edge = getCurrentEdge();
    $("#annotation-text").value = edge?.comment || "";
    $("#annotation-move").textContent = edge ? "Mossa selezionata: " + edge.san : "Seleziona una mossa dalla notazione per annotarla.";
    $("#annotation-nag").value = edge?.nags?.[0] || "";
  }
  function saveAnnotation() {
    const edge = getCurrentEdge();
    if (!edge) { message("#annotation-status", "Seleziona prima una mossa nella notazione dello Studio."); return; }
    edge.comment = $("#annotation-text").value.trim();
    const nag = $("#annotation-nag").value;
    edge.nags = edge.nags || [];
    if (nag && !edge.nags.includes(nag)) edge.nags.push(nag);
    onAnnotationSaved();
    message("#annotation-status", "Annotazione salvata nel grafo. Salva la linea per renderla permanente.");
  }

  async function analyzeCurrentPosition() {
    const button = $("#analyze-current");
    setButtonBusy(button, true, "Analisi Stockfish…");
    try {
      const fen = getCurrentFen();
      const result = await engine.analyze(fen, 17, 3);
      const view = formatEngineResult(result);
      message("#current-analysis", `Valutazione: ${view.evaluation} · profondità ${view.depth} · migliore: ${view.best} · PV: ${view.pv}`);
    } catch (error) { message("#current-analysis", "Stockfish non disponibile: " + error.message); }
    finally { setButtonBusy(button, false); }
  }

  async function createTacticalPuzzles() {
    if (tacticsLoading) return;
    const pgn = $("#tactics-pgn").value.trim() || importedPgn;
    const games = splitPgnGames(pgn);
    if (!games.length) { message("#tactics-status", "Importa partite PGN prima di creare esercizi."); return; }
    const button = $("#tactics-create");
    tacticsLoading = true;
    setButtonBusy(button, true, "Analisi motore…");
    puzzleQueue = [];
    let analyzed = 0;
    try {
      const candidates = [];
      for (const source of games) {
        const chess = new Chess();
        try { chess.loadPgn(source); } catch { continue; }
        for (const move of chess.history({ verbose: true })) {
          if (candidates.length >= 18) break;
          candidates.push({ fen: move.before, played: move.san, color: move.color, playedFen: move.after });
        }
        if (candidates.length >= 18) break;
      }
      for (const [index, candidate] of candidates.entries()) {
        message("#tactics-status", `Analisi delle opportunità tattiche: ${index + 1}/${candidates.length}…`);
        const before = await engine.analyze(candidate.fen, 11);
        const after = await engine.analyze(candidate.playedFen, 11);
        analyzed += 1;
        if (!before.bestmove || before.bestmove === "(none)" || before.bestSan === candidate.played) continue;
        const loss = before.scoreCp === null || after.scoreCp === null ? 0 : Math.round((before.scoreCp + after.scoreCp));
        if (loss < 120) continue;
        puzzleQueue.push({
          id: candidate.fen + "|" + before.bestmove,
          fen: candidate.fen,
          expectedUci: before.bestmove,
          expectedSan: before.bestSan,
          playedSan: candidate.played,
          lossCp: loss,
          color: candidate.color,
          pv: before.pvSan,
        });
      }
      puzzleQueue.sort((a, b) => b.lossCp - a.lossCp);
      message("#tactics-status", `${analyzed} posizioni analizzate · ${puzzleQueue.length} candidati tattici trovati. La stima è una selezione preliminare, non un'etichetta di blunder certificata.`);
      loadNextTactic();
    } catch (error) { message("#tactics-status", "Analisi tattica interrotta: " + error.message); }
    finally { tacticsLoading = false; setButtonBusy(button, false); }
  }

  function loadNextTactic() {
    currentPuzzle = puzzleQueue.shift() || null;
    if (!currentPuzzle) {
      tacticsGame = null;
      if (tacticsBoard) tacticsBoard.render();
      message("#tactics-prompt", "Non ci sono altri candidati. Importa altre partite o ripeti l'analisi a una profondità maggiore.");
      message("#tactics-answer", "");
      return;
    }
    tacticsGame = new Chess(currentPuzzle.fen);
    tacticsBoard.render();
    message("#tactics-prompt", `Tocca al ${currentPuzzle.color === "w" ? "Bianco" : "Nero"}. Trova la mossa più forte da questa posizione.`);
    message("#tactics-answer", "Candidata differenza valutativa: " + (currentPuzzle.lossCp / 100).toFixed(2) + " pedoni. La tua mossa originale era " + currentPuzzle.playedSan + ".");
  }
  function onTacticMove(chess) {
    if (!currentPuzzle) return;
    const lastMove = chess.history({ verbose: true }).at(-1);
    const uci = lastMove.from + lastMove.to + (lastMove.promotion || "");
    if (uci !== currentPuzzle.expectedUci) {
      chess.undo();
      tacticsBoard.render();
      message("#tactics-answer", "Non è la migliore mossa candidata. Soluzione: " + currentPuzzle.expectedSan + " · linea: " + currentPuzzle.pv.join(" "));
      return;
    }
    message("#tactics-answer", "Corretto: " + currentPuzzle.expectedSan + ". " + currentPuzzle.pv.join(" "));
    loadNextTactic();
  }

  function endgameMoveChanged(chess) {
    message("#endgame-status", `Mossa: ${chess.history().at(-1)} · ${chess.isGameOver() ? "Partita terminata." : (chess.turn() === "w" ? "Bianco" : "Nero") + " al tratto."}`);
  }

  function initialize() {
    const category = $("#endgame-category");
    if (category) {
      category.replaceChildren();
      for (const section of ENDGAME_CATALOG) {
        const option = document.createElement("option");
        option.value = section.id;
        option.textContent = section.category + " · " + section.lessons.length;
        category.append(option);
      }
      category.addEventListener("change", populateEndgameTopics);
    }
    $("#endgame-topic")?.addEventListener("change", () => { renderEndgameLesson(); loadEndgamePosition(); });
    $("#endgame-load")?.addEventListener("click", loadEndgamePosition);
    endgameBoard = createBoardController($("#endgame-board"), () => endgameGame, endgameMoveChanged);
    sparringBoard = createBoardController($("#sparring-board"), () => sparringGame, onSparringMove, () => !sparringBusy && sparringGame.turn() === sparringColor);
    tacticsBoard = createBoardController($("#tactics-board"), () => tacticsGame || new Chess(), onTacticMove);
    populateEndgameTopics();
    $("#endgame-analyze")?.addEventListener("click", analyzeEndgame);
    $("#endgame-engine-move")?.addEventListener("click", engineEndgameMove);
    $("#endgame-tablebase")?.addEventListener("click", probeEndgameTablebase);
    $("#endgame-mastered")?.addEventListener("click", markEndgameMastered);
    $("#sparring-start")?.addEventListener("click", startSparring);
    $("#account-import")?.addEventListener("click", importAccountGames);
    $("#opening-analyze")?.addEventListener("click", analyzeOpenings);
    $("#generator-build")?.addEventListener("click", generateRepertoire);
    $("#analyze-current")?.addEventListener("click", analyzeCurrentPosition);
    $("#tactics-create")?.addEventListener("click", createTacticalPuzzles);
    $("#tactics-next")?.addEventListener("click", loadNextTactic);
    $("#annotation-save")?.addEventListener("click", saveAnnotation);
    refreshAnnotation();
    updateEndgameSummary();
    if (importedPgn) {
      fillPgnFields(importedPgn);
      message("#account-import-status", `Archivio PGN locale caricato: ${splitPgnGames(importedPgn).length} partite.`);
    }
  }
  initialize();

  return {
    refresh() { refreshAnnotation(); },
    refreshEndgame() { updateEndgameSummary(); },
    loadImportedPgn(pgn) { importedPgn = pgn; fillPgnFields(pgn); persistGames(pgn); },
    getCurrentEndgameLesson() { return endgameLesson; },
    loadEndgameProgress(progress) {
      if (progress && typeof progress === "object" && !Array.isArray(progress)) {
        endgameCards = progress;
        saveEndgameProgress();
        renderEndgameLesson();
      }
    },
  };
}
