import { Chess } from "chess.js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { classifyBoardMove } from "./board-input.js";
import { listenForOptionalImportProgress } from "./online-import-progress.js";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { RepertoireTree } from "./repertoire-tree.js";
import { initializeChessSuite } from "./chess-suite.js";
import { initializeExtendedTraining } from "./extended-training.js";
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
import { getAdjacentSquare } from "./board-navigation.js";
import { applyUiPreferences, readUiPreferences, saveUiPreferences } from "./ui-preferences.js";

const STORAGE_KEY = "chess-os.repertoire.v1";
const REVIEW_STORAGE_KEY = "chess-os.fsrs.review-state.v1";
const DEFAULT_FEN = new Chess().fen();
const uiPreferences = readUiPreferences();
applyUiPreferences(uiPreferences);
const PIECE_NAMES = { k: "Re", q: "Donna", r: "Torre", b: "Alfiere", n: "Cavallo", p: "Pedone" };
const files = "abcdefgh";
const symbols = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟︎" },
};
const promotionNames = { q: "Donna", r: "Torre", b: "Alfiere", n: "Cavallo" };

let game = new Chess();
let mode = "studio";
let chessSuite = null;
let engineEnabled = localStorage.getItem("chess-os.engine.enabled") !== "false";
let engineTimer = null;
let engineFenPending = "";
let extendedTraining = null;
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
let gameLibraryRecords = [];
let gameLibraryPage = 0;
let gameLibraryTotal = 0;
let gameLibraryRequest = 0;
let gameAnalysisResults = [];
let gameAnalysisBusy = false;
let opponentReportBusy = false;
let opponentReportGames = [];
let onlineImportBusy = false;
let databaseBackups = [];
let verifiedBackups = new Set();
let backupsBusy = false;
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
let lineTrainingActive = false;
let lineTrainingSteps = [];
let lineTrainingPly = 0;
let lineTrainingSide = "both";
let lineTurnStartedAt = 0;
let lineTrainingThinkingMs = 0;
let lineTrainingSummary = "";
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
let pointerBoardGesture = null;
let suppressNextBoardClick = false;
let fenEditorState = null;
let pendingBoardFocusSquare = null;
let promotionReturnFocus = null;
let onlineImportReturnFocus = null;
let fenEditorReturnFocus = null;
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
    showToast("Non riesco a salvare: memoria locale non disponibile.", { type: "error" });
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
    showToast("Non riesco a salvare lo storico FSRS nella memoria locale.", { type: "error" });
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

async function ensureDemoOpenings() {
  const demos = [
    { id: "demo-opening-caro-kann", family: "Caro-Kann Defense", title: "Caro-Kann · Demo" },
    { id: "demo-opening-italian-game", family: "Italian Game", title: "Partita Italiana · Demo" },
  ];
  const existingIds = new Set(repertoire.map((entry) => entry.id));
  let browserChanged = false;
  for (const demo of demos) {
    if (existingIds.has(demo.id)) continue;
    const preset = createOpeningPreset(demo.family);
    const now = new Date().toISOString();
    const entry = {
      id: demo.id,
      title: demo.title,
      pgn: preset.tree.toPgn({ Event: demo.title, Opening: demo.family }),
      sans: preset.tree.mainlinePath().map((edgeId) => preset.tree.getEdge(edgeId).san),
      edgeCount: preset.tree.edges.size,
      nodeCount: preset.tree.nodes.size,
      createdAt: now,
      updatedAt: now,
      tree: preset.tree.toJSON(),
    };
    if (persistenceMode === "sqlite") {
      await invoke("save_repertoire", { input: repertoirePayload(entry, preset.tree) });
    } else {
      repertoire = [entry, ...repertoire];
      browserChanged = true;
    }
    existingIds.add(demo.id);
  }
  if (browserChanged && !persistRepertoire()) {
    throw new Error("Impossibile salvare i due repertori demo nel browser.");
  }
  if (persistenceMode === "sqlite" && demos.some((demo) => !repertoire.some((entry) => entry.id === demo.id))) {
    repertoire = await invoke("list_repertoires");
  }
}

async function initializePersistence() {
  if (persistenceMode !== "sqlite") {
    updateStorageLabel("Anteprima browser", "In questa modalità i dati sono salvati nella memoria del browser.");
    await loadStudyData();
    await ensureDemoOpenings();
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
    await ensureDemoOpenings();
    records = repertoire;
    try {
      await refreshImportedGames();
    } catch (error) {
      // Imported games are optional; keep the repertoire/SQLite app usable.
      importedGames = [];
      console.error("Libreria delle partite importate non disponibile:", error);
    }
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
    showToast("Errore database SQLite: " + error.message, { type: "error" });
  }
}

function activeGame() {
  return (mode === "training" || mode === "exam") && trainingGame ? trainingGame : game;
}

function hideToast() {
  const toast = $("#toast");
  toast.classList.remove("visible");
  window.clearTimeout(toastTimer);
  toastTimer = null;
}

function showToast(message, options = {}) {
  const toast = $("#toast");
  const content = $("#toast-message");
  const type = ["success", "info", "warning", "error"].includes(options.type)
    ? options.type
    : "info";
  content.textContent = String(message);
  toast.classList.remove("success", "info", "warning", "error");
  toast.classList.add(type, "visible");
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
  window.clearTimeout(toastTimer);
  const duration = type === "error" ? 10000 : type === "warning" ? 5000 : 2800;
  toastTimer = window.setTimeout(hideToast, duration);
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
    showToast("Non riesco a ripristinare questa posizione.", { type: "error" });
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

function schedulePositionAnalysis() {
  const button = $("#toggle-engine");
  const bar = $("#evaluation-bar");
  if (button) {
    button.setAttribute("aria-pressed", String(engineEnabled));
    button.textContent = engineEnabled ? "Disattiva" : "Attiva";
  }
  if (bar) bar.classList.toggle("engine-disabled", !engineEnabled);
  if (!engineEnabled || mode !== "studio" || !chessSuite?.analyzePosition) {
    if (engineTimer) clearTimeout(engineTimer);
    engineTimer = null;
    return;
  }
  const fen = activeGame().fen();
  if (fen === engineFenPending) return;
  engineFenPending = fen;
  if (engineTimer) clearTimeout(engineTimer);
  engineTimer = setTimeout(async () => {
    try {
      const result = await chessSuite.analyzePosition(fen, 14, 1);
      if (!engineEnabled || mode !== "studio" || activeGame().fen() !== fen) return;
      const whiteScore = result.mate === null ? (result.scoreCp || 0) / 100 : Math.sign(result.mate) * (10 - Math.min(9, Math.abs(result.mate)));
      const whiteView = fen.split(" ")[1] === "w" ? whiteScore : -whiteScore;
      const capped = Math.max(-8, Math.min(8, whiteView));
      const whitePercent = 50 + 50 * (2 / (1 + Math.exp(-0.65 * capped)) - 1);
      $("#evaluation-bar-white").style.height = whitePercent + "%";
      $("#engine-evaluation").textContent = result.mate === null
        ? (whiteView > 0 ? "+" : "") + whiteView.toFixed(2)
        : "#" + Math.abs(result.mate);
      $("#evaluation-bar").setAttribute("aria-label", "Valutazione Stockfish " + $("#engine-evaluation").textContent);
      $("#current-analysis").textContent = `Profondita ${result.depth} | migliore ${result.bestSan || result.bestmove || "-"} | variante ${(result.pvSan || []).join(" ") || "-"}`;
    } catch (error) {
      engineFenPending = "";
      if (activeGame().fen() === fen && /busy|impegnato|occupato/i.test(error.message)) {
        engineTimer = setTimeout(schedulePositionAnalysis, 700);
      } else if (activeGame().fen() === fen) $("#current-analysis").textContent = "Stockfish non disponibile: " + error.message;
    }
  }, 300);
}

function renderBoard() {
  const previouslyFocusedSquare = document.activeElement
    ?.closest?.("button[data-square]")?.dataset.square || null;
  const focusSquare = pendingBoardFocusSquare || previouslyFocusedSquare || selectedSquare
    || (boardFlipped ? "h1" : "a8");
  const shouldRestoreFocus = Boolean(pendingBoardFocusSquare || previouslyFocusedSquare);
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
  boardElement.setAttribute("role", "group");
  boardElement.setAttribute("aria-label", "Scacchiera. Usa le frecce per spostare il focus tra le case; Invio o Spazio per selezionare.");
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
      button.tabIndex = square === focusSquare ? 0 : -1;
      button.draggable = Boolean(piece && piece.color === chess.turn());
      button.className = "square " + (isLight ? "light" : "dark");
      button.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space");
      if (selectedSquare === square) button.classList.add("selected");
      if (lastSquares.has(square)) button.classList.add("last-move");
      if (checkedKingSquare === square) button.classList.add("in-check");
      if (legalTargets.has(square)) button.classList.add(piece ? "capture-target" : "legal-target");

      if (piece) {
        const pieceSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        pieceSvg.setAttribute("class", "piece " + (piece.color === "w" ? "white-piece" : "black-piece"));
        pieceSvg.setAttribute("viewBox", "0 0 45 45");
        pieceSvg.setAttribute("aria-hidden", "true");
        pieceSvg.setAttribute("focusable", "false");
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "#piece-" + piece.color + piece.type);
        pieceSvg.append(use);
        button.append(pieceSvg);
        button.setAttribute("aria-label", PIECE_NAMES[piece.type] + (piece.color === "w" ? " bianco" : " nero") + " in " + square);
      } else {
        button.setAttribute("aria-label", "Casa vuota " + square);
      }

      if (uiPreferences.coordinates === "inside") {
        if (displayRow === 7) {
          const fileCoordinate = document.createElement("span");
          fileCoordinate.className = "board-coordinate coordinate-file";
          fileCoordinate.textContent = square[0];
          fileCoordinate.setAttribute("aria-hidden", "true");
          button.append(fileCoordinate);
        }
        if (displayCol === 0) {
          const rankCoordinate = document.createElement("span");
          rankCoordinate.className = "board-coordinate coordinate-rank";
          rankCoordinate.textContent = square[1];
          rankCoordinate.setAttribute("aria-hidden", "true");
          button.append(rankCoordinate);
        }
      }
      boardElement.append(button);
    }
  }

  pendingBoardFocusSquare = null;
  if (shouldRestoreFocus) {
    boardElement.querySelector('[data-square="' + focusSquare + '"]')
      ?.focus({ preventScroll: true });
  }

  renderBoardMarkings();
  schedulePositionAnalysis();
  $("#turn-label").textContent = (chess.turn() === "w" ? "Bianco" : "Nero") + " al tratto";
  $("#game-status").textContent = gameStatus(chess);
  const currentCount = mode === "training" ? (lineTrainingActive ? lineTrainingPly : reviewCompleted) : mode === "exam" ? examQuestionIndex + (examAnswered ? 1 : 0) : studioPly;
  const totalCount = mode === "training" ? reviewSessionTotal : mode === "exam" ? examTotalQuestions : studioSans.length;
  $("#move-count").textContent = mode === "studio"
    ? currentCount + " / " + totalCount + " semimosse"
    : currentCount + " / " + totalCount + " domande";
  $("#line-move-count").textContent = mode === "training"
    ? (lineTrainingActive ? "Linea completa · " + lineTrainingPly + "/" + lineTrainingSteps.length + " semimosse" : currentReviewCard ? currentReviewCard.repertoireTitle + " · " + currentReviewCard.side : "Sessione giornaliera")
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
  const backups = mode === "backups";
  const review = mode === "review";
  const endgame = mode === "endgame";
  const boardWorkspace = ["studio", "training", "exam"].includes(mode);
  const navModes = [["nav-studio", mode === "studio"], ["nav-training", training], ["nav-dashboard", dashboard], ["nav-backups", backups], ["nav-review", review], ["nav-endgame", endgame]];
  for (const [id, active] of navModes) { const item = $("#" + id); item.classList.toggle("active", active); item.setAttribute("aria-current", active ? "page" : "false"); }
  $("#mode-eyebrow").textContent = dashboard ? "ATTIVIT? / STATISTICHE" : backups ? "SISTEMA / PROTEZIONE DATI" : training ? "REPERTORIO / RIPASSO FSRS" : exam ? "REPERTORIO / ESAME" : review ? "PARTITE / ANALISI" : endgame ? "ALLENAMENTO / FINALI" : "REPERTORIO / ANALISI";
  $("#page-title").textContent = dashboard ? "Dashboard e progressi" : backups ? "Protezione dei dati" : training ? "Ripasso giornaliero" : exam ? "Esame del repertorio" : review ? "Revisione delle partite" : endgame ? "Endgame Lab" : "Chess Studio";
  $("#page-subtitle").textContent = dashboard ? "Controlla i progressi, gli obiettivi e la preparazione dei tuoi repertori." : backups ? "Crea copie complete, verifica l?integrit? e ripristina i tuoi dati." : training ? "Allena il richiamo delle mosse con intervalli adattivi." : exam ? "Verifica quanto ricordi senza aiuti e registra il risultato." : review ? "Analizza le tue partite, trova le debolezze e prepara le prossime mosse." : endgame ? "Studia i finali con lezioni progressive e pratica guidata." : "Costruisci linee principali, varianti e transposizioni.";
  $("#heading-actions").hidden = !boardWorkspace || exam;
  $("#study-grid").hidden = !boardWorkspace;
  $("#dashboard-panel").hidden = !dashboard;
  $("#backup-panel").hidden = !backups;
  $("#save-line").disabled = mode !== "studio" || !databaseReady;
  $("#board-mark-tool").disabled = training;
  $("#board-mark-color").disabled = training;
  $("#clear-board-marks").disabled = training;
  $("#reset").textContent = training ? "Esci dal ripasso" : exam ? "Interrompi esame" : "Nuova posizione";
  for (const selector of ["#line-card", "#moves-card", "#variations-card", "#import-card"]) $(selector).hidden = mode !== "studio";
  $("#review-panel").hidden = !training;
  $("#exam-panel").hidden = !exam;
  $("#chess-lab-tools").hidden = mode !== "studio";
  $("#review-workspace").hidden = !review;
  $("#endgame-panel").hidden = !endgame;
  $("#flip-board").disabled = dashboard || backups || review || endgame;
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
    showToast("Impossibile aprire la variante: " + error.message, { type: "error" });
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
  fenEditorReturnFocus = document.activeElement;
  if (mode === "training") {
    showToast("Esci dall'allenamento per modificare la posizione.", { type: "warning" });
    return;
  }
  try {
    fenEditorState = fenToEditorState(game.fen());
    fenSelectedPiece = "wP";
    renderFenPalette();
    renderFenEditorBoard();
    syncFenEditorFields();
    $("#fen-editor-dialog").hidden = false;
    $("#fen-editor-close").focus({ preventScroll: true });
  } catch (error) {
    showToast("Impossibile aprire l'editor FEN: " + error.message, { type: "error" });
  }
}

function closeFenEditor(restoreFocus = true) {
  $("#fen-editor-dialog").hidden = true;
  if (restoreFocus && fenEditorReturnFocus instanceof HTMLElement && fenEditorReturnFocus.isConnected) {
    fenEditorReturnFocus.focus({ preventScroll: true });
  }
  fenEditorReturnFocus = null;
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
    closeFenEditor();
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
    showToast("Impossibile caricare il repertorio: " + error.message, { type: "error" });
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
  renderBackupList();
  extendedTraining?.refresh();
}

function renderImportedGames() {
  const list = $("#imported-games-list");
  if (!list) return;
  renderGameAnalysisChoices();
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

function renderGameAnalysisChoices() {
  const select = $("#analysis-game-select");
  if (!select) return;
  const selectedId = select.value;
  select.replaceChildren(new Option("Seleziona una partita importata", ""));
  for (const record of importedGames.slice(0, 10)) {
    const label = [record.playedAt, (record.white || "Bianco") + " – " + (record.black || "Nero"), record.result].filter(Boolean).join(" · ");
    select.append(new Option(label, record.id));
  }
  if (importedGames.some((record) => record.id === selectedId)) select.value = selectedId;
}

function renderGameLibrary() {
  const list = $("#game-library-list");
  if (!list) return;
  list.replaceChildren();
  const pageSize = 50;
  $("#game-library-summary").textContent = `${gameLibraryTotal.toLocaleString("it-IT")} ${gameLibraryTotal === 1 ? "partita" : "partite"}`;
  $("#game-library-page-label").textContent = gameLibraryTotal
    ? `Pagina ${gameLibraryPage + 1} · ${gameLibraryRecords.length} mostrate`
    : "Nessuna partita";
  $("#game-library-previous").disabled = gameLibraryPage === 0;
  $("#game-library-next").disabled = (gameLibraryPage + 1) * pageSize >= gameLibraryTotal;
  if (!gameLibraryRecords.length) {
    const empty = document.createElement("p");
    empty.className = "game-library-empty";
    empty.textContent = persistenceMode === "sqlite" ? "Nessuna partita corrisponde ai filtri." : "Archivio disponibile nell'app desktop.";
    list.append(empty);
    return;
  }
  for (const record of gameLibraryRecords) {
    const row = document.createElement("article");
    row.className = "game-library-row";
    const details = document.createElement("div");
    details.className = "game-library-details";
    const title = document.createElement("strong");
    title.textContent = `${record.white || "Bianco"} – ${record.black || "Nero"}`;
    const subtitle = document.createElement("span");
    subtitle.textContent = [record.playedAt || "Data non disponibile", record.opening || "Apertura non classificata", record.result, record.provider === "lichess" ? "Lichess" : "Chess.com", record.sourceUsername].filter(Boolean).join(" · ");
    details.append(title, subtitle);
    const actions = document.createElement("div");
    actions.className = "game-library-actions";
    const open = document.createElement("button");
    open.type = "button"; open.className = "button small ghost"; open.textContent = "Apri";
    open.addEventListener("click", () => { void openImportedGame(record.id); });
    const analyze = document.createElement("button");
    analyze.type = "button"; analyze.className = "button small primary"; analyze.textContent = "Analizza";
    analyze.addEventListener("click", () => { void runImportedGameAnalysis([record]); });
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "button small ghost"; remove.textContent = "Rimuovi";
    remove.addEventListener("click", () => { void removeImportedGame(record.id, record); });
    actions.append(open, analyze, remove);
    row.append(details, actions);
    list.append(row);
  }
}

async function loadGameLibrary(resetPage = false) {
  if (!$("#game-library-list")) return;
  if (resetPage) gameLibraryPage = 0;
  const request = ++gameLibraryRequest;
  if (persistenceMode !== "sqlite" || !databaseReady) {
    gameLibraryRecords = [];
    gameLibraryTotal = 0;
    $("#game-library-status").textContent = "Apri ChessOS come app desktop per consultare l'archivio locale.";
    renderGameLibrary();
    return;
  }
  $("#game-library-status").textContent = "Carico le partite…";
  $("#game-library-search").disabled = true;
  try {
    const page = await invoke("search_imported_games", {
      query: $("#game-library-query").value.trim(),
      provider: $("#game-library-provider").value,
      username: $("#game-library-username").value.trim(),
      limit: 50,
      offset: gameLibraryPage * 50,
    });
    if (request !== gameLibraryRequest) return;
    gameLibraryRecords = page.games || [];
    gameLibraryTotal = page.total || 0;
    $("#game-library-status").textContent = `${gameLibraryTotal.toLocaleString("it-IT")} partite nell'archivio per i filtri selezionati.`;
    renderGameLibrary();
  } catch (error) {
    if (request !== gameLibraryRequest) return;
    gameLibraryRecords = [];
    gameLibraryTotal = 0;
    $("#game-library-status").textContent = "Non riesco a leggere l'archivio: " + (error?.message || String(error));
    renderGameLibrary();
  } finally {
    if (request === gameLibraryRequest) $("#game-library-search").disabled = false;
  }
}

async function exportGameLibraryPgn() {
  const button = $("#game-library-export");
  button.disabled = true;
  try {
    const pgn = await invoke("export_imported_games_pgn", {
      query: $("#game-library-query").value.trim(),
      provider: $("#game-library-provider").value,
      username: $("#game-library-username").value.trim(),
    });
    const url = URL.createObjectURL(new Blob([pgn + "\n"], { type: "application/x-chess-pgn;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "chess-os-partite-" + new Date().toISOString().slice(0, 10) + ".pgn";
    document.body.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("#game-library-status").textContent = "PGN esportato con i filtri selezionati.";
  } catch (error) {
    $("#game-library-status").textContent = "Esportazione non riuscita: " + (error?.message || String(error));
  } finally { button.disabled = false; }
}

function playerArchiveProfile(playerName) {
  const games = importedGames.filter((game) => game.white === playerName || game.black === playerName);
  const totals = { games: games.length, wins: 0, draws: 0, losses: 0 };
  for (const game of games) {
    if (game.result === "1/2-1/2") totals.draws += 1;
    else if ((game.white === playerName && game.result === "1-0") || (game.black === playerName && game.result === "0-1")) totals.wins += 1;
    else if (game.result === "1-0" || game.result === "0-1") totals.losses += 1;
  }
  return totals;
}

function addText(parent, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function renderGameReplay(article, moves) {
  if (!moves.length) return;
  const replay = document.createElement("div");
  replay.className = "game-replay";
  const board = document.createElement("div");
  board.className = "game-replay-board";
  board.setAttribute("role", "img");
  board.setAttribute("aria-label", "Scacchiera della revisione partita");
  const controls = document.createElement("div");
  controls.className = "game-replay-controls";
  const previous = addText(controls, "button", "button small ghost", "← Precedente");
  const positionLabel = addText(controls, "span", "game-replay-position", "Posizione iniziale");
  const next = addText(controls, "button", "button small ghost", "Successiva →");
  previous.type = next.type = "button";
  const notation = addText(replay, "p", "game-replay-notation", "");
  replay.append(board, controls, notation);
  article.append(replay);
  let currentPly = 0;
  const draw = () => {
    const fen = currentPly === 0 ? moves[0].beforeFen : moves[currentPly - 1].afterFen;
    const ranks = String(fen || "").split(/\s+/)[0].split("/");
    const pieces = { k:"♚", q:"♛", r:"♜", b:"♝", n:"♞", p:"♟", K:"♔", Q:"♕", R:"♖", B:"♗", N:"♘", P:"♙" };
    board.replaceChildren();
    ranks.forEach((rank, rowIndex) => {
      let fileIndex = 0;
      for (const symbol of rank) {
        const count = /\d/.test(symbol) ? Number(symbol) : 1;
        for (let cell = 0; cell < count; cell += 1) {
          const square = document.createElement("span");
          square.className = `game-replay-square ${(rowIndex + fileIndex) % 2 ? "light" : "dark"}`;
          if (cell === 0 && count === 1) {
            square.textContent = pieces[symbol] || "";
            square.classList.add(symbol === symbol.toUpperCase() ? "white-piece" : "black-piece");
          }
          board.append(square);
          fileIndex += 1;
        }
      }
    });
    const last = currentPly ? moves[currentPly - 1] : null;
    const upcoming = moves[currentPly];
    positionLabel.textContent = last ? `Dopo ${last.moveNumber}${last.color === "white" ? "." : "…"} ${last.san}` : "Posizione iniziale";
    notation.textContent = upcoming ? `Mossa successiva: ${upcoming.moveNumber}${upcoming.color === "white" ? "." : "…"} ${upcoming.san}` : "Fine partita";
    previous.disabled = currentPly === 0;
    next.disabled = currentPly >= moves.length;
    article.querySelectorAll(".game-move-row").forEach((row) => row.classList.toggle("selected", Number(row.dataset.ply) === currentPly - 1));
  };
  previous.addEventListener("click", () => { currentPly = Math.max(0, currentPly - 1); draw(); });
  next.addEventListener("click", () => { currentPly = Math.min(moves.length, currentPly + 1); draw(); });
  article.addEventListener("click", (event) => {
    const row = event.target.closest(".game-move-row");
    if (!row || !article.contains(row)) return;
    currentPly = Number(row.dataset.ply) + 1;
    draw();
  });
  article.addEventListener("keydown", (event) => {
    const row = event.target.closest(".game-move-row");
    if (!row || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    currentPly = Number(row.dataset.ply) + 1;
    draw();
  });
}

function renderGameAnalysisReports() {
  const container = $("#game-analysis-report");
  container.replaceChildren();
  for (const { record, analysis } of gameAnalysisResults) {
    const article = document.createElement("article");
    article.className = "game-report-card";
    const whiteName = record.white || analysis.headers.White || "Bianco";
    const blackName = record.black || analysis.headers.Black || "Nero";
    addText(article, "h3", "game-report-title", `${whiteName} – ${blackName} · ${record.playedAt || "data non disponibile"}`);
    addText(article, "p", "game-report-caption", `${record.opening || analysis.headers.Opening || "Apertura non classificata"} · Risultato ${record.result || analysis.headers.Result || "*"} · Precisione stimata localmente a profondità 11`);

    const metrics = document.createElement("div");
    metrics.className = "game-report-metrics";
    for (const [side, name, summary] of [["Bianco", whiteName, analysis.white], ["Nero", blackName, analysis.black]]) {
      const metric = document.createElement("div");
      metric.className = "game-report-metric";
      addText(metric, "span", "", side + " · " + name);
      addText(metric, "strong", "", summary.accuracy === null ? "—" : summary.accuracy + "%");
      addText(metric, "small", "", `${summary.inaccuracies} imprecisioni · ${summary.mistakes} errori · ${summary.blunders} gravi`);
      metrics.append(metric);
    }
    article.append(metrics);

    addText(article, "h4", "game-report-section-title", "Fasi della partita");
    const phaseList = document.createElement("div");
    phaseList.className = "game-phase-list";
    for (const phase of analysis.phases) {
      const row = document.createElement("div");
      row.className = "game-phase-row";
      addText(row, "strong", "", phase.name);
      addText(row, "span", "", `Bianco ${phase.white.accuracy ?? "—"}% · Nero ${phase.black.accuracy ?? "—"}%`);
      phaseList.append(row);
    }
    article.append(phaseList);

    addText(article, "h4", "game-report-section-title", "Coach · momenti da rivedere");
    const coaching = document.createElement("ul");
    coaching.className = "game-coaching-list";
    if (!analysis.coaching.length) addText(coaching, "li", "", "Nessun calo significativo trovato a questa profondità.");
    for (const move of analysis.coaching) {
      const side = move.color === "white" ? whiteName : blackName;
      const label = move.lossCp >= 300 ? "Errore grave" : move.lossCp >= 100 ? "Errore" : "Imprecisione";
      addText(coaching, "li", "", `${side}, ${move.moveNumber}${move.color === "white" ? "." : "…"} ${move.san}: Stockfish preferiva ${move.bestSan}; perdita stimata ${(move.lossCp / 100).toFixed(2)}. Rivedi la variante ${move.pv.join(" ") || move.bestSan}. (${label})`);
    }
    article.append(coaching);

    addText(article, "h4", "game-report-section-title", "Profilo negli ultimi 15 importati");
    const profiles = document.createElement("div");
    profiles.className = "game-player-profiles";
    for (const name of [whiteName, blackName]) {
      const profile = playerArchiveProfile(name);
      addText(profiles, "p", "", `${name}: ${profile.games} partite · ${profile.wins} vittorie · ${profile.draws} patte · ${profile.losses} sconfitte`);
    }
    article.append(profiles);

    addText(article, "h4", "game-report-section-title", "Mossa per mossa");
    renderGameReplay(article, analysis.moves);
    const moveTable = document.createElement("div");
    moveTable.className = "game-move-table";
    for (const move of analysis.moves) {
      const row = document.createElement("div");
      row.className = "game-move-row" + (move.lossCp >= 50 ? " flagged" : "");
      const moveLabel = `${move.moveNumber}${move.color === "white" ? "." : "…"} ${move.san}`;
      row.dataset.ply = String(move.ply - 1);
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `Rivedi ${moveLabel}`);
      const label = move.lossCp >= 300 ? "Errore grave" : move.lossCp >= 100 ? "Errore" : move.lossCp >= 50 ? "Imprecisione" : "Buona";
      addText(row, "strong", "", moveLabel);
      addText(row, "span", "", `Migliore: ${move.bestSan}`);
      addText(row, "span", "", `${move.lossCp} cp · ${move.accuracy}% · ${label}`);
      moveTable.append(row);
    }
    article.append(moveTable);
    container.append(article);
  }
  $("#print-game-analysis").disabled = gameAnalysisResults.length === 0 || gameAnalysisBusy;
}

async function runImportedGameAnalysis(records) {
  if (gameAnalysisBusy || !records.length) return;
  if (!chessSuite?.analyzeImportedGame) {
    $("#game-analysis-status").textContent = "Stockfish non è pronto. Riprova tra qualche secondo.";
    return;
  }
  gameAnalysisBusy = true;
  gameAnalysisResults = [];
  const buttons = [$("#analyze-imported-game"), $("#analyze-latest-games")];
  buttons.forEach((button) => { button.disabled = true; });
  $("#print-game-analysis").disabled = true;
  $("#game-analysis-report").replaceChildren();
  try {
    for (const [gameIndex, summary] of records.entries()) {
      $("#game-analysis-status").textContent = `Carico la partita ${gameIndex + 1}/${records.length}: ${summary.white} – ${summary.black}…`;
      const record = await invoke("get_imported_game", { id: summary.id });
      const analysis = await chessSuite.analyzeImportedGame(record.pgn, (current, total) => {
        $("#game-analysis-status").textContent = `Partita ${gameIndex + 1}/${records.length} · analisi Stockfish ${current}/${total} semimosse…`;
      });
      gameAnalysisResults.push({ record, analysis });
      renderGameAnalysisReports();
    }
    $("#game-analysis-status").textContent = `${gameAnalysisResults.length} ${gameAnalysisResults.length === 1 ? "partita analizzata" : "partite analizzate"}. La precisione è una stima locale e può differire da Chess.com.`;
  } catch (error) {
    $("#game-analysis-status").textContent = "Analisi interrotta: " + (error?.message || String(error));
  } finally {
    gameAnalysisBusy = false;
    buttons.forEach((button) => { button.disabled = false; });
    renderGameAnalysisReports();
  }
}

function analyzeSelectedImportedGame() {
  const record = importedGames.find((game) => game.id === $("#analysis-game-select").value);
  if (!record) {
    $("#game-analysis-status").textContent = "Scegli una partita tra le ultime dieci importate.";
    return;
  }
  void runImportedGameAnalysis([record]);
}

function renderOpponentReport(games, username) {
  const root = $("#opponent-profile-report");
  root.replaceChildren();
  const normalizedName = username.trim().toLocaleLowerCase();
  const stats = { wins: 0, draws: 0, losses: 0, unknown: 0, white: 0, black: 0, whiteWins: 0, whiteGames: 0, blackWins: 0, blackGames: 0 };
  const openings = new Map(), months = new Map(), controls = new Map();
  const firstMoves = { white: new Map(), black: new Map() }, ratingMonths = new Map();
  for (const item of games) {
    const isWhite = item.white?.toLocaleLowerCase() === normalizedName;
    const isBlack = item.black?.toLocaleLowerCase() === normalizedName;
    if (!isWhite && !isBlack) { stats.unknown += 1; continue; }
    if (isWhite) { stats.white += 1; stats.whiteGames += 1; } else { stats.black += 1; stats.blackGames += 1; }
    const won = (isWhite && item.result === "1-0") || (isBlack && item.result === "0-1");
    const lost = (isWhite && item.result === "0-1") || (isBlack && item.result === "1-0");
    if (won) { stats.wins += 1; if (isWhite) stats.whiteWins += 1; else stats.blackWins += 1; }
    else if (lost) stats.losses += 1;
    else if (item.result === "1/2-1/2") stats.draws += 1;
    else stats.unknown += 1;
    const opening = item.opening?.trim() || "Apertura non classificata";
    const openingStats = openings.get(opening) || { games: 0, wins: 0, draws: 0, losses: 0 };
    openingStats.games += 1; if (won) openingStats.wins += 1; else if (lost) openingStats.losses += 1; else if (item.result === "1/2-1/2") openingStats.draws += 1;
    openings.set(opening, openingStats);
    const month = (item.playedAt || "").slice(0, 7);
    if (/^\d{4}\.\d{2}$/.test(month)) {
      const monthStats = months.get(month) || { games: 0, wins: 0, draws: 0, losses: 0 };
      monthStats.games += 1; if (won) monthStats.wins += 1; else if (lost) monthStats.losses += 1; else if (item.result === "1/2-1/2") monthStats.draws += 1;
      months.set(month, monthStats);
    }
    const control = item.timeControl?.trim() || "Non disponibile";
    controls.set(control, (controls.get(control) || 0) + 1);
    const firstMove = isWhite ? item.whiteFirstMove : item.blackFirstMove;
    if (firstMove) {
      const colorMoves = firstMoves[isWhite ? "white" : "black"];
      const moveStats = colorMoves.get(firstMove) || { games: 0, wins: 0, draws: 0, losses: 0 };
      moveStats.games += 1;
      if (won) moveStats.wins += 1; else if (lost) moveStats.losses += 1; else if (item.result === "1/2-1/2") moveStats.draws += 1;
      colorMoves.set(firstMove, moveStats);
    }
    const opponentElo = Number.parseInt(isWhite ? item.whiteElo : item.blackElo, 10);
    const ratingMonth = (item.playedAt || "").slice(0, 7);
    if (Number.isFinite(opponentElo) && opponentElo > 0 && /^\d{4}[.-]\d{2}$/.test(ratingMonth)) {
      const bucket = ratingMonths.get(ratingMonth) || { total: 0, games: 0, high: 0, low: Number.MAX_SAFE_INTEGER };
      bucket.total += opponentElo; bucket.games += 1; bucket.high = Math.max(bucket.high, opponentElo); bucket.low = Math.min(bucket.low, opponentElo);
      ratingMonths.set(ratingMonth, bucket);
    }
  }
  const decided = stats.wins + stats.draws + stats.losses;
  const score = decided ? Math.round((stats.wins + stats.draws / 2) / decided * 100) : null;
  const dates = games.map((item) => item.playedAt).filter(Boolean).sort();
  const chronological = [...games].filter((item) => item.white?.toLocaleLowerCase() === normalizedName || item.black?.toLocaleLowerCase() === normalizedName).sort((a, b) => (a.playedAt || "").localeCompare(b.playedAt || ""));
  const recent = chronological.slice(-20);
  const recentWins = recent.filter((item) => (item.white?.toLocaleLowerCase() === normalizedName && item.result === "1-0") || (item.black?.toLocaleLowerCase() === normalizedName && item.result === "0-1")).length;
  const recentDraws = recent.filter((item) => item.result === "1/2-1/2").length;
  const recentScore = recent.length ? Math.round((recentWins + recentDraws / 2) / recent.length * 100) : null;
  const recentRatings = recent.map((item) => Number.parseInt(item.white?.toLocaleLowerCase() === normalizedName ? item.whiteElo : item.blackElo, 10)).filter((elo) => Number.isFinite(elo) && elo > 0);
  const recentAverageElo = recentRatings.length ? Math.round(recentRatings.reduce((sum, elo) => sum + elo, 0) / recentRatings.length) : null;
  const header = document.createElement("header"); header.className = "opponent-report-header";
  addText(header, "h3", "game-report-title", `Profilo di ${username}`);
  addText(header, "p", "game-report-caption", `${games.length} partite · ${dates[0] || "data non disponibile"} – ${dates.at(-1) || "data non disponibile"} · archivi pubblici Chess.com`);
  root.append(header);
  const metrics = document.createElement("div"); metrics.className = "opponent-report-metrics";
  for (const [label, value, hint] of [
    ["Partite", games.length, `${stats.white} col Bianco · ${stats.black} col Nero`],
    ["Punteggio", score === null ? "—" : `${score}%`, `${stats.wins} vittorie · ${stats.draws} patte · ${stats.losses} sconfitte`],
    ["Col Bianco", stats.whiteGames ? `${Math.round(stats.whiteWins / stats.whiteGames * 100)}% vittorie` : "—", `${stats.whiteWins} vittorie su ${stats.whiteGames}`],
    ["Col Nero", stats.blackGames ? `${Math.round(stats.blackWins / stats.blackGames * 100)}% vittorie` : "—", `${stats.blackWins} vittorie su ${stats.blackGames}`],
    ["Forma · ultime 20", recentScore === null ? "—" : `${recentScore}%`, `${recent.length} partite recenti`],
    ["Elo medio recente", recentAverageElo === null ? "—" : String(recentAverageElo), `${recentRatings.length} partite con rating`],
  ]) { const card = document.createElement("div"); card.className = "opponent-report-metric"; addText(card, "span", "", label); addText(card, "strong", "", String(value)); addText(card, "small", "", hint); metrics.append(card); }
  root.append(metrics);
  const columns = document.createElement("div"); columns.className = "opponent-report-columns";
  const openingCard = document.createElement("section"); openingCard.className = "opponent-report-section";
  addText(openingCard, "h4", "game-report-section-title", "Aperture più giocate");
  const topOpenings = [...openings.entries()].sort((a, b) => b[1].games - a[1].games).slice(0, 8);
  if (!topOpenings.length) addText(openingCard, "p", "game-report-caption", "Nessuna apertura classificata nei PGN disponibili.");
  for (const [name, data] of topOpenings) { const row = document.createElement("div"); row.className = "opponent-report-row"; addText(row, "strong", "", name); addText(row, "span", "", `${data.games} partite · ${data.wins}V ${data.draws}P ${data.losses}S · ${Math.round((data.wins + data.draws / 2) / data.games * 100)}% punti`); openingCard.append(row); }
  const repeatedOpenings = [...openings.entries()].filter(([, data]) => data.games >= 3).map(([name, data]) => ({ name, games: data.games, score: Math.round((data.wins + data.draws / 2) / data.games * 100) }));
  if (repeatedOpenings.length) {
    const weakest = [...repeatedOpenings].sort((a, b) => a.score - b.score || b.games - a.games).slice(0, 2);
    const strongest = [...repeatedOpenings].sort((a, b) => b.score - a.score || b.games - a.games).slice(0, 2);
    addText(openingCard, "h4", "opponent-insight-title", "Tendenze nelle aperture ripetute");
    addText(openingCard, "p", "opponent-insight", `Punteggio più basso: ${weakest.map((row) => `${row.name} (${row.score}%, ${row.games} partite)`).join(" · ")}.`);
    addText(openingCard, "p", "opponent-insight", `Punteggio più alto: ${strongest.map((row) => `${row.name} (${row.score}%, ${row.games} partite)`).join(" · ")}.`);
  }
  const controlCard = document.createElement("section"); controlCard.className = "opponent-report-section";
  addText(controlCard, "h4", "game-report-section-title", "Controlli di tempo");
  for (const [name, count] of [...controls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) { const row = document.createElement("div"); row.className = "opponent-report-row"; addText(row, "strong", "", name); addText(row, "span", "", `${count} partite · ${Math.round(count / Math.max(1, games.length) * 100)}%`); controlCard.append(row); }
  const tendencyCard = document.createElement("section"); tendencyCard.className = "opponent-report-section";
  addText(tendencyCard, "h4", "game-report-section-title", "Prime mosse più giocate");
  for (const [side, label] of [["white", "Quando gioca col Bianco"], ["black", "Quando gioca col Nero"]]) {
    addText(tendencyCard, "strong", "opponent-insight-title", label);
    const moves = [...firstMoves[side].entries()].sort((a, b) => b[1].games - a[1].games || a[0].localeCompare(b[0])).slice(0, 5);
    if (!moves.length) addText(tendencyCard, "p", "opponent-insight", "Prime mosse non presenti nei PGN scaricati.");
    for (const [move, data] of moves) {
      const points = data.games ? Math.round((data.wins + data.draws / 2) / data.games * 100) : 0;
      const row = document.createElement("div"); row.className = "opponent-report-row";
      addText(row, "strong", "", move); addText(row, "span", "", `${data.games} partite · ${data.wins}V ${data.draws}P ${data.losses}S · ${points}% punti`); tendencyCard.append(row);
    }
  }
  columns.append(openingCard, controlCard, tendencyCard); root.append(columns);
  const recentMonths = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8);
  if (recentMonths.length) {
    const trend = document.createElement("section"); trend.className = "opponent-report-section"; addText(trend, "h4", "game-report-section-title", "Attività recente");
    const maxGames = Math.max(...recentMonths.map(([, data]) => data.games));
    for (const [month, data] of recentMonths) { const row = document.createElement("div"); row.className = "opponent-report-row opponent-month-row"; addText(row, "strong", "", month.replace(".", "-")); const bar = document.createElement("span"); bar.className = "opponent-month-bar"; bar.style.setProperty("--month-share", `${Math.max(3, data.games / maxGames * 100)}%`); bar.setAttribute("aria-label", `${data.games} partite`); row.append(bar); addText(row, "span", "", `${data.games} · ${data.wins}V ${data.draws}P ${data.losses}S`); trend.append(row); }
    root.append(trend);
  }
  const ratings = [...ratingMonths.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  if (ratings.length) {
    const ratingCard = document.createElement("section"); ratingCard.className = "opponent-report-section";
    addText(ratingCard, "h4", "game-report-section-title", "Andamento Elo · media mensile");
    const averages = ratings.map(([, data]) => Math.round(data.total / data.games));
    const minElo = Math.min(...averages), maxElo = Math.max(...averages);
    for (const [month, data] of ratings) {
      const average = Math.round(data.total / data.games);
      const width = maxElo === minElo ? 72 : Math.round(12 + (average - minElo) / (maxElo - minElo) * 76);
      const row = document.createElement("div"); row.className = "opponent-report-row opponent-rating-row";
      addText(row, "strong", "", month.replace(".", "-"));
      const bar = document.createElement("span"); bar.className = "opponent-rating-bar"; bar.style.setProperty("--rating-share", `${width}%`); row.append(bar);
      addText(row, "span", "", `${average} · ${data.games} partite · ${data.low}–${data.high}`); ratingCard.append(row);
    }
    root.append(ratingCard);
  }
  const coach = score === null ? "Il campione non contiene risultati sufficienti per calcolare il punteggio." : score >= 58 ? "Nel campione il punteggio dell'avversario supera la parità: prepara con cura le aperture." : score <= 42 ? "Nel campione il punteggio dell'avversario è sotto la parità: controlla comunque le singole partite." : "Nel campione i risultati sono vicini alla parità: valuta quale apertura ti mette più a tuo agio.";
  addText(root, "p", "opponent-coach-note", `Coach · ${coach} Il report riassume i risultati registrati e non valuta la qualità delle mosse.`);
}

async function createOpponentReport(event) {
  event.preventDefault();
  if (opponentReportBusy) return;
  if (persistenceMode !== "sqlite") { $("#opponent-report-status").textContent = "Apri ChessOS come app desktop per scaricare e salvare gli archivi."; return; }
  const username = $("#opponent-username").value.trim(); if (!username) return;
  opponentReportBusy = true;
  const button = $("#opponent-report-run"); button.disabled = true; button.textContent = "Download in corso…"; $("#print-opponent-report").disabled = true;
  let stopListening = null;
  try {
    stopListening = await listen("online-game-import-progress", (event) => { const data = event.payload || {}; if (data.provider !== "chess_com" || data.username?.toLocaleLowerCase() !== username.toLocaleLowerCase()) return; $("#opponent-report-status").textContent = `Archivio ${username} · ${data.processed || 0} elaborate · ${data.imported || 0} nuove · ${data.duplicates || 0} già presenti`; });
    const summary = await invoke("import_online_games", { provider: "chess_com", username, token: null });
    const games = await invoke("list_profile_games", { provider: "chess_com", username: summary.username });
    opponentReportGames = games; renderOpponentReport(games, summary.username);
    $("#opponent-report-status").textContent = `${games.length} partite nel profilo locale · ${summary.imported} nuove · ${summary.archives} archivi mensili controllati.`;
    $("#print-opponent-report").disabled = games.length === 0;
  } catch (error) { $("#opponent-report-status").textContent = "Report non completato: " + (error?.message || String(error)); }
  finally { if (stopListening) stopListening(); opponentReportBusy = false; button.disabled = false; button.textContent = "Scarica e crea report"; }
}

async function refreshImportedGames() {
  if (persistenceMode !== "sqlite" || !databaseReady) {
    importedGames = [];
    renderImportedGames();
    renderGameLibrary();
    return;
  }
  importedGames = await invoke("list_imported_games", { limit: 15 });
  renderImportedGames();

  // Carica un campione consistente di partite salvate nella libreria SQLite
  // per alimentare Opening Explorer, generatore e Tactical Trainer.
  try {
    const records = await invoke("list_imported_games", { limit: 50 });
    const fullGames = await Promise.all(
      records.map((record) => invoke("get_imported_game", { id: record.id }))
    );
    const pgn = fullGames.map((record) => record.pgn).filter(Boolean).join("\n\n");
    chessSuite?.loadImportedPgn(pgn);
    if (pgn) {
      const count = fullGames.filter((record) => record.pgn).length;
      const status = $("#opening-summary");
      if (status && !status.textContent.trim()) status.textContent = "Archivio pronto: " + count + " partite importate.";
    }
  } catch (error) {
    console.warn("Non riesco a preparare i PGN per gli strumenti di analisi:", error);
  }
  void loadGameLibrary(true);
}

function openOnlineImportDialog() {
  const dialog = $("#online-import-dialog");
  onlineImportReturnFocus = document.activeElement;
  if (!dialog) return;
  $("#online-import-progress").textContent = persistenceMode === "sqlite"
    ? "Le partite saranno salvate solo in locale. Gli import successivi saltano automaticamente quelle già presenti."
    : "L'importazione API è disponibile nella versione desktop di ChessOS.";
  $("#start-online-import").disabled = persistenceMode !== "sqlite" || onlineImportBusy;
  dialog.hidden = false;
  updateOnlineImportProvider();
  $("#online-username").focus({ preventScroll: true });
}

function closeOnlineImportDialog(restoreFocus = true) {
  if (onlineImportBusy) return;
  $("#online-import-dialog").hidden = true;
  $("#lichess-api-token").value = "";
  if (restoreFocus && onlineImportReturnFocus instanceof HTMLElement && onlineImportReturnFocus.isConnected) {
    onlineImportReturnFocus.focus({ preventScroll: true });
  }
  onlineImportReturnFocus = null;
}

function updateOnlineImportProvider() {
  const isLichess = $("#online-provider").value === "lichess";
  $("#lichess-token-field").hidden = !isLichess;
  $("#online-import-progress").textContent = isLichess
    ? "Account Lichess pubblico: basta lo username. Per account privati, token di sola lettura facoltativo; non viene salvato."
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
  onlineImportBusy = true;
  const button = $("#start-online-import");
  button.disabled = true;
  button.textContent = "Importazione in corso…";
  $("#cancel-online-import").disabled = true;
  $("#online-import-progress").textContent = "Connessione al servizio e download degli archivi…";
  let stopListening = null;
  try {
    stopListening = await listenForOptionalImportProgress(
      listen,
      (event) => {
        const progress = event.payload || {};
        $("#online-import-progress").textContent =
          "Elaborate: " + (progress.processed || 0)
          + " · nuove: " + (progress.imported || 0)
          + " · già presenti: " + (progress.duplicates || 0)
          + " · non supportate: " + (progress.skipped || 0);
      },
      (listenError) => {
        // Progress notifications are optional. The command proceeds even when
        // Tauri denies listen through its Access Control List.
        console.warn("Aggiornamento avanzamento non disponibile:", listenError);
        $("#online-import-progress").textContent = "Importazione avviata. Il download continua anche senza aggiornamenti in tempo reale…";
      },
    );

    const summary = await invoke("import_online_games", { provider, username, token });
    let refreshWarning = "";
    try {
      await refreshImportedGames();
    } catch (refreshError) {
      refreshWarning = " La libreria non è stata aggiornata a video: " + (refreshError?.message || String(refreshError));
    }
    const providerName = provider === "lichess" ? "Lichess" : "Chess.com";
    $("#online-import-progress").textContent =
      providerName + " — " + summary.username + ": " + summary.imported + " nuove partite importate, "
      + summary.duplicates + " già presenti e " + summary.skipped + " ignorate/non supportate."
      + (provider === "chess_com" ? " Archivi mensili controllati: " + summary.archives + "." : "")
      + refreshWarning;
    $("#lichess-api-token").value = "";
    showToast(summary.imported + " partite aggiunte alla libreria.");
  } catch (error) {
    $("#online-import-progress").textContent = "Importazione non completata: " + (error?.message || String(error));
    showToast("Importazione partite non riuscita.");
    try { await refreshImportedGames(); } catch { /* Mantieni la libreria già caricata. */ }
  } finally {
    if (stopListening) {
      try { stopListening(); } catch (unlistenError) {
        console.warn("Impossibile rimuovere il listener di avanzamento:", unlistenError);
      }
    }
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
    lineTrainingActive = false;
    lineTrainingSteps = [];
    lineTrainingSummary = "";
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
    showToast("Non riesco ad aprire questa partita: " + (error?.message || String(error)), { type: "error" });
  }
}

async function removeImportedGame(id, knownRecord = null) {
  const record = knownRecord || importedGames.find((item) => item.id === id) || gameLibraryRecords.find((item) => item.id === id);
  if (!record) return;
  if (!window.confirm("Rimuovere questa partita dalla libreria locale? Il repertorio non verrà modificato.")) return;
  try {
    await invoke("delete_imported_game", { id });
    await refreshImportedGames();
    showToast("Partita rimossa dalla libreria importata.");
  } catch (error) {
    showToast("Errore durante la rimozione: " + (error?.message || String(error)), { type: "error" });
  }
}

function closePromotionChooser(restoreFocus = true) {
  const returnSquare = promotionReturnFocus?.dataset.square;
  promotionReturnFocus = null;
  pendingPromotion = null;
  promotionDialog.hidden = true;
  promotionOptions.replaceChildren();
  if (restoreFocus && returnSquare) pendingBoardFocusSquare = returnSquare;
}

function openPromotionChooser(from, to, legalMoves) {
  const chess = activeGame();
  pendingPromotion = { from, to, legalMoves };
  promotionOptions.replaceChildren();
  promotionReturnFocus = boardElement.querySelector('[data-square="' + from + '"]');
  const color = chess.turn();

  for (const type of ["q", "r", "b", "n"]) {
    const choice = legalMoves.find((move) => move.promotion === type);
    if (!choice) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "promotion-choice";
    button.setAttribute("aria-label", "Promuovi a " + promotionNames[type]);
    button.dataset.promotionKey = type;
    button.title = promotionNames[type] + " · " + type.toUpperCase();
    const piece = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    piece.setAttribute("class", "piece " + (color === "w" ? "white-piece" : "black-piece"));
    piece.setAttribute("viewBox", "0 0 45 45");
    piece.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#piece-" + color + type);
    piece.append(use);
    const label = document.createElement("small");
    label.textContent = promotionNames[type];
    button.append(piece, label);
    button.addEventListener("click", () => {
      const selectedMove = pendingPromotion?.legalMoves.find((move) => move.promotion === type);
      closePromotionChooser(false);
      if (selectedMove) {
        pendingBoardFocusSquare = to;
        commitSelectedMove(selectedMove);
      }
    });
    promotionOptions.append(button);
  }

  promotionDialog.hidden = false;
  promotionOptions.querySelector("button")?.focus({ preventScroll: true });
}

function commitSelectedMove(selectedMove) {
  pendingBoardFocusSquare = selectedMove.to;
  if (mode === "exam") {
    void recordExamMove(selectedMove);
    return;
  }
  if (mode === "training") {
    if (lineTrainingActive) {
      if (lineTrainingSide !== "both" && lineTrainingSteps[lineTrainingPly]?.side !== lineTrainingSide) return;
      try {
        trainingGame.move({
          from: selectedMove.from,
          to: selectedMove.to,
          ...(selectedMove.promotion ? { promotion: selectedMove.promotion } : {}),
        });
        playFullLineMove(selectedMove);
      } catch (error) {
        showToast("Mossa non valida: " + error.message, { type: "error" });
      }
      return;
    }
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
      showToast("Mossa non legale.", { type: "error" });
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
    showToast("Mossa non legale.", { type: "error" });
    return;
  }

  appendStudioMove(played);
  setDirty(true);
  renderAll();
}

function handleSquareClick(square) {
  pendingBoardFocusSquare = square;
  if (mode === "exam" && examAnswered) return;
  if (mode === "training" && (!currentReviewCard || reviewSolved || reviewRevealed)) return;
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

  const from = selectedSquare;
  const intent = classifyBoardMove(chess, from, square);
  if (intent.kind === "same-square") {
    selectedSquare = null;
    renderBoard();
    return;
  }
  if (intent.kind === "select") {
    selectedSquare = intent.square;
    renderBoard();
    return;
  }
  if (intent.kind === "promotion") {
    openPromotionChooser(from, square, intent.moves);
    return;
  }
  if (intent.kind === "move") {
    commitSelectedMove(intent.move);
    return;
  }

  selectedSquare = null;
  renderBoard();
  showToast(intent.kind === "illegal" ? "Mossa non legale." : "Seleziona un pezzo del colore al tratto.");
}

function openLine(id) {
  if (mode === "exam" && examAttemptId) {
    void finishRepertoireExam(true).then(() => openLine(id));
    return;
  }
  if (mode === "training" && reviewSessionId && !reviewSessionFinished) {
    void markReviewSessionFinished().catch((error) => {
      showToast("Non riesco a chiudere la sessione: " + error.message, { type: "error" });
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
    lineTrainingActive = false;
    lineTrainingSteps = [];
    lineTrainingSummary = "";
    closePromotionChooser();
    renderAll();
  } catch (error) {
    showToast("PGN non leggibile: " + error.message, { type: "error" });
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
    showToast("Database non pronto: eliminazione non eseguita.", { type: "error" });
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
    showToast("Errore eliminazione: " + error.message, { type: "error" });
  }
}

async function saveLine() {
  if (mode !== "studio") return;
  if (!databaseReady) {
    showToast("Database non pronto: il salvataggio è disattivato.", { type: "error" });
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
    showToast("Errore salvataggio SQLite: " + error.message, { type: "error" });
  }
}

function startTraining() {
  if (mode === "exam" && examAttemptId) {
    void finishRepertoireExam(true).then(() => startTraining());
    return;
  }
  if (reviewSessionId && !reviewSessionFinished) {
    void markReviewSessionFinished().catch((error) => {
      showToast("Non riesco a chiudere la sessione precedente: " + error.message, { type: "error" });
    });
  }
  if (!databaseReady) {
    showToast("Archivio non pronto: riprova tra qualche istante.", { type: "warning" });
    return;
  }
  trainingGame = new Chess(DEFAULT_FEN);
  trainingMoves = [];
  trainingIndex = 0;
  reviewQueue = [];
  currentReviewCard = null;
  lineTrainingActive = false;
  lineTrainingSteps = [];
  lineTrainingPly = 0;
  lineTrainingSummary = "";
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
  lineTrainingActive = false;
  lineTrainingSteps = [];
  lineTrainingPly = 0;
  lineTrainingThinkingMs = 0;
  lineTrainingSummary = "";
  selectedSquare = null;
  mode = "training";
  closePromotionChooser();
  renderAll();
}

window.setInterval(renderLineTrainingClock, 1000);

function renderLineTrainingChoices() {
  const select = $("#line-training-repertoire");
  if (!select) return;
  const selectedId = select.value;
  select.replaceChildren(new Option("Seleziona una linea…", ""));
  for (const entry of repertoire) {
    const option = new Option(entry.title, entry.id);
    select.append(option);
  }
  if (repertoire.some((entry) => entry.id === selectedId)) select.value = selectedId;
  renderLineTrainingVariations();
}

function getRepertoirePaths(tree, maxPaths = 250) {
  const paths = [];
  const visit = (nodeId, path, visited) => {
    if (paths.length >= maxPaths) return;
    const outgoing = tree.getOutgoing(nodeId);
    if (!outgoing.length || path.length >= 512) {
      paths.push(path);
      return;
    }
    for (const edge of outgoing) {
      if (visited.has(edge.to)) continue;
      const nextVisited = new Set(visited);
      nextVisited.add(edge.to);
      visit(edge.to, [...path, edge.id], nextVisited);
      if (paths.length >= maxPaths) return;
    }
  };
  visit(tree.rootId, [], new Set([tree.rootId]));
  return paths;
}

function renderLineTrainingVariations() {
  const select = $("#line-training-variation");
  const entry = repertoire.find((item) => item.id === $("#line-training-repertoire")?.value);
  if (!select) return;
  const selectedPath = select.value;
  select.replaceChildren();
  if (!entry) {
    select.append(new Option("Scegli prima un repertorio", ""));
    select.disabled = true;
    return;
  }
  try {
    const tree = RepertoireTree.fromJSON(entry.tree);
    const paths = getRepertoirePaths(tree);
    select.disabled = paths.length === 0;
    paths.forEach((path, index) => {
      const moves = path.map((id) => tree.getEdge(id));
      const label = moves.map((edge, ply) => `${ply % 2 === 0 ? `${Math.floor(ply / 2) + 1}.` : ""}${edge.san}`).join(" ");
      const option = new Option(`${index === 0 ? "Linea principale" : `Variante ${index}`} · ${moves.length} semimosse · ${label.slice(0, 84)}`, String(index));
      select.append(option);
    });
    if (paths.length) select.value = selectedPath && Number(selectedPath) < paths.length ? selectedPath : "0";
  } catch {
    select.append(new Option("Repertorio non leggibile", ""));
    select.disabled = true;
  }
}

function startFullLineTraining() {
  const entry = repertoire.find((item) => item.id === $("#line-training-repertoire").value);
  if (!entry) {
    showToast("Scegli prima un repertorio da allenare.", { type: "warning" });
    return;
  }
  let tree;
  try { tree = RepertoireTree.fromJSON(entry.tree); }
  catch (error) {
    showToast("Non riesco a leggere questa linea: " + error.message, { type: "error" });
    return;
  }
  const availablePaths = getRepertoirePaths(tree);
  const selectedPathIndex = Number.parseInt($("#line-training-variation").value, 10) || 0;
  const edgeIds = availablePaths[selectedPathIndex] || tree.mainlinePath();
  if (!edgeIds.length) {
    showToast("Questa linea non contiene ancora mosse.", { type: "warning" });
    return;
  }
  lineTrainingSteps = edgeIds.map((id) => {
    const edge = tree.getEdge(id);
    const position = new Chess(tree.getNode(edge.from).fen);
    return { uci: edge.uci, san: edge.san, side: position.turn() === "w" ? "white" : "black" };
  });
  lineTrainingSide = $("#review-side").value;
  if (lineTrainingSide !== "both" && !lineTrainingSteps.some((step) => step.side === lineTrainingSide)) {
    showToast("La linea non contiene mosse per il lato scelto.", { type: "warning" });
    return;
  }
  const rootFen = tree.rootFen;
  const startMode = $("#line-training-start-mode").value;
  let startingPly = 0;
  if (startMode === "random") {
    const limit = Math.min(24, lineTrainingSteps.length - 1);
    const candidates = [];
    const position = new Chess(rootFen);
    for (let ply = 0; ply <= limit; ply += 1) {
      const toMove = position.turn() === "w" ? "white" : "black";
      if (ply < lineTrainingSteps.length && (lineTrainingSide === "both" || toMove === lineTrainingSide)) candidates.push(ply);
      if (ply < limit) position.move(parseUci(lineTrainingSteps[ply].uci));
    }
    if (!candidates.length) {
      showToast("La variante non contiene posizioni compatibili con il lato scelto nelle prime 12 mosse.", { type: "warning" });
      return;
    }
    startingPly = candidates[Math.floor(Math.random() * candidates.length)];
  }

  trainingGame = new Chess(rootFen);
  trainingMoves = [];
  for (let index = 0; index < startingPly; index += 1) {
    const move = trainingGame.move(parseUci(lineTrainingSteps[index].uci));
    if (!move) {
      showToast("La variante salvata contiene una mossa non valida.", { type: "error" });
      return;
    }
    trainingMoves.push(move);
  }
  trainingIndex = trainingMoves.length;
  lineTrainingPly = startingPly;
  lineTrainingActive = true;
  lineTrainingThinkingMs = 0;
  lineTrainingSummary = "";
  lineTurnStartedAt = performance.now();
  reviewQueue = [];
  currentReviewCard = null;
  reviewSessionId = null;
  reviewSessionTotal = lineTrainingSteps.length;
  reviewCompleted = 0;
  reviewAgainCount = 0;
  reviewSessionFinished = false;
  reviewSolved = false;
  reviewRevealed = false;
  reviewFailed = false;
  reviewLastMove = null;
  reviewFeedback = startMode === "random"
    ? "Partenza casuale dalla semimossa " + (startingPly + 1) + ". Ricostruisci la linea fino in fondo."
    : "Linea avviata dalla posizione iniziale. Gioca le mosse nell’ordine corretto fino alla fine.";
  if (lineTrainingSide !== "both") playAutomaticLineReplies();
  boardFlipped = lineTrainingSide === "black";
  selectedSquare = null;
  mode = "training";
  closePromotionChooser();
  renderAll();
}

function playAutomaticLineReplies() {
  while (lineTrainingPly < lineTrainingSteps.length && lineTrainingSteps[lineTrainingPly].side !== lineTrainingSide) {
    const move = trainingGame.move(parseUci(lineTrainingSteps[lineTrainingPly].uci));
    if (!move) break;
    trainingMoves.push(move);
    trainingIndex += 1;
    lineTrainingPly += 1;
    reviewCompleted += 1;
  }
}

function playFullLineMove(selectedMove) {
  const expected = lineTrainingSteps[lineTrainingPly];
  if (!expected) return;
  const uci = selectedMove.from + selectedMove.to + (selectedMove.promotion || "");
  if (uci !== expected.uci) {
    trainingGame.undo();
    selectedSquare = null;
    reviewFailed = true;
    reviewFeedback = "Mossa fuori linea. Prova ancora: prenditi il tempo che ti serve.";
    renderAll();
    return;
  }
  const played = trainingGame.history({ verbose: true }).at(-1);
  trainingMoves.push(played);
  trainingIndex += 1;
  lineTrainingPly += 1;
  reviewCompleted += 1;
  lineTrainingThinkingMs += Math.max(0, performance.now() - lineTurnStartedAt);
  selectedSquare = null;
  reviewFailed = false;
  if (lineTrainingSide !== "both") playAutomaticLineReplies();
  if (lineTrainingPly >= lineTrainingSteps.length) {
    lineTrainingActive = false;
    reviewSessionFinished = true;
    const seconds = Math.round(lineTrainingThinkingMs / 1000);
    lineTrainingSummary = "Linea completata: " + entryTitleForLineTraining() + ". Tempo totale di riflessione: " + Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0") + ".";
    reviewFeedback = "Hai raggiunto la fine della variante.";
  } else {
    const seconds = Math.round((performance.now() - lineTurnStartedAt) / 1000);
    reviewFeedback = "Mossa corretta: " + played.san + " · tempo: " + seconds + " s.";
    lineTurnStartedAt = performance.now();
  }
  renderAll();
}

function entryTitleForLineTraining() {
  return $("#line-training-repertoire")?.selectedOptions[0]?.textContent || "repertorio";
}

function renderLineTrainingClock() {
  const timer = $("#line-training-timer");
  if (!timer) return;
  timer.hidden = !lineTrainingActive;
  if (!lineTrainingActive) return;
  const seconds = Math.floor(Math.max(0, performance.now() - lineTurnStartedAt) / 1000);
  timer.textContent = "Tempo per pensare: " + Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

async function beginDailyReviewSession() {
  if (isStartingReviewSession) return;
  if (!databaseReady || !repertoire.length) {
    showToast("Salva almeno una linea nel repertorio prima di iniziare.", { type: "warning" });
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
    showToast("Non riesco ad avviare la sessione: " + error.message, { type: "error" });
    return;
  }

  isStartingReviewSession = false;
  startButton.disabled = false;
  reviewSessionId = id;
  reviewSessionTotal = queue.length;
  reviewCompleted = 0;
  reviewAgainCount = 0;
  reviewSessionFinished = false;
  lineTrainingActive = false;
  lineTrainingSummary = "";
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
    showToast("Sessione conclusa, ma non riesco a salvare la chiusura: " + error.message, { type: "error" });
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
    showToast("Errore nello scheduling FSRS: " + error.message, { type: "error" });
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
    showToast("Non riesco a salvare la risposta FSRS: " + error.message, { type: "error" });
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
    showToast("Impossibile mostrare la soluzione: " + error.message, { type: "error" });
  }
}

function renderReviewPanel() {
  const now = new Date();
  const side = $("#review-side").value;
  renderLineTrainingChoices();
  const cards = buildReviewCards(repertoire, studyCards, now);
  const todayStats = getTodayReviewStats(reviewLogs, now);
  $("#review-stat-due").textContent = String(countDueCards(cards, now, side));
  $("#review-stat-today").textContent = String(todayStats.reviews);
  $("#review-stat-accuracy").textContent = todayStats.reviews ? todayStats.accuracy + "%" : "—";
  $("#review-stat-total").textContent = String(cards.length);

  const hasSession = Boolean(reviewSessionId) || lineTrainingActive || reviewSessionFinished;
  $("#review-setup").hidden = hasSession;
  $("#review-active").hidden = !hasSession || (!currentReviewCard && !lineTrainingActive) || reviewSessionFinished;
  $("#review-complete").hidden = !reviewSessionFinished;
  if (currentReviewCard) {
    $("#review-card-meta").textContent =
      currentReviewCard.repertoireTitle + " · " +
      (currentReviewCard.side === "white" ? "Bianco" : "Nero") +
      " · carta " + (reviewCompleted + 1) + "/" + reviewSessionTotal;
  } else if (lineTrainingActive) {
    $("#review-card-meta").textContent = entryTitleForLineTraining() + " · " + (lineTrainingSide === "both" ? "Bianco e Nero" : lineTrainingSide === "white" ? "Bianco" : "Nero") + " · semimossa " + (lineTrainingPly + 1) + "/" + lineTrainingSteps.length;
  }
  $("#review-feedback").textContent = reviewFeedback || "Trova la mossa prevista in questa posizione.";
  $("#review-show-answer").hidden = lineTrainingActive || reviewSolved || reviewRevealed || !currentReviewCard;
  $("#review-quick-again").hidden = lineTrainingActive || !reviewFailed || reviewSolved || reviewRevealed;
  $("#review-grades").hidden = lineTrainingActive || !(reviewSolved || reviewRevealed);
  $("#review-complete-summary").textContent = lineTrainingSummary ||
    "Sessione completata: " + reviewCompleted + " carte ripassate, " +
    reviewAgainCount + " valutate Again. " + countReviewsToday(reviewLogs, now) + " ripassi oggi.";
  renderLineTrainingClock();
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
    showToast("Salva almeno un repertorio prima di avviare un esame.", { type: "warning" });
    return;
  }
  if (examAttemptId) {
    showToast("Concludi prima l'esame in corso.", { type: "warning" });
    return;
  }
  const repertoireId = $("#exam-repertoire").value;
  const line = repertoire.find((entry) => entry.id === repertoireId);
  if (!line) {
    showToast("Seleziona un repertorio valido.", { type: "warning" });
    return;
  }
  const side = $("#exam-side").value;
  const count = Number($("#exam-count").value);
  const threshold = Number($("#exam-pass-threshold").value);
  if (!Number.isInteger(count) || count < 1 || count > 500 ||
      !Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
    showToast("Numero di domande o soglia non validi.", { type: "warning" });
    return;
  }
  const availableCards = buildReviewCards([line], studyCards, new Date());
  const questions = selectExamQuestions(availableCards, { repertoireId, side, count });
  if (!questions.length) {
    showToast("Il repertorio non contiene mosse per il lato scelto.", { type: "warning" });
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
    showToast("Non riesco ad avviare l'esame: " + error.message, { type: "error" });
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
    showToast("Mossa non legale.", { type: "error" });
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
      showToast("Non riesco a mostrare la soluzione: " + error.message, { type: "error" });
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
    showToast("Non riesco a registrare la risposta: " + error.message, { type: "error" });
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
    showToast("Non riesco a salvare la chiusura dell'esame: " + error.message, { type: "error" });
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

function formatBackupSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(2) + " MB";
  return (size / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatBackupDate(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return "Data non disponibile";
  return new Date(value).toLocaleString("it-IT");
}

function setBackupStatus(message, isError = false) {
  const status = $("#backup-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function renderBackupList() {
  const list = $("#backup-list");
  if (!list) return;
  list.replaceChildren();
  $("#backup-count").textContent = String(databaseBackups.length);

  if (persistenceMode !== "sqlite") {
    const empty = document.createElement("p");
    empty.className = "backup-empty";
    empty.textContent = "La gestione dei backup completi è disponibile nell’app desktop di ChessOS.";
    list.append(empty);
    $("#create-backup").disabled = true;
    $("#refresh-backups").disabled = true;
    return;
  }

  $("#create-backup").disabled = !databaseReady || backupsBusy;
  $("#refresh-backups").disabled = backupsBusy;
  if (!databaseBackups.length) {
    const empty = document.createElement("p");
    empty.className = "backup-empty";
    empty.textContent = "Nessun backup ancora presente. Crea il primo backup completo per proteggere il tuo archivio.";
    list.append(empty);
    return;
  }

  for (const backup of databaseBackups) {
    const row = document.createElement("article");
    row.className = "backup-row";
    const details = document.createElement("div");
    details.className = "backup-row-details";
    const name = document.createElement("strong");
    name.textContent = backup.name;
    const meta = document.createElement("small");
    meta.textContent = formatBackupDate(backup.createdAt) + " · " + formatBackupSize(backup.sizeBytes);
    const verification = document.createElement("span");
    verification.className = verifiedBackups.has(backup.name) ? "backup-verification verified" : "backup-verification";
    verification.textContent = verifiedBackups.has(backup.name) ? "Integrità verificata" : "Da verificare prima del ripristino";
    details.append(name, meta, verification);

    const actions = document.createElement("div");
    actions.className = "backup-row-actions";
    const verify = document.createElement("button");
    verify.type = "button";
    verify.className = "button small ghost";
    verify.textContent = "Verifica";
    verify.disabled = backupsBusy;
    verify.addEventListener("click", () => { void verifyDatabaseBackup(backup.name); });

    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "button small primary";
    restore.textContent = "Ripristina";
    restore.disabled = backupsBusy || !verifiedBackups.has(backup.name);
    restore.addEventListener("click", () => { void restoreDatabaseBackup(backup.name); });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button small backup-delete";
    remove.textContent = "Elimina";
    remove.disabled = backupsBusy;
    remove.addEventListener("click", () => { void deleteDatabaseBackup(backup.name); });

    actions.append(verify, restore, remove);
    row.append(details, actions);
    list.append(row);
  }
}

async function refreshDatabaseBackups() {
  if (persistenceMode !== "sqlite") {
    databaseBackups = [];
    renderBackupList();
    return;
  }
  try {
    databaseBackups = await invoke("list_database_backups");
    const available = new Set(databaseBackups.map((backup) => backup.name));
    verifiedBackups = new Set([...verifiedBackups].filter((name) => available.has(name)));
    renderBackupList();
  } catch (error) {
    setBackupStatus("Impossibile leggere l’elenco dei backup: " + (error?.message || String(error)), true);
    showToast("Lettura backup non riuscita.", { type: "error" });
  }
}

async function createDatabaseBackup() {
  if (persistenceMode !== "sqlite" || !databaseReady || backupsBusy) return;
  backupsBusy = true;
  renderBackupList();
  setBackupStatus("Creazione e verifica del backup completo in corso…");
  try {
    const backup = await invoke("create_database_backup");
    verifiedBackups.add(backup.name);
    await refreshDatabaseBackups();
    setBackupStatus("Backup creato e verificato: " + backup.name);
    showToast("Backup completo creato.");
  } catch (error) {
    setBackupStatus("Creazione backup non riuscita: " + (error?.message || String(error)), true);
    showToast("Backup non riuscito.", { type: "error" });
  } finally {
    backupsBusy = false;
    renderBackupList();
  }
}

async function verifyDatabaseBackup(name) {
  if (backupsBusy) return;
  backupsBusy = true;
  renderBackupList();
  setBackupStatus("Verifica dell’integrità di " + name + "…");
  try {
    const result = await invoke("verify_database_backup", { name });
    verifiedBackups.add(name);
    setBackupStatus("Verifica completata: SQLite " + result.integrityCheck + ", relazioni " + result.foreignKeyCheck + ", schema v" + result.schemaVersion + ".");
    showToast("Backup verificato. Il ripristino è ora disponibile.");
  } catch (error) {
    verifiedBackups.delete(name);
    setBackupStatus("Backup non valido: " + (error?.message || String(error)), true);
    showToast("Verifica del backup non riuscita.", { type: "error" });
  } finally {
    backupsBusy = false;
    renderBackupList();
  }
}

async function restoreDatabaseBackup(name) {
  if (backupsBusy || !verifiedBackups.has(name)) return;
  const confirmed = confirm(
    "Ripristinare " + name + "?\n\nI dati attuali saranno sostituiti. ChessOS creerà prima una copia di sicurezza automatica dello stato corrente e la conserverà nell’elenco."
  );
  if (!confirmed) return;

  backupsBusy = true;
  renderBackupList();
  setBackupStatus("Ripristino in corso. Verifica nuovamente il backup e creazione della copia pre-ripristino…");
  try {
    const result = await invoke("restore_database_backup", { name });
    repertoire = await invoke("list_repertoires");
    await loadStudyData();
    await refreshImportedGames();
    databaseReady = true;
    verifiedBackups.clear();
    await refreshDatabaseBackups();
    renderAll();
    setBackupStatus("Ripristino completato da " + result.restoredFrom + ". Copia dello stato precedente: " + result.safetyBackup.name);
    showToast("Database ripristinato. Copia pre-ripristino conservata.");
  } catch (error) {
    setBackupStatus("Ripristino non completato: " + (error?.message || String(error)), true);
    showToast("Ripristino non riuscito.", { type: "error" });
  } finally {
    backupsBusy = false;
    renderBackupList();
  }
}

async function deleteDatabaseBackup(name) {
  if (backupsBusy) return;
  if (!confirm("Eliminare definitivamente il backup " + name + "? Questa operazione non è reversibile.")) return;
  backupsBusy = true;
  renderBackupList();
  try {
    await invoke("delete_database_backup", { name });
    verifiedBackups.delete(name);
    await refreshDatabaseBackups();
    setBackupStatus("Backup eliminato: " + name);
  } catch (error) {
    setBackupStatus("Eliminazione non riuscita: " + (error?.message || String(error)), true);
    showToast("Eliminazione backup non riuscita.", { type: "error" });
  } finally {
    backupsBusy = false;
    renderBackupList();
  }
}

async function showBackups() {
  if (mode === "training") leaveTraining();
  if (mode === "exam" && examAttemptId) {
    await finishRepertoireExam(true);
  }
  mode = "backups";
  renderAll();
  await refreshDatabaseBackups();
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

async function switchWorkspace(nextMode) {
  if (mode === "training") leaveTraining();
  if (mode === "exam" && examAttemptId) await finishRepertoireExam(true);
  mode = nextMode;
  if (nextMode === "endgame") chessSuite?.refreshEndgame?.();
  if (nextMode === "review") void loadGameLibrary();
  renderAll();
}

function leaveTraining() {
  if (reviewSessionId && !reviewSessionFinished) {
    void markReviewSessionFinished().catch((error) => {
      showToast("Non riesco a chiudere la sessione: " + error.message, { type: "error" });
    });
  }
  mode = "studio";
  trainingGame = null;
  trainingMoves = [];
  trainingIndex = 0;
  reviewQueue = [];
  currentReviewCard = null;
  lineTrainingActive = false;
  lineTrainingSteps = [];
  lineTrainingPly = 0;
  lineTrainingSummary = "";
  reviewSessionId = null;
  reviewSessionFinished = false;
  selectedSquare = null;
  closePromotionChooser();
  renderAll();
}

function importPgn() {
  const text = $("#pgn-input").value.trim();
  if (!text) {
    showToast("Incolla prima un testo PGN.", { type: "warning" });
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
    showToast("PGN non valido: " + error.message, { type: "error" });
  }
}

function exportPgn() {
  const pgn = mode !== "studio" || !studioTree.edges.size ? "" : timelinePgn();
  if (!pgn) {
    showToast("Non ci sono mosse da esportare.", { type: "warning" });
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
}

function initializeUiPreferences() {
  const controls = [
    ["#ui-theme-select", "theme"],
    ["#board-theme-select", "boardTheme"],
    ["#board-coordinates-select", "coordinates"],
    ["#motion-select", "motion"],
    ["#accent-select", "accent"],
    ["#density-select", "density"],
    ["#board-size-select", "boardSize"],
    ["#sidebar-select", "sidebar"],
  ];
  for (const [selector, key] of controls) {
    const element = $(selector);
    if (!element) continue;
    element.value = uiPreferences[key];
    element.addEventListener("change", () => {
      uiPreferences[key] = element.value;
      if (!saveUiPreferences(uiPreferences)) {
        showToast("Preferenza applicata, ma non riesco a salvarla nel browser.", { type: "warning" });
      }
      if (key === "coordinates") renderBoard();
    });
  }
}

function trapDialogTab(event, dialog) {
  if (event.key !== "Tab") return false;
  const focusable = Array.from(dialog.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.closest("[hidden]") && element.getAttribute("aria-hidden") !== "true");
  if (!focusable.length) {
    event.preventDefault();
    return true;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
  return true;
}

async function copyFen() {
  const fen = activeGame().fen();
  try {
    await navigator.clipboard.writeText(fen);
    showToast("FEN copiata negli appunti.");
  } catch {
    showToast("Copia FEN non disponibile in questo contesto.", { type: "warning" });
  }
}

function clearBoardGestureStyles() {
  boardElement.querySelectorAll(".dragging, .drop-target").forEach((element) => {
    element.classList.remove("dragging", "drop-target");
  });
}

function boardInputAllowed(chess) {
  if (!chess || pendingPromotion || chess.isGameOver()) return false;
  if (mode === "exam" && examAnswered) return false;
  if (mode === "training" && (!currentReviewCard || reviewSolved || reviewRevealed)) return false;
  return (mode === "studio" && boardMarkTool === "move") || mode === "training" || mode === "exam";
}

// Pointer-based drag works in the Windows WebView and on touch screens without
// relying on HTML5 drag-and-drop support. A normal tap still follows the
// click-to-move path below.
boardElement.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || pointerBoardGesture) return;
  const squareButton = event.target.closest("button[data-square]");
  if (!squareButton) return;
  const chess = activeGame();
  if (!boardInputAllowed(chess)) return;
  const from = squareButton.dataset.square;
  const piece = chess.get(from);
  if (!piece || piece.color !== chess.turn()) return;
  pointerBoardGesture = {
    pointerId: event.pointerId,
    from,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  };
});

document.addEventListener("pointermove", (event) => {
  const gesture = pointerBoardGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
  if (!gesture.moved && distance < 7) return;
  gesture.moved = true;
  event.preventDefault();

  const source = boardElement.querySelector('button[data-square="' + gesture.from + '"]');
  source?.classList.add("dragging");
  boardElement.querySelectorAll(".drop-target").forEach((element) => element.classList.remove("drop-target"));
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("#chessboard button[data-square]");
  if (target && target.dataset.square !== gesture.from) target.classList.add("drop-target");
}, { passive: false });

document.addEventListener("pointerup", (event) => {
  const gesture = pointerBoardGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  pointerBoardGesture = null;
  clearBoardGestureStyles();
  if (!gesture.moved) return;

  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("#chessboard button[data-square]");
  if (!target || !boardElement.contains(target)) {
    selectedSquare = null;
    renderBoard();
    return;
  }

  const destination = target.dataset.square;
  suppressNextBoardClick = true;
  window.setTimeout(() => { suppressNextBoardClick = false; }, 500);
  if (destination === gesture.from) {
    selectedSquare = null;
    renderBoard();
    return;
  }
  selectedSquare = gesture.from;
  handleSquareClick(destination);
});

document.addEventListener("pointercancel", (event) => {
  if (!pointerBoardGesture || pointerBoardGesture.pointerId !== event.pointerId) return;
  pointerBoardGesture = null;
  clearBoardGestureStyles();
  selectedSquare = null;
  renderBoard();
});

boardElement.addEventListener("click", (event) => {
  if (suppressNextBoardClick) {
    suppressNextBoardClick = false;
    event.preventDefault();
    return;
  }
  const squareButton = event.target.closest("button[data-square]");
  if (squareButton) handleSquareClick(squareButton.dataset.square);
});

boardElement.addEventListener("keydown", (event) => {
  const current = event.target.closest?.("button[data-square]");
  if (!current) return;
  if (event.key === "Escape") {
    if (!selectedSquare) return;
    event.preventDefault();
    selectedSquare = null;
    pendingBoardFocusSquare = current.dataset.square;
    renderBoard();
    return;
  }
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const nextSquare = getAdjacentSquare(current.dataset.square, event.key, boardFlipped);
  event.preventDefault();
  event.stopPropagation();
  if (!nextSquare) return;
  const next = boardElement.querySelector('[data-square="' + nextSquare + '"]');
  if (next) {
    current.tabIndex = -1;
    next.tabIndex = 0;
    next.focus({ preventScroll: true });
  }
});

$("#open-online-import").addEventListener("click", openOnlineImportDialog);
$("#import-online-games-sidebar").addEventListener("click", openOnlineImportDialog);
$("#game-library-search").addEventListener("click", () => { void loadGameLibrary(true); });
$("#game-library-query").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void loadGameLibrary(true); } });
$("#game-library-username").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void loadGameLibrary(true); } });
$("#game-library-provider").addEventListener("change", () => { void loadGameLibrary(true); });
$("#game-library-export").addEventListener("click", () => { void exportGameLibraryPgn(); });
$("#game-library-previous").addEventListener("click", () => { if (gameLibraryPage > 0) { gameLibraryPage -= 1; void loadGameLibrary(); } });
$("#game-library-next").addEventListener("click", () => { if ((gameLibraryPage + 1) * 50 < gameLibraryTotal) { gameLibraryPage += 1; void loadGameLibrary(); } });
$("#online-provider").addEventListener("change", updateOnlineImportProvider);
$("#start-online-import").addEventListener("click", () => { void startOnlineGameImport(); });
$("#cancel-online-import").addEventListener("click", closeOnlineImportDialog);
$("#online-import-dialog").addEventListener("click", (event) => {
  if (event.target === $("#online-import-dialog")) closeOnlineImportDialog();
});
$("#nav-dashboard").addEventListener("click", showDashboard);
$("#nav-review").addEventListener("click", () => { void switchWorkspace("review"); });
$("#nav-endgame").addEventListener("click", () => { void switchWorkspace("endgame"); });
$("#review-import-games").addEventListener("click", openOnlineImportDialog);
$("#toggle-engine").addEventListener("click", () => { engineEnabled = !engineEnabled; localStorage.setItem("chess-os.engine.enabled", String(engineEnabled)); engineFenPending = ""; schedulePositionAnalysis(); });
$("#toast-close").addEventListener("click", hideToast);
$("#appearance-menu").addEventListener("keydown", (event) => {
  if (event.key === "Escape") $("#appearance-menu").open = false;
});
$("#check-for-updates").addEventListener("click", () => { void installAvailableUpdate({ manual: true }); });
$("#nav-backups").addEventListener("click", () => { void showBackups(); });
initializeUiPreferences();
$("#create-backup").addEventListener("click", () => { void createDatabaseBackup(); });
$("#refresh-backups").addEventListener("click", () => { void refreshDatabaseBackups(); });
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
$("#line-training-start").addEventListener("click", startFullLineTraining);
$("#line-training-repertoire").addEventListener("change", () => {
  $("#line-training-variation").value = "0";
  renderLineTrainingVariations();
});
$("#analyze-imported-game").addEventListener("click", analyzeSelectedImportedGame);
$("#opponent-report-form").addEventListener("submit", (event) => { void createOpponentReport(event); });
$("#print-opponent-report").addEventListener("click", () => {
  if (!opponentReportGames.length) return;
  document.body.classList.add("print-opponent-report");
  window.print();
});
window.addEventListener("afterprint", () => document.body.classList.remove("print-opponent-report"));
$("#analyze-latest-games").addEventListener("click", () => {
  const records = importedGames.slice(0, 10);
  if (!records.length) {
    $("#game-analysis-status").textContent = "Importa prima alcune partite da Chess.com o Lichess.";
    return;
  }
  void runImportedGameAnalysis(records);
});
$("#print-game-analysis").addEventListener("click", () => {
  if (!gameAnalysisResults.length) return;
  document.body.classList.add("print-game-analysis");
  window.print();
});
window.addEventListener("afterprint", () => document.body.classList.remove("print-game-analysis"));
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
$("#open-fen-editor").addEventListener("click", openFenEditor);
$("#fen-editor-close").addEventListener("click", () => closeFenEditor());
$("#fen-editor-dialog").addEventListener("click", (event) => {
  if (event.target === $("#fen-editor-dialog")) closeFenEditor();
});
$("#fen-editor-load").addEventListener("click", loadFenEditorText);
$("#fen-editor-standard").addEventListener("click", () => {
  fenEditorState = fenToEditorState(DEFAULT_FEN);
  renderFenEditorBoard();
  syncFenEditorFields();
});
$("#fen-editor-apply").addEventListener("click", applyFenEditorPosition);
$("#save-line").addEventListener("click", saveLine);
$("#select-pgn-file").addEventListener("click", () => $("#pgn-file").click());
$("#pgn-file").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 10_000_000) {
      showToast("Il file PGN supera il limite di 10 MB.", { type: "warning" });
      return;
    }
    const contents = await file.text();
    if (!contents.trim()) {
      showToast("Il file selezionato è vuoto.", { type: "warning" });
      return;
    }
    $("#pgn-input").value = contents;
    showToast("File PGN caricato. Premi “Carica PGN” per importarlo.");
  } catch (error) {
    showToast("Impossibile leggere il file PGN: " + (error?.message || String(error)), { type: "error" });
  } finally {
    input.value = "";
  }
});
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
  const onlineDialog = $("#online-import-dialog");
  const fenDialog = $("#fen-editor-dialog");
  if (!onlineDialog.hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeOnlineImportDialog();
    } else {
      trapDialogTab(event, onlineDialog);
    }
    return;
  }
  if (!fenDialog.hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeFenEditor();
    } else {
      trapDialogTab(event, fenDialog);
    }
    return;
  }
  if (pendingPromotion) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePromotionChooser();
      selectedSquare = null;
      renderBoard();
      return;
    }
    if (event.key === "Tab") {
      trapDialogTab(event, promotionDialog);
      return;
    }
    const choice = promotionOptions.querySelector('[data-promotion-key="' + event.key.toLowerCase() + '"]');
    if (choice && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      choice.click();
    }
    return;
  }

  if (event.key === "Escape") {
    document.querySelectorAll(".appearance-menu[open], .more-actions[open], .repertoire-menu[open], .studio-actions-menu[open]")
      .forEach((menu) => { menu.open = false; });
    if (selectedSquare && boardElement.contains(document.activeElement)) {
      event.preventDefault();
      const focusedSquare = document.activeElement.dataset.square || selectedSquare;
      selectedSquare = null;
      pendingBoardFocusSquare = focusedSquare;
      renderBoard();
      return;
    }
  }

  const target = event.target;
  const editing = target instanceof HTMLElement && (
    target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
  const commandKey = event.ctrlKey || event.metaKey;
  if (commandKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (mode === "studio") void saveLine();
    return;
  }
  if (commandKey && event.key.toLowerCase() === "n" && !editing) {
    event.preventDefault();
    if (mode === "studio") void newPosition();
    return;
  }
  if (!editing && event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const focusedSquare = target instanceof HTMLElement ? target.closest("button[data-square]")?.dataset.square : null;
    boardFlipped = !boardFlipped;
    if (focusedSquare) pendingBoardFocusSquare = focusedSquare;
    renderBoard();
    return;
  }

  if (mode !== "studio" || editing ||
      (target instanceof HTMLElement && target.tagName === "BUTTON" && !target.matches(".square, .san-move"))) return;

  if (event.key === "Home") {
    event.preventDefault();
    positionForPly(0);
  } else if (event.key === "End") {
    event.preventDefault();
    positionForPly(studioSans.length);
  } else if (event.key === "ArrowLeft" && studioPly > 0) {
    event.preventDefault();
    positionForPly(studioPly - 1);
  } else if (event.key === "ArrowRight" && studioPly < studioSans.length) {
    event.preventDefault();
    positionForPly(studioPly + 1);
  }
});


extendedTraining = initializeExtendedTraining({
  getCurrentTree: () => studioTree,
  getCurrentMoves: () => studioMoveObjects,
  getBaseFen: () => baseFen,
  getCurrentTitle: () => titleInput.value,
  loadPath: (edgeIds) => {
    syncStudioPath(edgeIds);
    selectedSquare = null;
    mode = "studio";
    renderAll();
  },
  toast: showToast,
});
chessSuite = initializeChessSuite({
  getCurrentTree: () => studioTree,
  loadGeneratedTree: (tree, title) => {
    if (!confirmDiscardChanges("caricare il repertorio generato")) return;
    rebuildTimeline(tree);
    mode = "studio";
    activeLineId = null;
    titleInput.value = title;
    setDirty(true);
    renderAll();
    showToast("Repertorio generato. Controlla le varianti e salva la linea nello Studio.");
  },
  getCurrentFen: () => activeGame().fen(),
  getCurrentEdge: () => {
    const edgeId = studioPath[studioPly - 1];
    return edgeId ? studioTree.getEdge(edgeId) : null;
  },
  onAnnotationSaved: () => {
    setDirty(true);
    renderAll();
  },
  onImportedGames: (pgn) => extendedTraining?.loadImportedPgn(pgn),
});

function createEndgameFlashcard() {
  const lesson = chessSuite?.getCurrentEndgameLesson?.();
  if (!lesson) {
    showToast("Seleziona prima una lezione Endgame.", { type: "warning" });
    return;
  }
  extendedTraining?.addConceptCard({
    front: "Richiama la tecnica: " + lesson.title + ". " + lesson.focus,
    back: "Obiettivo: " + lesson.objective + "\n\nMetodo: " + lesson.method + "\n\nErrore tipico: " + lesson.errors,
    fen: lesson.fen,
  });
}
$("#endgame-create-card")?.addEventListener("click", createEndgameFlashcard);

renderAll();
void initializePersistence();

let updateCheckRunning = false;
let updateCheckFailureNotified = false;
async function installAvailableUpdate({ manual = false } = {}) {
  if (!isTauri()) {
    if (manual) showToast("Il controllo aggiornamenti ? disponibile nell'app desktop.", { type: "info" });
    return;
  }
  if (updateCheckRunning) return;
  updateCheckRunning = true;
  const button = manual ? $("#check-for-updates") : null;
  if (button) { button.disabled = true; button.textContent = "Controllo?"; }
  try {
    const update = await check();
    if (!update) {
      if (manual) showToast("ChessOS ? gi? aggiornato.", { type: "success" });
      return;
    }
    showToast("Aggiornamento " + update.version + " in installazione?");
    await update.downloadAndInstall();
    await relaunch();
  } catch (error) {
    console.warn("Controllo aggiornamenti non riuscito; verr? riprovato pi? tardi.", error);
    if (manual || !updateCheckFailureNotified) {
      showToast("Non riesco a verificare gli aggiornamenti. Riprover? automaticamente.", { type: "warning" });
      updateCheckFailureNotified = true;
    }
  } finally {
    updateCheckRunning = false;
    if (button) { button.disabled = false; button.textContent = "Controlla aggiornamenti"; }
  }
}

if (isTauri()) {
  window.setTimeout(() => void installAvailableUpdate(), 4000);
  window.setInterval(() => void installAvailableUpdate(), 6 * 60 * 60 * 1000);
}
