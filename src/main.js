import { Chess } from "chess.js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { RepertoireTree } from "./repertoire-tree.js";
import { formatUciScore, parseUciInfo, uciPvToSan } from "./engine-uci.js";
import { initChessLab } from "./chess-lab.js";
import { parsePgnCollection } from "./pgn-import.js";
import "./style.css";

const STORAGE_KEY = "chess-os.repertoire.v1";
const DEFAULT_FEN = new Chess().fen();
const files = "abcdefgh";
const symbols = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟︎" },
};
const promotionNames = { q: "Donna", r: "Torre", b: "Alfiere", n: "Cavallo" };

let game = new Chess();
let mode = "studio";
let selectedSquare = null;
let boardFlipped = false;
let pendingPromotion = null;
const persistenceMode = isTauri() ? "sqlite" : "browser";
let databaseReady = persistenceMode === "browser";
let repertoire = persistenceMode === "browser" ? readRepertoire() : [];
let activeLineId = null;
let dirty = false;
let trainingGame = null;
let trainingMoves = [];
let trainingIndex = 0;
let trainingStartFen = DEFAULT_FEN;
let baseFen = DEFAULT_FEN;
let studioStates = [DEFAULT_FEN];
let studioSans = [];
let studioMoveObjects = [];
let studioPly = 0;
let studioTree = new RepertoireTree(DEFAULT_FEN);
let studioPath = [];
let toastTimer = null;
const desktopApp = isTauri();
let engineStarted = false;
let engineStarting = false;
let engineSearching = false;
let engineShuttingDown = false;
let engineRequestId = 0;
let engineFen = "";
let engineSideToMove = "w";
const engineRows = new Map();
let engineEventsError = null;
let chessLab = null;

const $ = (selector) => document.querySelector(selector);
const boardElement = $("#chessboard");
const titleInput = $("#line-title");
const moveListElement = $("#move-list");
const promotionDialog = $("#promotion-dialog");
const promotionOptions = $("#promotion-options");

const engineEventsReady = desktopApp
  ? Promise.all([
      listen("stockfish://line", (event) => handleStockfishLine(event.payload)),
      listen("stockfish://exit", (event) => handleStockfishExit(event.payload)),
    ]).then((unlisten) => unlisten).catch((error) => {
      engineEventsError = error;
    })
  : Promise.resolve([]);

function readRepertoire() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.id === "string" && typeof item.pgn === "string")
      : [];
  } catch {
    return [];
  }
}

function persistRepertoire() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(repertoire));
    return true;
  } catch {
    showToast("Non riesco a salvare: memoria locale non disponibile.");
    return false;
  }
}

function updateStorageLabel(title, description) {
  const titleElement = $("#storage-title");
  const descriptionElement = $("#storage-description");
  if (titleElement) titleElement.textContent = title;
  if (descriptionElement) descriptionElement.textContent = description;
}

function repertoirePayload(entry, tree) {
  return {
    id: entry.id,
    title: entry.title,
    pgn: entry.pgn,
    sans: entry.sans || [],
    createdAt: entry.createdAt || null,
    updatedAt: entry.updatedAt || null,
    tree: tree.toJSON(),
  };
}

async function initializePersistence() {
  if (persistenceMode !== "sqlite") {
    updateStorageLabel("Anteprima browser", "In questa modalità i dati sono salvati nella memoria del browser.");
    renderAll();
    return;
  }

  updateStorageLabel("Database SQLite", "Archivio locale dell’applicazione · inizializzazione…");
  try {
    let records = await invoke("list_repertoires");
    const legacyEntries = readRepertoire();
    const existingIds = new Set(records.map((record) => record.id));
    const migrationErrors = [];

    for (const entry of legacyEntries) {
      if (existingIds.has(entry.id)) continue;
      try {
        const tree = entry.tree
          ? RepertoireTree.fromJSON(entry.tree)
          : RepertoireTree.fromPgn(entry.pgn);
        await invoke("save_repertoire", {
          input: repertoirePayload({
            ...entry,
            pgn: entry.pgn || tree.toPgn({ Event: entry.title || "Chess OS repertoire" }),
            sans: entry.sans || tree.mainlinePath().map((edgeId) => tree.getEdge(edgeId).san),
          }, tree),
        });
        existingIds.add(entry.id);
      } catch (error) {
        migrationErrors.push((entry.title || entry.id) + ": " + error.message);
      }
    }

    records = await invoke("list_repertoires");
    repertoire = records;
    databaseReady = true;
    if (migrationErrors.length === 0) {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* Non bloccare l'avvio per storage non disponibile. */ }
      updateStorageLabel("Database SQLite", "Dati salvati sul dispositivo · " + records.length + " repertori");
    } else {
      updateStorageLabel("SQLite · migrazione parziale", "Alcune vecchie linee non sono state importate: " + migrationErrors.length);
      showToast("SQLite attivo, ma alcune vecchie linee non sono state migrate. Esporta i PGN per sicurezza.");
    }
    renderAll();
  } catch (error) {
    databaseReady = false;
    updateStorageLabel("SQLite non disponibile", "Salvataggio temporaneamente disattivato · controlla il database");
    renderAll();
    showToast("Errore database SQLite: " + error.message);
  }
}

function activeGame() {
  return mode === "training" && trainingGame ? trainingGame : game;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function setEngineStatus(message, state = "normal") {
  const element = $("#engine-status");
  if (!element) return;
  element.textContent = message;
  element.className = "engine-status" + (state === "normal" ? "" : " " + state);
}

function updateEngineControls() {
  const supported = desktopApp;
  $("#engine-start").disabled = !supported || engineStarted || engineStarting;
  $("#engine-analyze").disabled = !supported || !engineStarted || engineStarting;
  $("#engine-stop").disabled = !supported || !engineStarted || !engineSearching;
  $("#engine-shutdown").disabled = !supported || !engineStarted || engineStarting || engineShuttingDown;
}

function renderEngineResults() {
  const container = $("#engine-results");
  if (!container) return;
  container.replaceChildren();
  if (!engineRows.size) {
    const empty = document.createElement("span");
    empty.className = "empty-state";
    empty.textContent = "In attesa delle prime linee di analisi…";
    container.append(empty);
    return;
  }

  for (const [rank, info] of [...engineRows.entries()].sort((a, b) => a[0] - b[0])) {
    const row = document.createElement("div");
    row.className = "engine-line";
    const number = document.createElement("span");
    number.className = "engine-line-rank";
    number.textContent = "LINEA " + rank;
    const score = document.createElement("span");
    score.className = "engine-line-score";
    score.textContent = formatUciScore(info, engineSideToMove);
    const depth = document.createElement("small");
    depth.className = "engine-line-depth";
    depth.textContent = "DEPTH " + info.depth;
    score.append(depth);
    const pv = document.createElement("span");
    pv.className = "engine-line-pv";
    pv.textContent = uciPvToSan(engineFen, info.pv) || "—";
    row.append(number, score, pv);
    container.append(row);
  }
}

function handleStockfishLine(payload) {
  if (!payload || typeof payload.line !== "string") return;
  const requestId = Number(payload.requestId ?? payload.request_id ?? 0);
  if (payload.line.startsWith("info ") && requestId === engineRequestId) {
    const info = parseUciInfo(payload.line);
    if (info && info.multipv >= 1 && info.multipv <= 5) {
      engineRows.set(info.multipv, info);
      renderEngineResults();
    }
  } else if (payload.line.startsWith("bestmove ") && requestId === engineRequestId) {
    engineSearching = false;
    updateEngineControls();
    setEngineStatus(payload.line.includes("(none)") ? "Analisi completata · nessuna mossa legale" : "Analisi completata", "ready");
  }
}

function handleStockfishExit(payload) {
  engineStarted = false;
  engineStarting = false;
  engineSearching = false;
  updateEngineControls();
  if (engineShuttingDown) return;
  setEngineStatus(payload?.reason || "Stockfish si è arrestato inaspettatamente.", "error");
}

async function startStockfish() {
  if (!desktopApp) {
    setEngineStatus("Stockfish è disponibile nell'app desktop Windows, non nell'anteprima browser.", "error");
    return false;
  }
  if (engineStarted) return true;
  engineStarting = true;
  updateEngineControls();
  setEngineStatus("Avvio Stockfish 19…", "running");
  try {
    await engineEventsReady;
    if (engineEventsError) throw engineEventsError;
    await invoke("stockfish_start");
    engineStarted = true;
    setEngineStatus("Stockfish 19 pronto", "ready");
    updateEngineControls();
    return true;
  } catch (error) {
    engineStarted = false;
    setEngineStatus("Avvio non riuscito: " + error.message, "error");
    showToast("Stockfish non disponibile: " + error.message);
    updateEngineControls();
    return false;
  } finally {
    engineStarting = false;
    updateEngineControls();
  }
}

async function analyzeCurrentPosition() {
  if (!(await startStockfish())) return;
  const chess = activeGame();
  engineRequestId += 1;
  engineFen = chess.fen();
  engineSideToMove = chess.turn();
  engineRows.clear();
  renderEngineResults();
  const depth = Number($("#engine-depth").value) || 16;
  const multiPv = Number($("#engine-multipv").value) || 1;
  engineSearching = true;
  setEngineStatus("Analisi in corso…", "running");
  updateEngineControls();
  try {
    await invoke("stockfish_analyze", {
      fen: engineFen,
      depth,
      multiPv,
      requestId: engineRequestId,
    });
  } catch (error) {
    engineSearching = false;
    setEngineStatus("Errore di analisi: " + error.message, "error");
    showToast("Analisi Stockfish non riuscita: " + error.message);
    updateEngineControls();
  }
}

async function stopStockfishAnalysis() {
  if (!engineStarted || !engineSearching) return;
  try {
    await invoke("stockfish_stop_analysis");
    engineSearching = false;
    setEngineStatus("Analisi interrotta", "ready");
  } catch (error) {
    engineSearching = false;
    setEngineStatus("Errore arresto analisi: " + error.message, "error");
    showToast(error.message);
  } finally {
    updateEngineControls();
  }
}

async function shutdownStockfish() {
  if (!engineStarted || engineShuttingDown) return;
  engineShuttingDown = true;
  try {
    if (engineSearching) await stopStockfishAnalysis();
    await invoke("stockfish_shutdown");
    engineStarted = false;
    engineSearching = false;
    engineRows.clear();
    renderEngineResults();
    setEngineStatus("Motore spento", "normal");
  } catch (error) {
    setEngineStatus("Errore chiusura motore: " + error.message, "error");
    showToast("Chiusura Stockfish non riuscita: " + error.message);
  } finally {
    engineShuttingDown = false;
    updateEngineControls();
  }
}

function stopAnalysisForChangedPosition() {
  if (!engineSearching || !engineFen || engineFen === activeGame().fen()) return;
  engineSearching = false;
  engineRows.clear();
  renderEngineResults();
  setEngineStatus("Analisi interrotta · posizione cambiata", "ready");
  invoke("stockfish_stop_analysis").catch((error) => {
    setEngineStatus("Errore arresto analisi: " + error.message, "error");
  });
  updateEngineControls();
}

function setDirty(value = true) {
  dirty = value;
  const indicator = $("#saved-indicator");
  indicator.textContent = dirty ? "MODIFICHE NON SALVATE" : "SALVATA";
  indicator.classList.toggle("unsaved", dirty);
}

function confirmDiscardChanges(action) {
  if (!dirty) return true;
  return window.confirm("Ci sono modifiche non salvate. Vuoi eliminarle e " + action + "?");
}

function gameStatus(chess) {
  if (chess.isCheckmate()) return "Scacco matto · vince il " + (chess.turn() === "w" ? "Nero" : "Bianco");
  if (chess.isStalemate()) return "Stallo · patta";
  if (chess.isThreefoldRepetition()) return "Patta · triplice ripetizione";
  if (chess.isInsufficientMaterial()) return "Patta · materiale insufficiente";
  if (chess.isDraw()) return "Patta";
  if (chess.isCheck()) return "Scacco al " + (chess.turn() === "w" ? "Bianco" : "Nero");
  return (chess.turn() === "w" ? "Bianco" : "Nero") + " al tratto";
}

function syncStudioPath(path, cursor = path.length) {
  const snapshot = studioTree.replayPath(path);
  studioPath = [...path];
  studioStates = snapshot.states;
  studioMoveObjects = snapshot.moves;
  studioSans = snapshot.moves.map((move) => move.san);
  studioPly = Math.max(0, Math.min(cursor, studioMoveObjects.length));
  game = new Chess(studioStates[studioPly]);
}

function positionForPly(ply) {
  if (!Number.isInteger(ply) || ply < 0 || ply >= studioStates.length) return;
  try {
    game.load(studioStates[ply]);
  } catch {
    showToast("Non riesco a ripristinare questa posizione.");
    return;
  }
  studioPly = ply;
  selectedSquare = null;
  closePromotionChooser();
  renderAll();
}

function rebuildTimeline(loadedTree) {
  studioTree = loadedTree;
  baseFen = loadedTree.rootFen;
  syncStudioPath(loadedTree.mainlinePath());
  selectedSquare = null;
  pendingPromotion = null;
}

function timelinePgn() {
  return studioTree.toPgn({ Event: titleInput.value.trim() || "Chess OS repertoire" });
}

function appendStudioMove(move) {
  const fromNodeId = studioTree.nodeAtPath(studioPath, studioPly);
  const edge = studioTree.addMove(fromNodeId, move, game.fen());
  const prefix = studioPath.slice(0, studioPly);
  syncStudioPath([...prefix, edge.id]);
}

function currentLastMove() {
  if (mode === "training") return trainingMoves[trainingIndex - 1] || null;
  return studioMoveObjects[studioPly - 1] || null;
}

function updateBoardCoordinates() {
  const ranks = Array.from($(".rank-labels").children);
  const rankValues = boardFlipped ? ["1", "2", "3", "4", "5", "6", "7", "8"] : ["8", "7", "6", "5", "4", "3", "2", "1"];
  ranks.forEach((node, index) => { node.textContent = rankValues[index]; });
  const fileNodes = Array.from($(".file-labels").children);
  const fileValues = boardFlipped ? ["h", "g", "f", "e", "d", "c", "b", "a"] : ["a", "b", "c", "d", "e", "f", "g", "h"];
  fileNodes.forEach((node, index) => { node.textContent = fileValues[index]; });
}

function renderBoard() {
  const chess = activeGame();
  const board = chess.board();
  const legalTargets = new Set(
    selectedSquare
      ? chess.moves({ square: selectedSquare, verbose: true }).map((move) => move.to)
      : [],
  );
  const lastMove = currentLastMove();
  const lastSquares = new Set(lastMove ? [lastMove.from, lastMove.to] : []);
  let checkedKingSquare = null;

  if (chess.isCheck()) {
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = board[row][col];
        if (piece && piece.type === "k" && piece.color === chess.turn()) {
          checkedKingSquare = files[col] + String(8 - row);
        }
      }
    }
  }

  boardElement.replaceChildren();
  for (let displayRow = 0; displayRow < 8; displayRow += 1) {
    for (let displayCol = 0; displayCol < 8; displayCol += 1) {
      const rowIndex = boardFlipped ? 7 - displayRow : displayRow;
      const colIndex = boardFlipped ? 7 - displayCol : displayCol;
      const piece = board[rowIndex][colIndex];
      const square = files[colIndex] + String(8 - rowIndex);
      const button = document.createElement("button");
      const isLight = (displayRow + displayCol) % 2 === 0;
      button.type = "button";
      button.dataset.square = square;
      button.className = "square " + (isLight ? "light" : "dark");
      if (selectedSquare === square) button.classList.add("selected");
      if (lastSquares.has(square)) button.classList.add("last-move");
      if (checkedKingSquare === square) button.classList.add("in-check");
      if (legalTargets.has(square)) button.classList.add(piece ? "capture-target" : "legal-target");

      if (piece) {
        const pieceSpan = document.createElement("span");
        pieceSpan.className = "piece " + (piece.color === "w" ? "white-piece" : "black-piece");
        pieceSpan.textContent = symbols[piece.color][piece.type];
        button.append(pieceSpan);
        button.setAttribute("aria-label", (piece.color === "w" ? "Bianco " : "Nero ") + piece.type + " in " + square);
      } else {
        button.setAttribute("aria-label", square);
      }
      boardElement.append(button);
    }
  }

  updateBoardCoordinates();
  $("#turn-label").textContent = (chess.turn() === "w" ? "Bianco" : "Nero") + " al tratto";
  $("#game-status").textContent = gameStatus(chess);
  const currentCount = mode === "training" ? trainingIndex : studioPly;
  const totalCount = mode === "training" ? trainingMoves.length : studioSans.length;
  $("#move-count").textContent = currentCount + " / " + totalCount + " semimosse";
  $("#line-move-count").textContent = mode === "training"
    ? trainingIndex + " / " + trainingMoves.length + " mosse eseguite"
    : studioPly + " / " + studioSans.length + " semimosse · posizione " + (studioPly + 1);
  $("#board-label").textContent = mode === "training" ? "MODALITÀ ALLENAMENTO" : "PARTITA / ANALISI";
  $("#undo").disabled = mode === "training" || studioPly === 0;
  $("#redo").disabled = mode === "training" || studioPly >= studioSans.length;
  $("#flip-board").textContent = boardFlipped ? "Vista Bianco" : "Vista Nero";
}

function renderMoves() {
  const moves = mode === "training" ? trainingMoves : studioMoveObjects;
  const cursor = mode === "training" ? trainingIndex : studioPly;
  moveListElement.replaceChildren();

  if (!moves.length) {
    const empty = document.createElement("span");
    empty.className = "empty-state";
    empty.textContent = "Le mosse appariranno qui.";
    moveListElement.append(empty);
    return;
  }

  for (let index = 0; index < moves.length; index += 2) {
    const row = document.createElement("div");
    row.className = "move-row";
    const number = document.createElement("span");
    number.className = "move-number";
    number.textContent = Math.floor(index / 2) + 1 + ".";
    row.append(number);

    for (let offset = 0; offset < 2 && index + offset < moves.length; offset += 1) {
      const moveIndex = index + offset;
      const san = document.createElement("button");
      san.type = "button";
      san.className = "san-move";
      san.textContent = moves[moveIndex].san;
      san.disabled = mode === "training";
      if (moveIndex < cursor) san.classList.add("played");
      if (moveIndex === cursor - 1) san.classList.add("current-move");
      if (mode === "studio") {
        const ply = moveIndex + 1;
        san.setAttribute("aria-label", "Vai alla posizione dopo " + san.textContent);
        san.setAttribute("aria-pressed", String(ply === studioPly));
        san.addEventListener("click", () => positionForPly(ply));
      }
      row.append(san);
    }
    moveListElement.append(row);
  }
}

function renderRepertoire() {
  const list = $("#repertoire-list");
  list.replaceChildren();

  if (!repertoire.length) {
    const empty = document.createElement("div");
    empty.className = "repertoire-empty";
    empty.textContent = "Nessuna linea salvata. Crea una linea e premi “Salva linea”.";
    list.append(empty);
    return;
  }

  for (const line of repertoire) {
    const row = document.createElement("div");
    row.className = "repertoire-entry";
    if (line.id === activeLineId) row.classList.add("current");

    const open = document.createElement("button");
    open.type = "button";
    open.className = "repertoire-open";
    const name = document.createElement("span");
    name.className = "repertoire-name";
    name.textContent = line.title || "Linea senza nome";
    const meta = document.createElement("small");
    const count = Number.isInteger(line.edgeCount)
      ? line.edgeCount
      : (Array.isArray(line.sans) ? line.sans.length : 0);
    meta.textContent = count + " " + (count === 1 ? "arco" : "archi") + (line.nodeCount ? " · " + line.nodeCount + " posizioni" : "");
    open.append(name, meta);
    open.addEventListener("click", () => openLine(line.id));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-line";
    remove.textContent = "×";
    remove.title = "Elimina linea";
    remove.setAttribute("aria-label", "Elimina " + (line.title || "linea"));
    remove.addEventListener("click", () => deleteLine(line.id));

    row.append(open, remove);
    list.append(row);
  }
}

function renderMode() {
  const training = mode === "training";
  $("#nav-studio").classList.toggle("active", !training);
  $("#nav-training").classList.toggle("active", training);
  $("#mode-eyebrow").textContent = training ? "REPERTORIO / RIPASSO" : "REPERTORIO / ANALISI";
  $("#page-title").textContent = training ? "Allenamento" : "Chess Studio";
  $("#page-subtitle").textContent = training
    ? "Ripeti la linea e trova le mosse nell’ordine corretto."
    : "Costruisci le tue linee, una mossa alla volta.";
  $("#save-line").disabled = training || !databaseReady;
  $("#reset").textContent = training ? "Esci dal ripasso" : "Nuova posizione";
  $("#page-subtitle").textContent = training
    ? "Ripeti la linea selezionata e trova le mosse nell’ordine corretto."
    : "Costruisci linee principali, varianti e transposizioni.";
  $("#flip-board").disabled = false;
}

function renderVariations() {
  const list = $("#variation-list");
  if (!list) return;
  list.replaceChildren();
  if (mode === "training") {
    const note = document.createElement("span");
    note.className = "empty-state";
    note.textContent = "Le varianti sono disponibili in Studio.";
    list.append(note);
    return;
  }

  let nodeId;
  try {
    nodeId = studioTree.nodeAtPath(studioPath, studioPly);
  } catch {
    nodeId = studioTree.rootId;
  }
  const options = studioTree.getOutgoing(nodeId);
  if (!options.length) {
    const empty = document.createElement("span");
    empty.className = "empty-state";
    empty.textContent = "Nessuna continuazione da questa posizione.";
    list.append(empty);
    return;
  }

  options.forEach((edge, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "variation-choice";
    const isSelected = studioPath[studioPly] === edge.id;
    if (isSelected) button.classList.add("selected");
    const title = document.createElement("strong");
    title.textContent = edge.san;
    const meta = document.createElement("small");
    const incomingCount = studioTree.getIncoming(edge.to).length;
    const labels = [];
    labels.push(index === 0 ? "linea principale" : "variante");
    if (incomingCount > 1) labels.push("transposizione");
    meta.textContent = labels.join(" · ");
    button.append(title, meta);
    button.setAttribute("aria-pressed", String(isSelected));
    button.addEventListener("click", () => selectVariation(edge.id));
    list.append(button);
  });
}

function selectVariation(edgeId) {
  const edge = studioTree.getEdge(edgeId);
  if (!edge) return;
  const prefix = studioPath.slice(0, studioPly);
  const path = [...prefix, edge.id, ...studioTree.preferredPathFrom(edge.to)];
  try {
    syncStudioPath(path);
    selectedSquare = null;
    closePromotionChooser();
    renderAll();
    showToast("Variante selezionata.");
  } catch (error) {
    showToast("Impossibile aprire la variante: " + error.message);
  }
}

function renderAll() {
  stopAnalysisForChangedPosition();
  renderBoard();
  renderMoves();
  renderVariations();
  renderRepertoire();
  renderMode();
  chessLab?.onPositionChanged();
}

function closePromotionChooser() {
  pendingPromotion = null;
  promotionDialog.hidden = true;
  promotionOptions.replaceChildren();
}

function openPromotionChooser(from, to, legalMoves) {
  const chess = activeGame();
  pendingPromotion = { from, to, legalMoves };
  promotionOptions.replaceChildren();
  const color = chess.turn();

  for (const type of ["q", "r", "b", "n"]) {
    const choice = legalMoves.find((move) => move.promotion === type);
    if (!choice) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "promotion-choice";
    button.setAttribute("aria-label", "Promuovi a " + promotionNames[type]);
    const piece = document.createElement("span");
    piece.className = "piece " + (color === "w" ? "white-piece" : "black-piece");
    piece.textContent = symbols[color][type];
    const label = document.createElement("small");
    label.textContent = promotionNames[type];
    button.append(piece, label);
    button.addEventListener("click", () => {
      const selectedMove = pendingPromotion?.legalMoves.find((move) => move.promotion === type);
      closePromotionChooser();
      if (selectedMove) commitSelectedMove(selectedMove);
    });
    promotionOptions.append(button);
  }

  promotionDialog.hidden = false;
  const firstChoice = promotionOptions.querySelector("button");
  firstChoice?.focus();
}

function commitSelectedMove(selectedMove) {
  if (mode === "training") {
    const expected = trainingMoves[trainingIndex];
    if (!expected) return;
    let played;
    try {
      played = trainingGame.move({
        from: selectedMove.from,
        to: selectedMove.to,
        ...(selectedMove.promotion ? { promotion: selectedMove.promotion } : {}),
      });
    } catch {
      played = null;
    }

    if (!played) {
      selectedSquare = null;
      renderBoard();
      showToast("Mossa non legale.");
      return;
    }

    const correct = played.from === expected.from
      && played.to === expected.to
      && (played.promotion || undefined) === (expected.promotion || undefined);
    if (!correct) {
      trainingGame.undo();
      selectedSquare = null;
      renderBoard();
      showToast("Non è la mossa della linea. Riprova.");
      return;
    }

    trainingIndex += 1;
    selectedSquare = null;
    renderAll();
    showToast(trainingIndex === trainingMoves.length ? "Linea completata. Ottimo lavoro!" : "Mossa corretta.");
    return;
  }

  if (game.isGameOver()) {
    showToast(gameStatus(game));
    return;
  }

  let played;
  try {
    played = game.move({
      from: selectedMove.from,
      to: selectedMove.to,
      ...(selectedMove.promotion ? { promotion: selectedMove.promotion } : {}),
    });
  } catch {
    played = null;
  }
  selectedSquare = null;
  if (!played) {
    renderBoard();
    showToast("Mossa non legale.");
    return;
  }

  appendStudioMove(played);
  setDirty(true);
  renderAll();
}

function handleSquareClick(square) {
  const chess = activeGame();
  if (pendingPromotion) return;
  if (chessLab && !chessLab.canHumanMove()) {
    showToast("Attendi la mossa di Stockfish.");
    return;
  }
  if (chess.isGameOver()) {
    showToast(gameStatus(chess));
    return;
  }
  const piece = chess.get(square);

  if (!selectedSquare) {
    if (piece && piece.color === chess.turn()) {
      selectedSquare = square;
      renderBoard();
    }
    return;
  }

  if (selectedSquare === square) {
    selectedSquare = null;
    renderBoard();
    return;
  }

  if (piece && piece.color === chess.turn()) {
    selectedSquare = square;
    renderBoard();
    return;
  }

  const choices = chess.moves({ square: selectedSquare, verbose: true })
    .filter((move) => move.to === square);
  if (!choices.length) {
    selectedSquare = null;
    renderBoard();
    showToast("Mossa non legale.");
    return;
  }

  const promotions = choices.filter((move) => Boolean(move.promotion));
  if (promotions.length) {
    openPromotionChooser(selectedSquare, square, promotions);
    return;
  }

  commitSelectedMove(choices[0]);
}

function openLine(id) {
  const line = repertoire.find((item) => item.id === id);
  if (!line || !confirmDiscardChanges("aprire un'altra linea")) return;
  chessLab?.stopPlay();
  try {
    const loaded = line.tree ? RepertoireTree.fromJSON(line.tree) : RepertoireTree.fromPgn(line.pgn);
    rebuildTimeline(loaded);
    activeLineId = line.id;
    titleInput.value = line.title || "Linea senza nome";
    setDirty(false);
    mode = "studio";
    trainingGame = null;
    closePromotionChooser();
    renderAll();
  } catch (error) {
    showToast("PGN non leggibile: " + error.message);
  }
}

async function deleteLine(id) {
  const line = repertoire.find((item) => item.id === id);
  if (!line) return;
  const accepted = window.confirm("Eliminare “" + (line.title || "Linea senza nome") + "” dal repertorio?");
  if (!accepted) return;
  if (!databaseReady) {
    showToast("Database non pronto: eliminazione non eseguita.");
    return;
  }
  try {
    if (persistenceMode === "sqlite") {
      await invoke("delete_repertoire", { id });
    } else {
      const next = repertoire.filter((item) => item.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
    repertoire = repertoire.filter((item) => item.id !== id);
    if (activeLineId === id) {
      activeLineId = null;
      setDirty(true);
    }
    renderAll();
    showToast("Linea eliminata.");
  } catch (error) {
    showToast("Errore eliminazione: " + error.message);
  }
}

async function saveLine() {
  if (mode === "training") return;
  if (!databaseReady) {
    showToast("Database non pronto: il salvataggio è disattivato.");
    return;
  }
  if (!studioTree.edges.size) {
    showToast("Aggiungi almeno una mossa prima di salvare.");
    return;
  }

  const pgn = timelinePgn();
  const sans = [...studioSans];
  const title = titleInput.value.trim() || "Linea senza nome";
  const id = activeLineId || (globalThis.crypto?.randomUUID?.() ?? "line-" + Date.now());
  const previous = repertoire.find((item) => item.id === id);
  const entry = {
    id,
    title,
    pgn,
    sans,
    edgeCount: studioTree.edges.size,
    nodeCount: studioTree.nodes.size,
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tree: studioTree.toJSON(),
  };

  try {
    if (persistenceMode === "sqlite") {
      const saved = await invoke("save_repertoire", { input: repertoirePayload(entry, studioTree) });
      const next = repertoire.filter((item) => item.id !== id);
      repertoire = [saved, ...next];
    } else {
      const next = repertoire.filter((item) => item.id !== id);
      repertoire = [entry, ...next];
      if (!persistRepertoire()) return;
    }
    activeLineId = id;
    setDirty(false);
    renderAll();
    showToast("Linea salvata nel database.");
  } catch (error) {
    showToast("Errore salvataggio SQLite: " + error.message);
  }
}

function openGeneratedPuzzle(fen, solutionUci) {
  if (!confirmDiscardChanges("aprire il puzzle generato")) return false;
  const puzzle = new Chess(fen);
  const expected = puzzle.moves({ verbose: true }).find((move) =>
    move.from + move.to + (move.promotion || "") === solutionUci
  );
  if (!expected) return false;

  chessLab?.stopPlay();
  trainingStartFen = fen;
  trainingGame = new Chess(fen);
  trainingMoves = [{
    from: expected.from,
    to: expected.to,
    san: expected.san,
    ...(expected.promotion ? { promotion: expected.promotion } : {}),
  }];
  trainingIndex = 0;
  selectedSquare = null;
  mode = "training";
  closePromotionChooser();
  renderAll();
  showToast("Puzzle generato: trova la mossa che evita l'errore.");
  return true;
}

function startTraining() {
  chessLab?.stopPlay();
  trainingMoves = studioMoveObjects.map((move) => ({
    from: move.from,
    to: move.to,
    san: move.san,
    ...(move.promotion ? { promotion: move.promotion } : {}),
  }));
  if (!trainingMoves.length) {
    showToast("Seleziona una linea con almeno una mossa per allenarti.");
    return;
  }
  trainingStartFen = baseFen;
  trainingGame = new Chess(trainingStartFen);
  trainingIndex = 0;
  selectedSquare = null;
  mode = "training";
  closePromotionChooser();
  renderAll();
  showToast("Ripasso avviato: trova la prima mossa.");
}

function leaveTraining() {
  mode = "studio";
  trainingGame = null;
  trainingMoves = [];
  trainingIndex = 0;
  selectedSquare = null;
  closePromotionChooser();
  renderAll();
}

function importedGameFingerprint(tree) {
  const headers = tree.headers || {};
  const players = [headers.White || "", headers.Black || ""].map((value) => String(value).trim().toLowerCase());
  const date = String(headers.Date || "").trim();
  const site = String(headers.Site || "").trim().toLowerCase();
  const moves = tree.mainlinePath().map((edgeId) => tree.getEdge(edgeId).uci).join(" ");
  return [date, players.join("|"), site, moves].join("::");
}

async function saveImportedGames(games) {
  if (!databaseReady) return { saved: 0, skipped: 0, errors: [{ index: 0, message: "Database non pronto." }] };
  if (!confirmDiscardChanges("importare le partite selezionate")) {
    return { saved: 0, skipped: 0, errors: [{ index: 0, message: "Importazione annullata: modifiche non salvate." }] };
  }

  const knownGames = new Set();
  for (const line of repertoire) {
    try {
      const tree = line.tree ? RepertoireTree.fromJSON(line.tree) : RepertoireTree.fromPgn(line.pgn);
      knownGames.add(importedGameFingerprint(tree));
    } catch {
      // Una linea storica non valida non deve bloccare l'importazione dell'archivio.
    }
  }
  const savedEntries = [];
  const errors = [];
  let skipped = 0;
  for (const [offset, item] of games.entries()) {
    try {
      const tree = item.tree;
      const fingerprint = importedGameFingerprint(tree);
      if (knownGames.has(fingerprint)) {
        skipped += 1;
        continue;
      }
      knownGames.add(fingerprint);
      const now = new Date().toISOString();
      const title = String(item.title || "Partita importata " + (offset + 1)).trim().slice(0, 70);
      const entry = {
        id: globalThis.crypto?.randomUUID?.() ?? "game-" + Date.now() + "-" + offset,
        title,
        pgn: tree.toPgn({ Event: title }),
        sans: tree.mainlinePath().map((edgeId) => tree.getEdge(edgeId).san),
        edgeCount: tree.edges.size,
        nodeCount: tree.nodes.size,
        createdAt: now,
        updatedAt: now,
        tree: tree.toJSON(),
      };
      let saved;
      if (persistenceMode === "sqlite") {
        saved = await invoke("save_repertoire", { input: repertoirePayload(entry, tree) });
        repertoire = [saved, ...repertoire.filter((line) => line.id !== saved.id)];
      } else {
        saved = entry;
        const next = [saved, ...repertoire.filter((line) => line.id !== saved.id)];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        repertoire = next;
      }
      savedEntries.push(saved);
    } catch (error) {
      errors.push({ index: item.index || offset + 1, message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (savedEntries.length) {
    setDirty(false);
    openLine(savedEntries[0].id);
    renderAll();
  }
  return { saved: savedEntries.length, skipped, errors };
}

function importPgn() {
  const text = $("#pgn-input").value.trim();
  if (!text) {
    showToast("Incolla prima un testo PGN.");
    return;
  }
  try {
    const imported = RepertoireTree.fromPgn(text);
    if (!confirmDiscardChanges("importare questo PGN")) return;
    chessLab?.stopPlay();
    rebuildTimeline(imported);
    mode = "studio";
    activeLineId = null;
    titleInput.value = "PGN importato";
    setDirty(true);
    closePromotionChooser();
    renderAll();
    showToast("PGN importato: varianti e transposizioni acquisite.");
  } catch (error) {
    showToast("PGN non valido: " + error.message);
  }
}

function exportPgn() {
  const pgn = mode === "training" || !studioTree.edges.size ? "" : timelinePgn();
  if (!pgn) {
    showToast("Non ci sono mosse da esportare.");
    return;
  }
  const blob = new Blob([pgn + "\n"], { type: "application/x-chess-pgn;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = (titleInput.value.trim() || "chess-line").replace(/[^a-z0-9-_]+/gi, "-") + ".pgn";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("File PGN esportato.");
}

function newPosition() {
  if (mode === "training") {
    leaveTraining();
    return;
  }
  if (!confirmDiscardChanges("iniziare una nuova linea")) return;
  chessLab?.stopPlay();
  baseFen = DEFAULT_FEN;
  studioTree = new RepertoireTree(DEFAULT_FEN);
  syncStudioPath([]);
  studioPly = 0;
  activeLineId = null;
  selectedSquare = null;
  closePromotionChooser();
  titleInput.value = "Nuova linea";
  setDirty(true);
  renderAll();
}

async function copyFen() {
  const fen = activeGame().fen();
  try {
    await navigator.clipboard.writeText(fen);
    showToast("FEN copiata negli appunti.");
  } catch {
    showToast("Copia FEN non disponibile in questo contesto.");
  }
}

boardElement.addEventListener("click", (event) => {
  const squareButton = event.target.closest("button[data-square]");
  if (squareButton) handleSquareClick(squareButton.dataset.square);
});

$("#nav-studio").addEventListener("click", () => {
  if (mode === "training") leaveTraining();
});
$("#nav-training").addEventListener("click", () => startTraining());
$("#new-line").addEventListener("click", newPosition);
$("#reset").addEventListener("click", newPosition);
$("#undo").addEventListener("click", () => {
  if (mode === "studio" && studioPly > 0) positionForPly(studioPly - 1);
});
$("#redo").addEventListener("click", () => {
  if (mode === "studio" && studioPly < studioSans.length) positionForPly(studioPly + 1);
});
$("#flip-board").addEventListener("click", () => {
  boardFlipped = !boardFlipped;
  renderBoard();
});
$("#copy-fen").addEventListener("click", copyFen);
$("#save-line").addEventListener("click", saveLine);
$("#import-pgn").addEventListener("click", importPgn);
$("#export-pgn").addEventListener("click", exportPgn);
$("#promotion-cancel").addEventListener("click", () => {
  closePromotionChooser();
  selectedSquare = null;
  renderBoard();
});
promotionDialog.addEventListener("click", (event) => {
  if (event.target === promotionDialog) {
    closePromotionChooser();
    selectedSquare = null;
    renderBoard();
  }
});
titleInput.addEventListener("input", () => setDirty(true));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && pendingPromotion) {
    closePromotionChooser();
    selectedSquare = null;
    renderBoard();
    return;
  }
  if (mode !== "studio" || pendingPromotion) return;
  const target = event.target;
  if (target instanceof HTMLElement && (
    target.isContentEditable
    || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
    || (target.tagName === "BUTTON" && !target.matches(".square, .san-move"))
  )) return;
  if (event.key === "ArrowLeft" && studioPly > 0) {
    event.preventDefault();
    positionForPly(studioPly - 1);
  } else if (event.key === "ArrowRight" && studioPly < studioSans.length) {
    event.preventDefault();
    positionForPly(studioPly + 1);
  }
});

renderAll();
if (!desktopApp) {
  setEngineStatus("Disponibile nell'app desktop Windows, non nell'anteprima browser.", "error");
}
renderEngineResults();
updateEngineControls();
$("#engine-start").addEventListener("click", () => { void startStockfish(); });
$("#engine-analyze").addEventListener("click", () => { void analyzeCurrentPosition(); });
$("#engine-stop").addEventListener("click", () => { void stopStockfishAnalysis(); });
$("#engine-shutdown").addEventListener("click", () => { void shutdownStockfish(); });
chessLab = initChessLab({
  container: document.querySelector(".details-panel"),
  desktopApp,
  getGame: () => activeGame(),
  getMode: () => mode,
  getPositions: () => [...studioStates],
  getMoves: () => [...studioMoveObjects],
  startEngine: startStockfish,
  playUciMove: (uci) => {
    if (mode !== "studio" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return false;
    const move = game.moves({ verbose: true }).find((candidate) =>
      candidate.from === uci.slice(0, 2)
      && candidate.to === uci.slice(2, 4)
      && (candidate.promotion || "") === (uci[4] || "")
    );
    if (!move) return false;
    commitSelectedMove(move);
    return true;
  },
  importGames: saveImportedGames,
  getArchive: () => [...repertoire],
  getPlayerNames: () => {
    try {
      const profiles = JSON.parse(localStorage.getItem("chess-os.connected-accounts.v1") || "{}");
      return [profiles.chesscom, profiles.lichess].filter((name) => typeof name === "string" && name.trim());
    } catch {
      return [];
    }
  },
  openPuzzle: openGeneratedPuzzle,
  openArchiveGame: (id) => openLine(id),
});
void initializePersistence();