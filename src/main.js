import { Chess } from "chess.js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { RepertoireTree } from "./repertoire-tree.js";
import { fenToEditorState, editorStateToFen } from "./fen-editor.js";
import { createOpeningPreset, getOpeningFamilyCount, identifyOpeningFromFens } from "./opening-catalog.js";
import { encodeBoardMarks, emptyBoardMarks, nagsToSymbols, normalizeNag, parseBoardMarks, stripBoardMarkTags, toggleArrowMark, toggleSquareMark } from "./board-annotations.js";
import {
  buildReviewCards,
  countDueCards,
  countReviewsToday,
  gradeFsrsCard,
  getTodayReviewStats,
  NEW_CARDS_PER_DAY,
  parseUci,
  selectDailyCards,
} from "./fsrs-review.js";
import {
  buildDashboardSnapshot,
  calculateExamResult,
  normalizeStudyGoal,
  selectExamQuestions,
} from "./dashboard.js";
import "./style.css";

const STORAGE_KEY = "chess-os.repertoire.v1";
const REVIEW_STORAGE_KEY = "chess-os.fsrs.review-state.v1";
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
let studyCards = [];
let reviewLogs = [];
let reviewSessions = [];
let studyGoals = [];
let examAttempts = [];
let examAnswers = [];
let importedGames = [];
let onlineImportBusy = false;
let reviewQueue = [];
let examQueue = [];
let currentExamCard = null;
let examAttemptId = null;
let examQuestionIndex = 0;
let examTotalQuestions = 0;
let examCorrectCount = 0;
let examAnswered = false;
let examFeedback = "";
let examLastMove = null;
let examPassThreshold = 70;
let isSavingExamAnswer = false;
let currentReviewCard = null;
let reviewSessionId = null;
let reviewSessionTotal = 0;
let reviewCompleted = 0;
let reviewAgainCount = 0;
let reviewSolved = false;
let reviewRevealed = false;
let reviewFailed = false;
let reviewFeedback = "";
let reviewLastMove = null;
let reviewCardStartedAt = 0;
let reviewSessionFinished = false;
let isStartingReviewSession = false;
let isSavingReview = false;
let baseFen = DEFAULT_FEN;
let studioStates = [DEFAULT_FEN];
let studioSans = [];
let studioMoveObjects = [];
let studioPly = 0;
let studioTree = new RepertoireTree(DEFAULT_FEN);
let studioPath = [];
let toastTimer = null;
let fenEditorState = null;
let fenSelectedPiece = "wP";
let boardMarkTool = "move";
let boardMarkColor = "G";
let boardMarkAnchor = null;

const $ = (selector) => document.querySelector(selector);
const boardElement = $("#chessboard");
const titleInput = $("#line-title");
const moveListElement = $("#move-list");
const promotionDialog = $("#promotion-dialog");
const promotionOptions = $("#promotion-options");

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

function readReviewState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REVIEW_STORAGE_KEY) || "{}");
    return {
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      goals: Array.isArray(parsed.goals) ? parsed.goals : [],
      examAttempts: Array.isArray(parsed.examAttempts) ? parsed.examAttempts : [],
      examAnswers: Array.isArray(parsed.examAnswers) ? parsed.examAnswers : [],
    };
  } catch {
    return { cards: [], logs: [], sessions: [], goals: [], examAttempts: [], examAnswers: [] };
  }
}

function persistLocalReviewState() {
  try {
    localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify({
      cards: studyCards,
      logs: reviewLogs,
      sessions: reviewSessions,
      goals: studyGoals,
      examAttempts,
      examAnswers,
    }));
    return true;
  } catch {
    showToast("Non riesco a salvare lo storico FSRS nella memoria locale.");
    return false;
  }
}

async function loadStudyData() {
  if (persistenceMode === "sqlite") {
    const [storedCards, storedLogs, storedSessions, storedGoals, storedExams] = await Promise.all([
      invoke("list_study_cards"),
      invoke("list_review_logs"),
      invoke("list_training_sessions"),
      invoke("list_study_goals"),
      invoke("list_exam_attempts"),
    ]);
    studyCards = storedCards.map((record) => {
      let fsrs;
      try { fsrs = JSON.parse(record.fsrsJson); } catch { fsrs = null; }
      return { ...record, fsrs };
    }).filter((record) => record.fsrs && typeof record.fsrs === "object");
    reviewLogs = storedLogs;
    reviewSessions = storedSessions;
    studyGoals = storedGoals;
    examAttempts = storedExams;
    examAnswers = [];
  } else {
    const saved = readReviewState();
    studyCards = saved.cards;
    reviewLogs = saved.logs;
    reviewSessions = saved.sessions;
    studyGoals = saved.goals;
    examAttempts = saved.examAttempts;
    examAnswers = saved.examAnswers;
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
    await loadStudyData();
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
    await loadStudyData();
    databaseReady = true;
    await refreshImportedGames();
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
  return (mode === "training" || mode === "exam") && trainingGame ? trainingGame : game;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
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
  boardMarkAnchor = null;
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
  if (mode === "training") return reviewLastMove;
  if (mode === "exam") return examLastMove;
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
  renderBoardMarkings();
  $("#turn-label").textContent = (chess.turn() === "w" ? "Bianco" : "Nero") + " al tratto";
  $("#game-status").textContent = gameStatus(chess);
  const currentCount = mode === "training" ? reviewCompleted : mode === "exam" ? examQuestionIndex + (examAnswered ? 1 : 0) : studioPly;
  const totalCount = mode === "training" ? reviewSessionTotal : mode === "exam" ? examTotalQuestions : studioSans.length;
  $("#move-count").textContent = mode === "studio"
    ? currentCount + " / " + totalCount + " semimosse"
    : currentCount + " / " + totalCount + " domande";
  $("#line-move-count").textContent = mode === "training"
    ? (currentReviewCard ? currentReviewCard.repertoireTitle + " · " + currentReviewCard.side : "Sessione giornaliera")
    : mode === "exam"
      ? (currentExamCard ? currentExamCard.repertoireTitle + " · " + (currentExamCard.side === "white" ? "Bianco" : "Nero") : "Esame repertorio")
      : studioPly + " / " + studioSans.length + " semimosse · posizione " + (studioPly + 1);
  $("#board-label").textContent = mode === "training"
    ? "MODALITÀ ALLENAMENTO"
    : mode === "exam" ? "ESAME DEL REPERTORIO" : "PARTITA / ANALISI";
  $("#undo").disabled = mode !== "studio" || studioPly === 0;
  $("#redo").disabled = mode !== "studio" || studioPly >= studioSans.length;
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
      const moveEdge = mode === "studio" ? studioTree.getEdge(studioPath[moveIndex]) : null;
      san.textContent = moves[moveIndex].san + (moveEdge ? nagsToSymbols(moveEdge.nags) : "");
      if (moveEdge?.comment) san.title = stripBoardMarkTags(moveEdge.comment);
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
  const exam = mode === "exam";
  const dashboard = mode === "dashboard";
  const study = !dashboard;
  $("#nav-studio").classList.toggle("active", mode === "studio");
  $("#nav-training").classList.toggle("active", training);
  $("#nav-dashboard").classList.toggle("active", dashboard);
  $("#mode-eyebrow").textContent = dashboard
    ? "ATTIVITÀ / STATISTICHE"
    : training ? "REPERTORIO / RIPASSO FSRS"
      : exam ? "REPERTORIO / ESAME"
        : "REPERTORIO / ANALISI";
  $("#page-title").textContent = dashboard
    ? "Dashboard e progressi"
    : training ? "Ripasso giornaliero"
      : exam ? "Esame del repertorio" : "Chess Studio";
  $("#page-subtitle").textContent = dashboard
    ? "Controlla i progressi, gli obiettivi e la preparazione dei tuoi repertori."
    : training ? "Allena il richiamo delle mosse con intervalli adattivi."
      : exam ? "Verifica quanto ricordi senza aiuti e registra il risultato."
        : "Costruisci linee principali, varianti e transposizioni.";
  $("#heading-actions").hidden = dashboard || exam;
  $("#study-grid").hidden = !study;
  $("#dashboard-panel").hidden = !dashboard;
  $("#save-line").disabled = mode !== "studio" || !databaseReady;
  $("#board-mark-tool").disabled = training;
  $("#board-mark-color").disabled = training;
  $("#clear-board-marks").disabled = training;
  $("#reset").textContent = training ? "Esci dal ripasso" : exam ? "Interrompi esame" : "Nuova posizione";
  for (const selector of ["#line-card", "#moves-card", "#variations-card", "#import-card"]) {
    $(selector).hidden = mode !== "studio";
  }
  $("#review-panel").hidden = !training;
  $("#exam-panel").hidden = !exam;
  $("#flip-board").disabled = dashboard;
}

function renderVariations() {
  const list = $("#variation-list");
  if (!list) return;
  list.replaceChildren();
  if (mode !== "studio") {
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


function currentBoardMarks() {
  if (mode !== "studio") return emptyBoardMarks();
  if (studioPly === 0) {
    try { return JSON.parse(studioTree.headers.ChessOSRootMarks || "{}"); } catch { return emptyBoardMarks(); }
  }
  const edge = studioTree.getEdge(studioPath[studioPly - 1]);
  return edge ? parseBoardMarks(edge.comment) : emptyBoardMarks();
}

function storeCurrentBoardMarks(marks) {
  if (studioPly === 0) {
    if (marks.squares.length || marks.arrows.length) {
      studioTree.headers.ChessOSRootMarks = JSON.stringify(marks);
    } else {
      delete studioTree.headers.ChessOSRootMarks;
    }
  } else {
    const edge = studioTree.getEdge(studioPath[studioPly - 1]);
    if (!edge) return;
    edge.comment = encodeBoardMarks(edge.comment, marks);
  }
  setDirty(true);
  renderBoardMarkings();
  renderMoves();
}

function boardDisplayPoint(square) {
  const file = "abcdefgh".indexOf(square[0]);
  const rank = Number(square[1]);
  const col = boardFlipped ? 7 - file : file;
  const row = boardFlipped ? rank - 1 : 8 - rank;
  return { x: col * 100 + 50, y: row * 100 + 50 };
}

function renderBoardMarkings() {
  const svg = $("#board-markings");
  if (!svg) return;
  svg.replaceChildren();
  const ns = "http://www.w3.org/2000/svg";
  const colors = { G:"#26a269", R:"#e34b4b", Y:"#e3ad23", B:"#4285f4" };
  const marks = currentBoardMarks();
  const defs = document.createElementNS(ns, "defs");
  for (const [code, color] of Object.entries(colors)) {
    const marker = document.createElementNS(ns, "marker");
    marker.setAttribute("id", "board-arrow-" + code);
    marker.setAttribute("markerWidth", "7");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("refX", "5.5");
    marker.setAttribute("refY", "3.5");
    marker.setAttribute("orient", "auto");
    marker.setAttribute("markerUnits", "userSpaceOnUse");
    const tip = document.createElementNS(ns, "path");
    tip.setAttribute("d", "M0,0 L7,3.5 L0,7 Z");
    tip.setAttribute("fill", color);
    marker.append(tip);
    defs.append(marker);
  }
  svg.append(defs);
  for (const mark of marks.squares || []) {
    const point = boardDisplayPoint(mark.square);
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", String(point.x - 46));
    rect.setAttribute("y", String(point.y - 46));
    rect.setAttribute("width", "92");
    rect.setAttribute("height", "92");
    rect.setAttribute("rx", "5");
    rect.setAttribute("fill", colors[mark.color] || colors.G);
    rect.setAttribute("fill-opacity", "0.43");
    svg.append(rect);
  }
  for (const arrow of marks.arrows || []) {
    const from = boardDisplayPoint(arrow.from);
    const to = boardDisplayPoint(arrow.to);
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(to.x));
    line.setAttribute("y2", String(to.y));
    line.setAttribute("stroke", colors[arrow.color] || colors.G);
    line.setAttribute("stroke-width", "11");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-opacity", "0.9");
    line.setAttribute("marker-end", "url(#board-arrow-" + (arrow.color in colors ? arrow.color : "G") + ")");
    svg.append(line);
  }
  if (boardMarkAnchor) {
    const point = boardDisplayPoint(boardMarkAnchor);
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", String(point.x));
    circle.setAttribute("cy", String(point.y));
    circle.setAttribute("r", "39");
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", colors[boardMarkColor] || colors.G);
    circle.setAttribute("stroke-width", "8");
    circle.setAttribute("stroke-dasharray", "11 7");
    svg.append(circle);
  }
}

function handleBoardMarkSquare(square) {
  if (mode !== "studio") {
    showToast("Le annotazioni sono disponibili in Studio.");
    return;
  }
  let marks = currentBoardMarks();
  if (boardMarkTool === "square") {
    marks = toggleSquareMark(marks, square, boardMarkColor);
    storeCurrentBoardMarks(marks);
    return;
  }
  if (boardMarkTool === "arrow") {
    if (!boardMarkAnchor) {
      boardMarkAnchor = square;
      renderBoardMarkings();
      return;
    }
    if (boardMarkAnchor === square) {
      boardMarkAnchor = null;
      renderBoardMarkings();
      return;
    }
    marks = toggleArrowMark(marks, boardMarkAnchor, square, boardMarkColor);
    boardMarkAnchor = null;
    storeCurrentBoardMarks(marks);
    return;
  }
}

function clearCurrentBoardMarks() {
  boardMarkAnchor = null;
  storeCurrentBoardMarks(emptyBoardMarks());
}

function renderAnnotationEditor() {
  const commentInput = $("#move-comment");
  const nagInput = $("#move-nag");
  const targetLabel = $("#annotation-target");
  if (!commentInput || !nagInput || !targetLabel) return;
  const edge = studioPly > 0 ? studioTree.getEdge(studioPath[studioPly - 1]) : null;
  const comment = edge ? edge.comment : (studioTree.headers.ChessOSRootComment || "");
  const nag = edge ? (edge.nags?.[0] || "") : (studioTree.headers.ChessOSRootNAG || "");
  commentInput.value = stripBoardMarkTags(comment);
  nagInput.value = normalizeNag(nag);
  targetLabel.textContent = edge ? "Mossa " + edge.san + " · modifica l'ultima mossa raggiunta" : "Posizione iniziale · annotazione della radice";
  const disabled = mode !== "studio";
  commentInput.disabled = disabled;
  nagInput.disabled = disabled;
  $("#save-move-annotation").disabled = disabled;
}

function saveMoveAnnotation() {
  if (mode !== "studio") return;
  const comment = $("#move-comment").value.trim();
  const nag = normalizeNag($("#move-nag").value);
  if (studioPly === 0) {
    if (comment) studioTree.headers.ChessOSRootComment = comment;
    else delete studioTree.headers.ChessOSRootComment;
    if (nag) studioTree.headers.ChessOSRootNAG = nag;
    else delete studioTree.headers.ChessOSRootNAG;
  } else {
    const edge = studioTree.getEdge(studioPath[studioPly - 1]);
    if (!edge) return;
    edge.comment = encodeBoardMarks(comment, currentBoardMarks());
    edge.nags = nag ? [nag] : [];
  }
  setDirty(true);
  renderMoves();
  renderAnnotationEditor();
  renderBoardMarkings();
  showToast("Annotazione salvata nella linea.");
}

function localizedOpeningName(name) {
  const translations = [
    ["Sicilian Defense", "Difesa Siciliana"],
    ["Italian Game", "Partita Italiana"],
    ["French Defense", "Difesa Francese"],
    ["Caro-Kann Defense", "Difesa Caro-Kann"],
    ["Ruy Lopez", "Partita Spagnola"],
    ["Queen's Gambit", "Gambetto di Donna"],
    ["King's Gambit", "Gambetto di Re"],
    ["King's Indian Defense", "Difesa Indiana di Re"],
    ["Queen's Indian Defense", "Difesa Indiana di Donna"],
    ["Nimzo-Indian Defense", "Difesa Nimzo-Indiana"],
    ["Grunfeld Defense", "Difesa Grünfeld"],
    ["English Opening", "Apertura Inglese"],
    ["Réti Opening", "Apertura Réti"],
    ["Scandinavian Defense", "Difesa Scandinava"],
    ["Pirc Defense", "Difesa Pirc"],
    ["Modern Defense", "Difesa Moderna"],
    ["Alekhine Defense", "Difesa Alekhine"],
    ["Dutch Defense", "Difesa Olandese"],
    ["Slav Defense", "Difesa Slava"],
    ["Semi-Slav Defense", "Difesa Semi-Slava"],
    ["King's Indian Attack", "Attacco Est-Indiano"],
  ];
  for (const [english, italian] of translations) {
    if (name === english || name.startsWith(english + ":")) return italian + name.slice(english.length);
  }
  return name.replace(" Defense", " Defense");
}

function renderOpeningRecognition() {
  const nameElement = $("#opening-recognized-name");
  const ecoElement = $("#opening-recognized-eco");
  const detailElement = $("#opening-recognized-detail");
  if (!nameElement || !ecoElement || !detailElement) return;
  if (mode !== "studio") {
    nameElement.textContent = "Riconoscimento disponibile in Studio";
    ecoElement.textContent = "—";
    detailElement.textContent = "";
    return;
  }
  try {
    const result = identifyOpeningFromFens(studioStates.slice(0, studioPly + 1));
    if (!result) {
      nameElement.textContent = "Apertura non ancora identificata";
      ecoElement.textContent = "—";
      detailElement.textContent = studioPly === 0
        ? "Gioca le prime mosse per riconoscere un'apertura."
        : "Il catalogo contiene 3.865 linee curate per 500 codici ECO.";
      return;
    }
    nameElement.textContent = localizedOpeningName(result.name);
    ecoElement.textContent = result.eco;
    detailElement.textContent = "Riconosciuta alla mossa " + result.matchedPly + " · " + result.alternatives.length + " denominazioni per questa posizione";
  } catch (error) {
    nameElement.textContent = "Catalogo non disponibile";
    ecoElement.textContent = "—";
    detailElement.textContent = error.message;
  }
}

function renderFenPalette() {
  const palette = $("#fen-piece-palette");
  if (!palette) return;
  palette.replaceChildren();
  const choices = [
    { code:"", label:"Gomma", glyph:"⌫" },
    ...["K","Q","R","B","N","P"].map((piece) => ({ code:"w"+piece, label:"Bianco "+piece, glyph:symbols.w[piece.toLowerCase()] })),
    ...["K","Q","R","B","N","P"].map((piece) => ({ code:"b"+piece, label:"Nero "+piece, glyph:symbols.b[piece.toLowerCase()] })),
  ];
  for (const choice of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fen-piece-choice";
    button.dataset.piece = choice.code;
    button.textContent = choice.glyph;
    button.title = choice.label;
    button.setAttribute("aria-label", choice.label);
    if (fenSelectedPiece === choice.code) button.classList.add("selected");
    button.addEventListener("click", () => {
      fenSelectedPiece = choice.code;
      renderFenPalette();
    });
    palette.append(button);
  }
}

function syncFenEditorFields() {
  if (!fenEditorState) return;
  $("#fen-turn").value = fenEditorState.turn;
  for (const input of document.querySelectorAll("#fen-castling input[data-right]")) {
    input.checked = fenEditorState.castling.includes(input.dataset.right);
  }
  $("#fen-en-passant").value = fenEditorState.enPassant;
  $("#fen-halfmove").value = String(fenEditorState.halfmove);
  $("#fen-fullmove").value = String(fenEditorState.fullmove);
  try {
    $("#fen-editor-string").value = editorStateToFen(fenEditorState);
    $("#fen-editor-status").textContent = "Posizione FEN valida.";
    $("#fen-editor-status").className = "fen-editor-status valid";
  } catch (error) {
    $("#fen-editor-status").textContent = error.message;
    $("#fen-editor-status").className = "fen-editor-status invalid";
  }
}

function renderFenEditorBoard() {
  const board = $("#fen-editor-board");
  if (!board || !fenEditorState) return;
  board.replaceChildren();
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const square = "abcdefgh"[col] + String(8 - row);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fen-editor-square " + ((row + col) % 2 === 0 ? "light" : "dark");
      button.dataset.square = square;
      const code = fenEditorState.pieces[square] || "";
      button.textContent = code ? symbols[code[0]][code[1].toLowerCase()] : "";
      button.setAttribute("aria-label", square + (code ? " " + code : " vuota"));
      button.addEventListener("click", () => {
        if (fenSelectedPiece) fenEditorState.pieces[square] = fenSelectedPiece;
        else delete fenEditorState.pieces[square];
        renderFenEditorBoard();
        syncFenEditorFields();
      });
      board.append(button);
    }
  }
}

function openFenEditor() {
  if (mode === "training") {
    showToast("Esci dall'allenamento per modificare la posizione.");
    return;
  }
  try {
    fenEditorState = fenToEditorState(game.fen());
    fenSelectedPiece = "wP";
    renderFenPalette();
    renderFenEditorBoard();
    syncFenEditorFields();
    $("#fen-editor-dialog").hidden = false;
  } catch (error) {
    showToast("Impossibile aprire l'editor FEN: " + error.message);
  }
}

function loadFenEditorText() {
  try {
    const fen = $("#fen-editor-string").value.trim();
    fenEditorState = fenToEditorState(fen);
    renderFenEditorBoard();
    syncFenEditorFields();
  } catch (error) {
    $("#fen-editor-status").textContent = error.message;
    $("#fen-editor-status").className = "fen-editor-status invalid";
  }
}

function applyFenEditorPosition() {
  try {
    const state = { ...fenEditorState };
    state.turn = $("#fen-turn").value;
    state.castling = [...document.querySelectorAll("#fen-castling input[data-right]:checked")].map((input) => input.dataset.right);
    state.enPassant = $("#fen-en-passant").value.trim();
    state.halfmove = Number($("#fen-halfmove").value);
    state.fullmove = Number($("#fen-fullmove").value);
    const fen = editorStateToFen(state);
    if (!confirmDiscardChanges("sostituire la posizione corrente")) return;
    baseFen = fen;
    studioTree = new RepertoireTree(fen, { Event:"Chess OS custom position" });
    syncStudioPath([]);
    activeLineId = null;
    mode = "studio";
    boardMarkTool = "move";
    boardMarkAnchor = null;
    titleInput.value = "Posizione personalizzata";
    selectedSquare = null;
    closePromotionChooser();
    setDirty(true);
    $("#fen-editor-dialog").hidden = true;
    renderAll();
    showToast("Posizione FEN applicata. Ora puoi creare la tua linea.");
  } catch (error) {
    $("#fen-editor-status").textContent = error.message;
    $("#fen-editor-status").className = "fen-editor-status invalid";
  }
}

function loadOpeningTemplate() {
  const family = $("#opening-template").value;
  if (!family) return;
  if (!confirmDiscardChanges("caricare il repertorio iniziale selezionato")) return;
  try {
    const preset = createOpeningPreset(family);
    studioTree = preset.tree;
    baseFen = preset.tree.rootFen;
    syncStudioPath(preset.tree.mainlinePath());
    activeLineId = null;
    mode = "studio";
    titleInput.value = "Repertorio " + localizedOpeningName(family);
    selectedSquare = null;
    closePromotionChooser();
    setDirty(true);
    renderAll();
    showToast(preset.rows + " linee caricate · " + preset.tree.edges.size + " mosse/rami disponibili. Salva il repertorio per conservarlo.");
  } catch (error) {
    showToast("Impossibile caricare il repertorio: " + error.message);
  }
}

function renderAll() {
  renderBoard();
  renderMoves();
  renderVariations();
  renderRepertoire();
  renderMode();
  renderOpeningRecognition();
  renderAnnotationEditor();
  renderReviewPanel();
  renderDashboard();
  renderExamPanel();
  renderImportedGames();
}

function renderImportedGames() {
  const list = $("#imported-games-list");
  if (!list) return;
  list.replaceChildren();

  if (persistenceMode !== "sqlite") {
    const empty = document.createElement("div");
    empty.className = "repertoire-empty";
    empty.textContent = "Disponibile nell'app desktop.";
    list.append(empty);
    return;
  }
  if (!importedGames.length) {
    const empty = document.createElement("div");
    empty.className = "repertoire-empty";
    empty.textContent = "Nessuna partita importata. Usa il pulsante + per collegare un archivio.";
    list.append(empty);
    return;
  }

  for (const record of importedGames) {
    const row = document.createElement("div");
    row.className = "imported-game-row";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "imported-game-open";
    const title = document.createElement("span");
    title.className = "imported-game-title";
    title.textContent = (record.white || "Bianco") + " – " + (record.black || "Nero");
    const detail = document.createElement("small");
    const provider = record.provider === "lichess" ? "Lichess" : "Chess.com";
    detail.textContent = [record.playedAt, provider, record.result].filter(Boolean).join(" · ");
    open.append(title, detail);
    open.addEventListener("click", () => { void openImportedGame(record.id); });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "imported-game-delete";
    remove.textContent = "×";
    remove.title = "Rimuovi partita importata";
    remove.setAttribute("aria-label", "Rimuovi partita " + title.textContent);
    remove.addEventListener("click", () => { void removeImportedGame(record.id); });
    row.append(open, remove);
    list.append(row);
  }
}

async function refreshImportedGames() {
  if (persistenceMode !== "sqlite" || !databaseReady) {
    importedGames = [];
    renderImportedGames();
    return;
  }
  importedGames = await invoke("list_imported_games", { limit: 15 });
  renderImportedGames();
}

function openOnlineImportDialog() {
  const dialog = $("#online-import-dialog");
  if (!dialog) return;
  $("#online-import-progress").textContent = persistenceMode === "sqlite"
    ? "Le partite saranno salvate solo in locale. Gli import successivi saltano automaticamente quelle già presenti."
    : "L'importazione API è disponibile nella versione desktop di ChessOS.";
  $("#start-online-import").disabled = persistenceMode !== "sqlite" || onlineImportBusy;
  dialog.hidden = false;
  updateOnlineImportProvider();
  $("#online-username").focus();
}

function closeOnlineImportDialog() {
  if (onlineImportBusy) return;
  $("#online-import-dialog").hidden = true;
  $("#lichess-api-token").value = "";
}

function updateOnlineImportProvider() {
  const isLichess = $("#online-provider").value === "lichess";
  $("#lichess-token-field").hidden = !isLichess;
  $("#online-import-progress").textContent = isLichess
    ? "Inserisci un token API personale Lichess valido. Il token viene usato solo per questa richiesta e non viene salvato."
    : "Inserisci lo username Chess.com. Verranno letti in sequenza tutti gli archivi mensili pubblici disponibili.";
}

async function startOnlineGameImport() {
  if (onlineImportBusy) return;
  if (persistenceMode !== "sqlite") {
    $("#online-import-progress").textContent = "Apri ChessOS come app desktop per importare e salvare le partite.";
    return;
  }
  const provider = $("#online-provider").value;
  const username = $("#online-username").value.trim();
  const token = provider === "lichess" ? $("#lichess-api-token").value.trim() : null;
  if (!username) {
    $("#online-import-progress").textContent = "Inserisci prima lo username.";
    $("#online-username").focus();
    return;
  }
  if (provider === "lichess" && !token) {
    $("#online-import-progress").textContent = "Per Lichess è necessario un token API personale valido.";
    $("#lichess-api-token").focus();
    return;
  }

  onlineImportBusy = true;
  const button = $("#start-online-import");
  button.disabled = true;
  button.textContent = "Importazione in corso…";
  $("#cancel-online-import").disabled = true;
  $("#online-import-progress").textContent = "Connessione al servizio e download degli archivi…";
  let stopListening = null;
  try {
    stopListening = await listen("online-game-import-progress", (event) => {
      const progress = event.payload || {};
      $("#online-import-progress").textContent =
        "Elaborate: " + (progress.processed || 0)
        + " · nuove: " + (progress.imported || 0)
        + " · già presenti: " + (progress.duplicates || 0)
        + " · non supportate: " + (progress.skipped || 0);
    });
    const summary = await invoke("import_online_games", { provider, username, token });
    await refreshImportedGames();
    const providerName = provider === "lichess" ? "Lichess" : "Chess.com";
    $("#online-import-progress").textContent =
      providerName + " — " + summary.username + ": " + summary.imported + " nuove partite importate, "
      + summary.duplicates + " già presenti e " + summary.skipped + " ignorate/non supportate."
      + (provider === "chess_com" ? " Archivi mensili controllati: " + summary.archives + "." : "");
    $("#lichess-api-token").value = "";
    showToast(summary.imported + " partite aggiunte alla libreria.");
  } catch (error) {
    $("#online-import-progress").textContent = "Importazione non completata: " + (error?.message || String(error));
    showToast("Importazione partite non riuscita.");
    try { await refreshImportedGames(); } catch { /* Mantieni la libreria già caricata. */ }
  } finally {
    if (stopListening) stopListening();
    $("#lichess-api-token").value = "";
    onlineImportBusy = false;
    button.disabled = false;
    button.textContent = "Importa tutte le partite";
    $("#cancel-online-import").disabled = false;
  }
}

async function openImportedGame(id) {
  if (!confirmDiscardChanges("aprire una partita importata")) return;
  try {
    if (mode === "exam" && examAttemptId) await finishRepertoireExam(true);
    if (mode === "training" && reviewSessionId && !reviewSessionFinished) {
      await markReviewSessionFinished();
    }
    const record = await invoke("get_imported_game", { id });
    const loaded = RepertoireTree.fromPgn(record.pgn);
    rebuildTimeline(loaded);
    activeLineId = null;
    mode = "studio";
    trainingGame = null;
    trainingMoves = [];
    trainingIndex = 0;
    reviewSessionId = null;
    reviewSessionFinished = false;
    titleInput.value = (record.white || "Bianco") + " – " + (record.black || "Nero");
    setDirty(false);
    selectedSquare = null;
    closePromotionChooser();
    renderAll();
    showToast("Partita caricata. Usa «Salva linea» per conservarla nel repertorio.");
  } catch (error) {
    showToast("Non riesco ad aprire questa partita: " + (error?.message || String(error)));
  }
}

async function removeImportedGame(id) {
  const record = importedGames.find((item) => item.id === id);
  if (!record) return;
  if (!window.confirm("Rimuovere questa partita dalla libreria locale? Il repertorio non verrà modificato.")) return;
  try {
    await invoke("delete_imported_game", { id });
    await refreshImportedGames();
    showToast("Partita rimossa dalla libreria importata.");
  } catch (error) {
    showToast("Errore durante la rimozione: " + (error?.message || String(error)));
  }
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
  if (mode === "exam") {
    void recordExamMove(selectedMove);
    return;
  }
  if (mode === "training") {
    if (!currentReviewCard || reviewSolved || reviewRevealed) return;
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

    const playedUci = played.from + played.to + (played.promotion || "");
    if (playedUci !== currentReviewCard.uci) {
      trainingGame.undo();
      selectedSquare = null;
      reviewFailed = true;
      reviewFeedback = "Non è la mossa prevista. Puoi riprovare oppure valutare Again.";
      renderAll();
      return;
    }

    reviewSolved = true;
    reviewLastMove = played;
    reviewFeedback = "Mossa corretta: " + played.san + ". Scegli una valutazione.";
    selectedSquare = null;
    renderAll();
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
  if (mode === "exam" && examAnswered) return;
  const chess = activeGame();
  if (mode === "studio" && boardMarkTool !== "move") {
    handleBoardMarkSquare(square);
    return;
  }
  if (pendingPromotion) return;
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
  if (mode === "exam" && examAttemptId) {
    void finishRepertoireExam(true).then(() => openLine(id));
    return;
  }
  if (mode === "training" && reviewSessionId && !reviewSessionFinished) {
    void markReviewSessionFinished().catch((error) => {
      showToast("Non riesco a chiudere la sessione: " + error.message);
    });
    reviewSessionId = null;
    reviewSessionFinished = false;
  }
  const line = repertoire.find((item) => item.id === id);
  if (!line || !confirmDiscardChanges("aprire un'altra linea")) return;
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
  if (mode === "exam" && examAttemptId) {
    await finishRepertoireExam(true);
  }
  if (!databaseReady) {
    showToast("Database non pronto: eliminazione non eseguita.");
    return;
  }
  const removedCardIds = new Set(studyCards
    .filter((card) => (card.repertoireId ?? card.repertoire_id) === id)
    .map((card) => card.id));
  const removedExamIds = new Set(examAttempts
    .filter((attempt) => (attempt.repertoireId ?? attempt.repertoire_id) === id)
    .map((attempt) => attempt.id));
  try {
    if (persistenceMode === "sqlite") {
      await invoke("delete_repertoire", { id });
    } else {
      const next = repertoire.filter((item) => item.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
    repertoire = repertoire.filter((item) => item.id !== id);
    studyCards = studyCards.filter((card) => !removedCardIds.has(card.id));
    reviewLogs = reviewLogs.filter((log) => !removedCardIds.has(log.cardId ?? log.card_id));
    examAnswers = examAnswers.filter((answer) => !removedExamIds.has(answer.attemptId ?? answer.attempt_id));
    examAttempts = examAttempts.filter((attempt) => !removedExamIds.has(attempt.id));
    if (persistenceMode !== "sqlite") persistLocalReviewState();
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
  if (mode !== "studio") return;
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

function startTraining() {
  if (mode === "exam" && examAttemptId) {
    void finishRepertoireExam(true).then(() => startTraining());
    return;
  }
  if (reviewSessionId && !reviewSessionFinished) {
    void markReviewSessionFinished().catch((error) => {
      showToast("Non riesco a chiudere la sessione precedente: " + error.message);
    });
  }
  if (!databaseReady) {
    showToast("Archivio non pronto: riprova tra qualche istante.");
    return;
  }
  trainingGame = new Chess(DEFAULT_FEN);
  trainingMoves = [];
  trainingIndex = 0;
  reviewQueue = [];
  currentReviewCard = null;
  reviewSessionId = null;
  reviewSessionTotal = 0;
  reviewCompleted = 0;
  reviewAgainCount = 0;
  reviewSolved = false;
  reviewRevealed = false;
  reviewFailed = false;
  reviewFeedback = "";
  reviewLastMove = null;
  reviewSessionFinished = false;
  selectedSquare = null;
  mode = "training";
  closePromotionChooser();
  renderAll();
}

async function beginDailyReviewSession() {
  if (isStartingReviewSession) return;
  if (!databaseReady || !repertoire.length) {
    showToast("Salva almeno una linea nel repertorio prima di iniziare.");
    return;
  }
  const now = new Date();
  const side = $("#review-side").value;
  const cards = buildReviewCards(repertoire, studyCards, now);
  const todayStats = getTodayReviewStats(reviewLogs, now);
  const remainingNewCards = Math.max(0, NEW_CARDS_PER_DAY - todayStats.newCardsReviewed);
  const queue = selectDailyCards(cards, now, side, remainingNewCards);
  if (!queue.length) {
    showToast(remainingNewCards === 0
      ? "Limite giornaliero di nuove carte raggiunto; torna domani."
      : "Nessuna carta in scadenza per il lato selezionato.");
    renderReviewPanel();
    return;
  }

  isStartingReviewSession = true;
  const startButton = $("#review-start");
  startButton.disabled = true;
  const id = globalThis.crypto?.randomUUID?.() ?? "session-" + Date.now();
  try {
    if (persistenceMode === "sqlite") {
      await invoke("start_training_session", {
        input: { id, startedAt: now.toISOString(), side },
      });
    } else {
      reviewSessions.unshift({
        id,
        startedAt: now.toISOString(),
        finishedAt: null,
        side,
        cardsReviewed: 0,
        correctCount: 0,
        againCount: 0,
      });
      if (!persistLocalReviewState()) {
        isStartingReviewSession = false;
        startButton.disabled = false;
        return;
      }
    }
  } catch (error) {
    isStartingReviewSession = false;
    startButton.disabled = false;
    showToast("Non riesco ad avviare la sessione: " + error.message);
    return;
  }

  isStartingReviewSession = false;
  startButton.disabled = false;
  reviewSessionId = id;
  reviewSessionTotal = queue.length;
  reviewCompleted = 0;
  reviewAgainCount = 0;
  reviewSessionFinished = false;
  reviewQueue = [...queue];
  openNextReviewCard();
}

function openNextReviewCard() {
  currentReviewCard = reviewQueue.shift() || null;
  selectedSquare = null;
  reviewSolved = false;
  reviewRevealed = false;
  reviewFailed = false;
  reviewFeedback = "";
  reviewLastMove = null;
  trainingIndex = 0;
  trainingMoves = [];
  if (!currentReviewCard) {
    void finishReviewSession();
    return;
  }
  trainingStartFen = currentReviewCard.fen;
  trainingGame = new Chess(trainingStartFen);
  boardFlipped = currentReviewCard.side === "black";
  reviewCardStartedAt = performance.now();
  closePromotionChooser();
  renderAll();
}

async function markReviewSessionFinished() {
  if (!reviewSessionId || reviewSessionFinished) return;
  const finishedAt = new Date().toISOString();
  if (persistenceMode === "sqlite") {
    await invoke("finish_training_session", {
      input: { id: reviewSessionId, finishedAt },
    });
  } else {
    reviewSessions = reviewSessions.map((session) => (
      session.id === reviewSessionId ? { ...session, finishedAt } : session
    ));
    persistLocalReviewState();
  }
  reviewSessionFinished = true;
}

async function finishReviewSession() {
  try {
    await markReviewSessionFinished();
  } catch (error) {
    showToast("Sessione conclusa, ma non riesco a salvare la chiusura: " + error.message);
    reviewSessionFinished = true;
  }
  currentReviewCard = null;
  trainingGame = new Chess(DEFAULT_FEN);
  reviewFeedback = "Sessione completata: " + reviewCompleted + " carte ripassate, " + reviewAgainCount + " valutate Again.";
  renderAll();
}

async function rateCurrentCard(ratingName) {
  if (isSavingReview || !currentReviewCard || (!reviewSolved && !reviewRevealed && ratingName !== "again")) return;
  isSavingReview = true;
  const now = new Date();
  const card = currentReviewCard;
  let result;
  try {
    result = gradeFsrsCard(card.fsrs, ratingName, now);
  } catch (error) {
    isSavingReview = false;
    showToast("Errore nello scheduling FSRS: " + error.message);
    return;
  }

  const updatedCard = {
    ...card,
    fsrs: result.card,
    dueAt: result.dueAt,
    stability: result.card.stability,
    difficulty: result.card.difficulty,
    reps: result.card.reps,
    lapses: result.card.lapses,
    state: result.state,
    updatedAt: now.toISOString(),
  };
  const reviewLog = {
    id: globalThis.crypto?.randomUUID?.() ?? "review-" + Date.now(),
    cardId: card.id,
    sessionId: reviewSessionId,
    rating: result.log.rating,
    reviewedAt: now.toISOString(),
    elapsedMs: Math.max(0, Math.round(performance.now() - reviewCardStartedAt)),
    scheduledDays: result.scheduledDays,
    stateJson: JSON.stringify({ ...result.log, recalled: reviewSolved }),
  };

  try {
    if (persistenceMode === "sqlite") {
      await invoke("record_study_review", {
        input: {
          card: {
            id: updatedCard.id,
            repertoireId: updatedCard.repertoireId,
            edgeId: updatedCard.edgeId,
            side: updatedCard.side,
            dueAt: updatedCard.dueAt,
            stability: updatedCard.stability,
            difficulty: updatedCard.difficulty,
            reps: updatedCard.reps,
            lapses: updatedCard.lapses,
            state: updatedCard.state,
            fsrsJson: JSON.stringify(updatedCard.fsrs),
            createdAt: updatedCard.createdAt,
            updatedAt: updatedCard.updatedAt,
          },
          reviewLog,
        },
      });
    } else {
      studyCards = studyCards.filter((entry) => entry.id !== updatedCard.id).concat(updatedCard);
      reviewLogs = [reviewLog, ...reviewLogs];
      const session = reviewSessions.find((entry) => entry.id === reviewSessionId);
      if (session) {
        session.cardsReviewed = (session.cardsReviewed || 0) + 1;
        session.correctCount = (session.correctCount || 0) + (result.log.rating > 1 ? 1 : 0);
        session.againCount = (session.againCount || 0) + (result.log.rating === 1 ? 1 : 0);
      }
      if (!persistLocalReviewState()) {
        isSavingReview = false;
        return;
      }
    }
  } catch (error) {
    isSavingReview = false;
    showToast("Non riesco a salvare la risposta FSRS: " + error.message);
    return;
  }

  isSavingReview = false;
  studyCards = studyCards.filter((entry) => entry.id !== updatedCard.id).concat(updatedCard);
  reviewLogs = [reviewLog, ...reviewLogs.filter((entry) => entry.id !== reviewLog.id)];
  reviewCompleted += 1;
  if (ratingName === "again") reviewAgainCount += 1;
  openNextReviewCard();
}

function showReviewAnswer() {
  if (!currentReviewCard || reviewSolved || reviewRevealed) return;
  try {
    const move = trainingGame.move(parseUci(currentReviewCard.uci));
    reviewLastMove = move;
    reviewRevealed = true;
    reviewFeedback = "Soluzione: " + move.san + ". Valuta quanto era facile ricordarla.";
    renderAll();
  } catch (error) {
    showToast("Impossibile mostrare la soluzione: " + error.message);
  }
}

function renderReviewPanel() {
  const now = new Date();
  const side = $("#review-side").value;
  const cards = buildReviewCards(repertoire, studyCards, now);
  const todayStats = getTodayReviewStats(reviewLogs, now);
  $("#review-stat-due").textContent = String(countDueCards(cards, now, side));
  $("#review-stat-today").textContent = String(todayStats.reviews);
  $("#review-stat-accuracy").textContent = todayStats.reviews ? todayStats.accuracy + "%" : "—";
  $("#review-stat-total").textContent = String(cards.length);

  const hasSession = Boolean(reviewSessionId);
  $("#review-setup").hidden = hasSession;
  $("#review-active").hidden = !hasSession || !currentReviewCard;
  $("#review-complete").hidden = !reviewSessionFinished;
  if (currentReviewCard) {
    $("#review-card-meta").textContent =
      currentReviewCard.repertoireTitle + " · " +
      (currentReviewCard.side === "white" ? "Bianco" : "Nero") +
      " · carta " + (reviewCompleted + 1) + "/" + reviewSessionTotal;
  }
  $("#review-feedback").textContent = reviewFeedback || "Trova la mossa prevista in questa posizione.";
  $("#review-show-answer").hidden = reviewSolved || reviewRevealed || !currentReviewCard;
  $("#review-quick-again").hidden = !reviewFailed || reviewSolved || reviewRevealed;
  $("#review-grades").hidden = !(reviewSolved || reviewRevealed);
  $("#review-complete-summary").textContent =
    "Sessione completata: " + reviewCompleted + " carte ripassate, " +
    reviewAgainCount + " valutate Again. " + countReviewsToday(reviewLogs, now) + " ripassi oggi.";
}

function renderDashboardBars(selector, points) {
  const container = $(selector);
  if (!container) return;
  container.replaceChildren();
  const maximum = Math.max(1, ...points.map((point) => Number(point.reviews) || 0));
  for (const point of points) {
    const item = document.createElement("div");
    item.className = "dashboard-bar-item";
    item.title = point.reviews + " ripassi · " + (point.accuracy == null ? "nessun dato" : point.accuracy + "% richiamo");
    const value = document.createElement("span");
    value.className = "dashboard-bar-value";
    value.textContent = String(point.reviews || 0);
    const track = document.createElement("div");
    track.className = "dashboard-bar-track";
    const fill = document.createElement("div");
    fill.className = "dashboard-bar-fill";
    fill.style.height = (point.reviews ? Math.max(4, (point.reviews / maximum) * 100) : 2) + "%";
    track.append(fill);
    const label = document.createElement("span");
    label.className = "dashboard-bar-label";
    label.textContent = point.label;
    item.append(value, track, label);
    container.append(item);
  }
}

function appendDashboardEmpty(container, message) {
  const empty = document.createElement("div");
  empty.className = "dashboard-empty";
  empty.textContent = message;
  container.append(empty);
}

function appendGoalProgress(container, label, actual, target, suffix = "") {
  const row = document.createElement("div");
  row.className = "dashboard-goal-progress-row";
  const header = document.createElement("div");
  header.className = "dashboard-goal-progress-head";
  const name = document.createElement("span");
  name.textContent = label;
  const value = document.createElement("strong");
  value.textContent = actual + " / " + target + suffix;
  header.append(name, value);
  const track = document.createElement("div");
  track.className = "dashboard-progress-track";
  const fill = document.createElement("div");
  fill.className = "dashboard-progress-fill";
  const progress = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
  fill.style.width = progress + "%";
  track.append(fill);
  row.append(header, track);
  container.append(row);
}

function renderDashboard() {
  if (!$("#dashboard-panel")) return;
  const now = new Date();
  const cards = buildReviewCards(repertoire, studyCards, now);
  const snapshot = buildDashboardSnapshot({
    repertoires: repertoire,
    reviewCards: cards,
    reviewLogs,
    sessions: reviewSessions,
    goals: studyGoals,
    examAttempts,
  }, now);

  $("#dashboard-stat-repertoires").textContent = String(snapshot.overview.repertoireCount);
  $("#dashboard-stat-moves").textContent = String(snapshot.overview.totalMoves);
  $("#dashboard-stat-today").textContent = String(snapshot.today.reviews);
  $("#dashboard-stat-today-detail").textContent = snapshot.today.minutes + " minuti · " + snapshot.today.sessions + " sessioni";
  $("#dashboard-stat-accuracy").textContent = snapshot.week.accuracy == null ? "—" : snapshot.week.accuracy + "%";
  $("#dashboard-stat-week-detail").textContent = snapshot.week.recalled + " mosse ricordate su " + snapshot.week.reviews;
  $("#dashboard-stat-due").textContent = String(snapshot.overview.dueCards);
  $("#dashboard-daily-total").textContent = String(snapshot.today.reviews);
  $("#dashboard-weekly-total").textContent = String(snapshot.week.reviews);
  renderDashboardBars("#dashboard-daily-chart", snapshot.dailyTrend);
  renderDashboardBars("#dashboard-weekly-chart", snapshot.weeklyTrend);

  const goalsForm = $("#dashboard-goals-form");
  if (!goalsForm.contains(document.activeElement)) {
    $("#goal-daily-reviews").value = String(snapshot.today.goal.targetReviews);
    $("#goal-daily-minutes").value = String(snapshot.today.goal.targetMinutes);
    $("#goal-weekly-reviews").value = String(snapshot.week.goal.targetReviews);
    $("#goal-weekly-minutes").value = String(snapshot.week.goal.targetMinutes);
    $("#goal-target-accuracy").value = String(Math.max(snapshot.today.goal.targetAccuracy, snapshot.week.goal.targetAccuracy));
  }
  const goalBox = $("#dashboard-goal-progress");
  goalBox.replaceChildren();
  for (const [label, actual] of [["Oggi", snapshot.today], ["Questa settimana", snapshot.week]]) {
    const group = document.createElement("div");
    group.className = "dashboard-goal-group";
    const heading = document.createElement("strong");
    heading.className = "dashboard-goal-group-title";
    heading.textContent = label;
    group.append(heading);
    appendGoalProgress(group, "Ripassi", actual.reviews, actual.goal.targetReviews);
    appendGoalProgress(group, "Minuti", actual.minutes, actual.goal.targetMinutes);
    appendGoalProgress(group, "Richiamo", actual.accuracy ?? 0, actual.goal.targetAccuracy, "%");
    goalBox.append(group);
  }

  const repertoireList = $("#dashboard-repertoire-list");
  repertoireList.replaceChildren();
  if (!snapshot.repertoires.length) {
    appendDashboardEmpty(repertoireList, "Crea e salva un repertorio in Studio per iniziare a misurare i progressi.");
  } else {
    for (const line of snapshot.repertoires) {
      const row = document.createElement("div");
      row.className = "dashboard-repertoire-row";
      const details = document.createElement("div");
      const title = document.createElement("strong");
      title.className = "dashboard-repertoire-title";
      title.textContent = line.title;
      const detail = document.createElement("span");
      detail.className = "dashboard-repertoire-detail";
      detail.textContent = line.reviewedCards + "/" + line.moveCount + " schede viste · " +
        line.reviews + " valutazioni" +
        (line.lastReview ? " · ultimo ripasso " + new Date(line.lastReview).toLocaleDateString("it-IT") : "");
      details.append(title, detail);
      const metric = document.createElement("strong");
      metric.className = "dashboard-repertoire-metric";
      metric.textContent = line.accuracy == null ? "—" : line.accuracy + "%";
      row.append(details, metric);
      row.addEventListener("click", () => openLine(line.id));
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", "Apri il repertorio " + line.title);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openLine(line.id);
        }
      });
      repertoireList.append(row);
    }
  }

  const examSelect = $("#exam-repertoire");
  const previousSelection = examSelect.value;
  examSelect.replaceChildren();
  for (const line of repertoire) {
    const option = document.createElement("option");
    option.value = line.id;
    option.textContent = line.title || "Linea senza nome";
    examSelect.append(option);
  }
  if (repertoire.some((line) => line.id === previousSelection)) examSelect.value = previousSelection;
  $("#exam-start").disabled = !repertoire.length || !databaseReady;

  const history = $("#dashboard-exam-history");
  history.replaceChildren();
  if (!snapshot.exams.length) {
    appendDashboardEmpty(history, "Gli esami completati appariranno qui.");
  } else {
    for (const attempt of snapshot.exams) {
      const row = document.createElement("div");
      row.className = "dashboard-history-row";
      const details = document.createElement("div");
      const title = document.createElement("strong");
      title.className = "dashboard-history-title";
      title.textContent = attempt.repertoireTitle || "Esame repertorio";
      const correct = Number(attempt.correctCount ?? attempt.correct_count ?? 0);
      const total = Number(attempt.totalQuestions ?? attempt.total_questions ?? 0);
      const score = total ? Math.round((correct / total) * 100) : 0;
      const started = attempt.startedAt ?? attempt.started_at;
      const detail = document.createElement("span");
      detail.className = "dashboard-history-detail";
      detail.textContent = (started ? new Date(started).toLocaleDateString("it-IT") : "Data non disponibile") +
        " · " + correct + "/" + total + " risposte corrette · " + score + "%";
      details.append(title, detail);
      const status = document.createElement("strong");
      status.className = "dashboard-history-status";
      const state = attempt.status || "completed";
      if (state === "aborted") {
        status.textContent = "Interrotto";
        status.classList.add("aborted");
      } else if (state === "in_progress") {
        status.textContent = "In corso";
      } else if (attempt.passed) {
        status.textContent = "Superato";
      } else {
        status.textContent = "Da ripetere";
        status.classList.add("failed");
      }
      row.append(details, status);
      history.append(row);
    }
  }
}

function nextExamQuestion() {
  if (!currentExamCard || !examAnswered || isSavingExamAnswer) return;
  if (examQuestionIndex + 1 >= examTotalQuestions) {
    void finishRepertoireExam(false);
    return;
  }
  examQuestionIndex += 1;
  openNextExamQuestion();
}

function renderExamPanel() {
  const active = $("#exam-active");
  if (!active) return;
  active.hidden = mode !== "exam" || !currentExamCard;
  if (!currentExamCard) return;
  const side = currentExamCard.side === "white" ? "Bianco" : "Nero";
  $("#exam-question-meta").textContent = (currentExamCard.repertoireTitle || "Repertorio") +
    " · " + side + " · domanda " + (examQuestionIndex + 1) + "/" + examTotalQuestions;
  $("#exam-feedback").textContent = examFeedback || "Trova la mossa prevista in questa posizione.";
  const next = $("#exam-next");
  next.hidden = !examAnswered;
  next.textContent = examQuestionIndex + 1 >= examTotalQuestions ? "Concludi esame" : "Domanda successiva";
  next.disabled = isSavingExamAnswer;
}

async function saveDashboardGoals(event) {
  event.preventDefault();
  try {
    const targetAccuracy = Number($("#goal-target-accuracy").value);
    const goals = [
      normalizeStudyGoal({
        period: "daily",
        targetReviews: $("#goal-daily-reviews").value,
        targetMinutes: $("#goal-daily-minutes").value,
        targetAccuracy,
      }),
      normalizeStudyGoal({
        period: "weekly",
        targetReviews: $("#goal-weekly-reviews").value,
        targetMinutes: $("#goal-weekly-minutes").value,
        targetAccuracy,
      }),
    ];
    for (const goal of goals) {
      if (persistenceMode === "sqlite") {
        const saved = await invoke("save_study_goal", { input: goal });
        studyGoals = studyGoals.filter((entry) => entry.period !== saved.period).concat(saved);
      } else {
        studyGoals = studyGoals.filter((entry) => entry.period !== goal.period).concat(goal);
      }
    }
    if (persistenceMode !== "sqlite" && !persistLocalReviewState()) return;
    $("#dashboard-goal-status").textContent = "Obiettivi aggiornati.";
    renderAll();
  } catch (error) {
    $("#dashboard-goal-status").textContent = "Errore nel salvataggio: " + error.message;
  }
}

async function startRepertoireExam(event) {
  event.preventDefault();
  if (!databaseReady || !repertoire.length) {
    showToast("Salva almeno un repertorio prima di avviare un esame.");
    return;
  }
  if (examAttemptId) {
    showToast("Concludi prima l'esame in corso.");
    return;
  }
  const repertoireId = $("#exam-repertoire").value;
  const line = repertoire.find((entry) => entry.id === repertoireId);
  if (!line) {
    showToast("Seleziona un repertorio valido.");
    return;
  }
  const side = $("#exam-side").value;
  const count = Number($("#exam-count").value);
  const threshold = Number($("#exam-pass-threshold").value);
  if (!Number.isInteger(count) || count < 1 || count > 500 ||
      !Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
    showToast("Numero di domande o soglia non validi.");
    return;
  }
  const availableCards = buildReviewCards([line], studyCards, new Date());
  const questions = selectExamQuestions(availableCards, { repertoireId, side, count });
  if (!questions.length) {
    showToast("Il repertorio non contiene mosse per il lato scelto.");
    return;
  }

  const now = new Date();
  const id = globalThis.crypto?.randomUUID?.() ?? "exam-" + Date.now();
  const attempt = {
    id,
    repertoireId,
    repertoireTitle: line.title || "Linea senza nome",
    startedAt: now.toISOString(),
    finishedAt: null,
    totalQuestions: questions.length,
    correctCount: 0,
    passThreshold: threshold,
    passed: false,
    side,
    status: "in_progress",
  };
  try {
    if (persistenceMode === "sqlite") {
      await invoke("start_exam", {
        input: {
          id,
          repertoireId,
          repertoireTitle: attempt.repertoireTitle,
          startedAt: attempt.startedAt,
          totalQuestions: attempt.totalQuestions,
          passThreshold: threshold,
          side,
        },
      });
    } else {
      examAttempts = [attempt, ...examAttempts];
      if (!persistLocalReviewState()) return;
    }
  } catch (error) {
    showToast("Non riesco ad avviare l'esame: " + error.message);
    return;
  }

  examAttemptId = id;
  examQueue = [...questions];
  examQuestionIndex = 0;
  examTotalQuestions = questions.length;
  examCorrectCount = 0;
  examPassThreshold = threshold;
  examAnswered = false;
  examFeedback = "";
  examLastMove = null;
  mode = "exam";
  selectedSquare = null;
  openNextExamQuestion();
  if (questions.length < count) {
    showToast("Esame avviato con " + questions.length + " domande disponibili nel repertorio.");
  }
}

function openNextExamQuestion() {
  currentExamCard = examQueue.shift() || null;
  examAnswered = false;
  examFeedback = "";
  examLastMove = null;
  selectedSquare = null;
  if (!currentExamCard) {
    void finishRepertoireExam(false);
    return;
  }
  trainingGame = new Chess(currentExamCard.fen);
  boardFlipped = currentExamCard.side === "black";
  renderAll();
}

async function recordExamMove(selectedMove) {
  if (!currentExamCard || examAnswered || isSavingExamAnswer) return;
  isSavingExamAnswer = true;
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
  selectedSquare = null;
  if (!played) {
    isSavingExamAnswer = false;
    renderBoard();
    showToast("Mossa non legale.");
    return;
  }

  const selectedUci = played.from + played.to + (played.promotion || "");
  const correct = selectedUci === currentExamCard.uci;
  let displayedMove = played;
  if (!correct) {
    trainingGame.undo();
    try {
      displayedMove = trainingGame.move(parseUci(currentExamCard.uci));
    } catch (error) {
      isSavingExamAnswer = false;
      showToast("Non riesco a mostrare la soluzione: " + error.message);
      return;
    }
  }

  const answer = {
    id: globalThis.crypto?.randomUUID?.() ?? "answer-" + Date.now(),
    attemptId: examAttemptId,
    questionIndex: examQuestionIndex,
    edgeId: currentExamCard.edgeId,
    positionFen: currentExamCard.fen,
    expectedUci: currentExamCard.uci,
    selectedUci,
    correct,
    answeredAt: new Date().toISOString(),
  };
  try {
    if (persistenceMode === "sqlite") {
      await invoke("record_exam_answer", {
        input: {
          id: answer.id,
          attemptId: answer.attemptId,
          questionIndex: answer.questionIndex,
          edgeId: answer.edgeId,
          positionFen: answer.positionFen,
          expectedUci: answer.expectedUci,
          selectedUci: answer.selectedUci,
          answeredAt: answer.answeredAt,
        },
      });
      const attempt = examAttempts.find((entry) => entry.id === examAttemptId);
      if (attempt) attempt.correctCount = Number(attempt.correctCount || 0) + (correct ? 1 : 0);
    } else {
      const nextAnswers = [...examAnswers, answer];
      const nextAttempts = examAttempts.map((attempt) => attempt.id === examAttemptId
        ? { ...attempt, correctCount: Number(attempt.correctCount || 0) + (correct ? 1 : 0) }
        : attempt);
      const previousAnswers = examAnswers;
      const previousAttempts = examAttempts;
      examAnswers = nextAnswers;
      examAttempts = nextAttempts;
      if (!persistLocalReviewState()) {
        examAnswers = previousAnswers;
        examAttempts = previousAttempts;
        trainingGame.undo();
        isSavingExamAnswer = false;
        renderAll();
        return;
      }
    }
  } catch (error) {
    // Revert the tentative answer so the player can safely retry after a storage error.
    trainingGame.undo();
    isSavingExamAnswer = false;
    renderAll();
    showToast("Non riesco a registrare la risposta: " + error.message);
    return;
  }

  if (correct) examCorrectCount += 1;
  examAnswered = true;
  examLastMove = displayedMove;
  examFeedback = correct
    ? "Risposta corretta: " + displayedMove.san + "."
    : "Risposta errata. La mossa prevista era " + displayedMove.san + ".";
  isSavingExamAnswer = false;
  renderAll();
}

async function finishRepertoireExam(aborted = false) {
  if (!examAttemptId) return;
  const attemptId = examAttemptId;
  const finishedAt = new Date().toISOString();
  const result = calculateExamResult(
    Array.from({ length: examTotalQuestions }, (_, index) => ({ correct: index < examCorrectCount })),
    examPassThreshold,
  );
  try {
    if (persistenceMode === "sqlite") {
      await invoke("finish_exam", {
        input: { id: attemptId, finishedAt, aborted },
      });
      examAttempts = await invoke("list_exam_attempts");
    } else {
      examAttempts = examAttempts.map((entry) => entry.id === attemptId ? {
        ...entry,
        finishedAt,
        correctCount: result.correct,
        passed: !aborted && result.passed,
        status: aborted ? "aborted" : "completed",
      } : entry);
      persistLocalReviewState();
    }
  } catch (error) {
    showToast("Non riesco a salvare la chiusura dell'esame: " + error.message);
  }
  examAttemptId = null;
  examQueue = [];
  currentExamCard = null;
  examAnswered = false;
  examLastMove = null;
  trainingGame = null;
  mode = "dashboard";
  renderAll();
  if (aborted) showToast("Esame interrotto. Il tentativo resta nello storico.");
  else showToast(result.passed
    ? "Esame superato: " + result.accuracy + "%."
    : "Esame concluso: " + result.accuracy + "%. Da ripetere.");
}

function leaveExam() {
  if (examAttemptId) void finishRepertoireExam(true);
  else {
    mode = "dashboard";
    renderAll();
  }
}

async function showStudio() {
  if (mode === "training") leaveTraining();
  if (mode === "exam" && examAttemptId) {
    await finishRepertoireExam(true);
  }
  mode = "studio";
  renderAll();
}

function showDashboard() {
  if (mode === "training") leaveTraining();
  if (mode === "exam" && examAttemptId) {
    leaveExam();
    return;
  }
  mode = "dashboard";
  renderAll();
}

function leaveTraining() {
  if (reviewSessionId && !reviewSessionFinished) {
    void markReviewSessionFinished().catch((error) => {
      showToast("Non riesco a chiudere la sessione: " + error.message);
    });
  }
  mode = "studio";
  trainingGame = null;
  trainingMoves = [];
  trainingIndex = 0;
  reviewQueue = [];
  currentReviewCard = null;
  reviewSessionId = null;
  reviewSessionFinished = false;
  selectedSquare = null;
  closePromotionChooser();
  renderAll();
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
  const pgn = mode !== "studio" || !studioTree.edges.size ? "" : timelinePgn();
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
  URL.revokeObjectURL(url);
  showToast("File PGN esportato.");
}

function newPosition() {
  if (mode === "exam") {
    leaveExam();
    return;
  }
  if (mode === "dashboard") {
    mode = "studio";
  }
  if (mode === "training") {
    leaveTraining();
    return;
  }
  if (!confirmDiscardChanges("iniziare una nuova linea")) return;
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
void initializePersistence();
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

$("#open-online-import").addEventListener("click", openOnlineImportDialog);
$("#import-online-games-sidebar").addEventListener("click", openOnlineImportDialog);
$("#online-provider").addEventListener("change", updateOnlineImportProvider);
$("#start-online-import").addEventListener("click", () => { void startOnlineGameImport(); });
$("#cancel-online-import").addEventListener("click", closeOnlineImportDialog);
$("#online-import-dialog").addEventListener("click", (event) => {
  if (event.target === $("#online-import-dialog")) closeOnlineImportDialog();
});
$("#nav-dashboard").addEventListener("click", showDashboard);
$("#nav-studio").addEventListener("click", () => {
  if (mode === "training") {
    leaveTraining();
  } else if (mode === "exam" && examAttemptId) {
    void finishRepertoireExam(true).then(() => { mode = "studio"; renderAll(); });
  } else {
    mode = "studio";
    renderAll();
  }
});
$("#nav-training").addEventListener("click", () => startTraining());
$("#dashboard-goals-form").addEventListener("submit", (event) => { void saveDashboardGoals(event); });
$("#dashboard-exam-form").addEventListener("submit", (event) => { void startRepertoireExam(event); });
$("#exam-next").addEventListener("click", nextExamQuestion);
$("#review-side").addEventListener("change", renderReviewPanel);
$("#review-start").addEventListener("click", () => { void beginDailyReviewSession(); });
$("#review-show-answer").addEventListener("click", showReviewAnswer);
$("#review-quick-again").addEventListener("click", () => { void rateCurrentCard("again"); });
document.querySelectorAll("#review-grades [data-rating]").forEach((button) => {
  button.addEventListener("click", () => { void rateCurrentCard(button.dataset.rating); });
});
$("#review-exit").addEventListener("click", leaveTraining);
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
  if (event.key === "Escape" && !$("#online-import-dialog").hidden) {
    closeOnlineImportDialog();
    return;
  }
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
void initializePersistence();