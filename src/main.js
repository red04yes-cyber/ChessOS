import { Chess } from "chess.js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { RepertoireTree } from "./repertoire-tree.js";
import { formatUciScore, parseUciInfo, uciPvToSan } from "./engine-uci.js";
import { initChessLab } from "./chess-lab.js";
import { parsePgnCollection } from "./pgn-import.js";
import "@fontsource-variable/inter/wght.css";
import "./style.css";

const STORAGE_KEY = "chess-os.repertoire.v1";
const UI_SETTINGS_KEY = "chess-os.ui.v1";
const DEFAULT_FEN = new Chess().fen();
const files = "abcdefgh";
const pieceNames = {
  k: "Re",
  q: "Donna",
  r: "Torre",
  b: "Alfiere",
  n: "Cavallo",
  p: "Pedone",
};

function createPieceElement(color, type) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "piece " + (color === "w" ? "white-piece" : "black-piece"));
  svg.setAttribute("viewBox", "0 0 45 45");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS(svg.namespaceURI, "use");
  use.setAttribute("href", "#piece-" + color + type);
  svg.append(use);
  return svg;
}
const promotionNames = { q: "Donna", r: "Torre", b: "Alfiere", n: "Cavallo" };

let game = new Chess();
let mode = "studio";
let selectedSquare = null;
let dragState = null;
let suppressBoardClick = false;
let boardFlipped = false;
let pendingPromotion = null;
let promotionOriginSquare = null;
const persistenceMode = isTauri() ? "sqlite" : "browser";
let databaseReady = persistenceMode === "browser";
let repertoire = persistenceMode === "browser" ? readRepertoire() : [];
let activeLineId = null;
let repertoireSearch = "";
let dirty = false;
let trainingGame = null;
let trainingMoves = [];
let trainingIndex = 0;
let trainingStartFen = DEFAULT_FEN;
let trainingInitialFen = DEFAULT_FEN;
let trainingInitialMoves = [];
let trainingErrors = 0;
let trainingHints = 0;
let trainingFirstTryErrors = 0;
let trainingRevealCount = 0;
let trainingMistakes = [];
let trainingMistakePlies = new Set();
let trainingHintLevel = 0;
let trainingRevealPending = false;
let trainingErrorAnimating = false;
let trainingErrorTimer = null;
let trainingElapsedSeconds = 0;
let trainingTimer = null;
let baseFen = DEFAULT_FEN;
let studioStates = [DEFAULT_FEN];
let studioSans = [];
let studioMoveObjects = [];
let studioPly = 0;
let studioTree = new RepertoireTree(DEFAULT_FEN);
let studioPath = [];
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

function readUiPreferences() {
  const defaults = { theme: "dark", boardTheme: "salvia", coordinates: "inside", motion: "system" };
  try {
    const saved = JSON.parse(localStorage.getItem(UI_SETTINGS_KEY) || "{}");
    return {
      theme: ["dark", "light", "system"].includes(saved.theme) ? saved.theme : defaults.theme,
      boardTheme: ["salvia", "noce", "ardesia"].includes(saved.boardTheme) ? saved.boardTheme : defaults.boardTheme,
      coordinates: ["inside", "hidden"].includes(saved.coordinates) ? saved.coordinates : defaults.coordinates,
      motion: ["system", "active", "reduced"].includes(saved.motion) ? saved.motion : defaults.motion,
    };
  } catch {
    return defaults;
  }
}

const uiPreferences = readUiPreferences();

function applyUiPreferences() {
  const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  const systemReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const theme = uiPreferences.theme === "system" ? (systemDark ? "dark" : "light") : uiPreferences.theme;
  const motion = uiPreferences.motion === "system" ? (systemReduced ? "reduced" : "active") : uiPreferences.motion;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.uiTheme = uiPreferences.theme;
  document.documentElement.dataset.boardTheme = uiPreferences.boardTheme;
  document.documentElement.dataset.coordinates = uiPreferences.coordinates;
  document.documentElement.dataset.motion = motion;
}

function saveUiPreferences() {
  try {
    localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(uiPreferences));
  } catch {
    showToast("Non riesco a salvare le preferenze visive in questa sessione.", { type: "warning" });
  }
}

applyUiPreferences();

function syncAppearanceControls() {
  $("#ui-theme").value = uiPreferences.theme;
  $("#board-theme").value = uiPreferences.boardTheme;
  $("#board-coordinates").value = uiPreferences.coordinates;
  $("#motion-setting").value = uiPreferences.motion;
}

function updateFenPanel() {
  const panel = $("#fen-panel");
  if (panel && !panel.hidden) $("#fen-value").textContent = activeGame().fen();
}

function toggleFenPanel() {
  const panel = $("#fen-panel");
  panel.hidden = !panel.hidden;
  updateFenPanel();
  if (!panel.hidden) $("#copy-fen-inline").focus();
}

function openShortcutsDialog() {
  const dialog = $("#shortcuts-dialog");
  dialog.hidden = false;
  $("#shortcuts-close").focus();
}

function closeShortcutsDialog() {
  $("#shortcuts-dialog").hidden = true;
  $("#shortcuts-toggle").focus();
}

function closeOpenMenus() {
  document.querySelectorAll("details[open]").forEach((details) => {
    if (details.classList.contains("appearance-menu") || details.classList.contains("action-menu")) {
      details.open = false;
    }
  });
}




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

function showToast(message, options = {}) {
  const container = $("#toast");
  if (!container) return;
  const inferred = /(errore|non riusc|non valido|non disponibile|non riesco|timeout)/i.test(String(message))
    ? "error"
    : "info";
  const type = ["success", "info", "warning", "error"].includes(options.type) ? options.type : inferred;
  const icon = { success: "✓", info: "i", warning: "!", error: "×" }[type];
  const item = document.createElement("div");
  item.className = "toast-item toast-" + type;
  item.setAttribute("role", type === "error" ? "alert" : "status");
  const mark = document.createElement("span");
  mark.className = "toast-icon";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = icon;
  const text = document.createElement("p");
  text.className = "toast-message";
  text.textContent = String(message);
  item.append(mark, text);
  if (type === "error") {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "Chiudi notifica");
    close.textContent = "×";
    close.addEventListener("click", () => item.remove());
    item.append(close);
  }
  container.append(item);
  while (container.children.length > 3) container.firstElementChild?.remove();
  const duration = type === "error" ? 10_000 : type === "warning" ? 5_000 : 2_800;
  let timer = window.setTimeout(() => item.remove(), duration);
  item.addEventListener("mouseenter", () => window.clearTimeout(timer));
  item.addEventListener("mouseleave", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => item.remove(), duration);
  });
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

function updateTopbarStatus() {
  const title = $("#topbar-title");
  const status = $("#topbar-save-status");
  if (title) title.textContent = titleInput?.value.trim() || "Nuovo repertorio";
  if (status) {
    const label = dirty ? "Modifiche non salvate" : activeLineId ? "Salvato" : "Non ancora salvato";
    status.textContent = label;
    status.dataset.state = dirty ? "dirty" : activeLineId ? "saved" : "new";
  }
}

function setDirty(value = true) {
  dirty = value;
  const indicator = $("#saved-indicator");
  if (indicator) {
    indicator.textContent = dirty ? "MODIFICHE NON SALVATE" : activeLineId ? "SALVATA" : "NON SALVATA";
    indicator.classList.toggle("unsaved", dirty);
  }
  updateTopbarStatus();
}

function confirmDialog({ title, message, actions, cancelValue = "cancel" }) {
  return new Promise((resolve) => {
    const dialog = $("#confirm-dialog");
    const actionsElement = $("#confirm-actions");
    const previousFocus = document.activeElement;
    const finish = (value) => {
      dialog.hidden = true;
      dialog.removeEventListener("keydown", onKeyDown);
      dialog.removeEventListener("click", onBackdrop);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      resolve(value);
    };
    const onBackdrop = (event) => {
      if (event.target === dialog) finish(cancelValue);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(cancelValue);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll("button:not(:disabled)")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    $("#confirm-title").textContent = title;
    $("#confirm-message").textContent = message;
    actionsElement.replaceChildren();
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button " + (action.variant || "ghost");
      button.textContent = action.label;
      button.addEventListener("click", async () => {
        if (action.value === "save") {
          button.disabled = true;
          const saved = await saveLine();
          button.disabled = false;
          if (!saved) return;
        }
        finish(action.value);
      });
      actionsElement.append(button);
      if (action.safe) button.dataset.safeAction = "true";
    }
    dialog.hidden = false;
    dialog.addEventListener("keydown", onKeyDown);
    dialog.addEventListener("click", onBackdrop);
    const initial = actionsElement.querySelector('[data-safe-action="true"]')
      || actionsElement.querySelector("button");
    initial?.focus();
  });
}

async function confirmDiscardChanges(action) {
  if (!dirty) return true;
  const choice = await confirmDialog({
    title: "Hai modifiche non salvate",
    message: "Il repertorio contiene modifiche non salvate. Per " + action + " puoi salvarle, scartarle oppure continuare a modificarlo.",
    actions: [
      { label: "Salva e continua", value: "save", variant: "primary" },
      { label: "Scarta modifiche", value: "discard", variant: "danger" },
      { label: "Continua a modificare", value: "cancel", variant: "ghost", safe: true },
    ],
  });
  return choice === "discard" || choice === "save";
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

function captureMoveAnimation(move) {
  const moving = [];
  const captured = [];
  const snapshot = (square) => {
    const piece = boardElement.querySelector('[data-square="' + square + '"] .piece');
    if (!piece) return null;
    return { square, rect: piece.getBoundingClientRect(), clone: piece.cloneNode(true) };
  };
  const from = snapshot(move.from);
  if (from) { from.to = move.to; moving.push(from); }

  const flags = String(move.flags || "");
  if (flags.includes("k") || flags.includes("q")) {
    const queenSide = flags.includes("q");
    const rookFrom = (queenSide ? "a" : "h") + move.from[1];
    const rook = snapshot(rookFrom);
    if (rook) {
      rook.to = (queenSide ? "d" : "f") + move.from[1];
      moving.push(rook);
    }
  }

  if (move.captured) {
    const captureSquare = flags.includes("e")
      ? move.to[0] + move.from[1]
      : move.to;
    const taken = snapshot(captureSquare);
    if (taken) captured.push(taken);
  }
  return { moving, captured };
}

function animateBoardMove(snapshot) {
  if (!snapshot || document.documentElement.dataset.motion === "reduced" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const item of snapshot.moving) {
    const newPiece = boardElement.querySelector('[data-square="' + (item.to || item.square) + '"] .piece');
    if (!newPiece) continue;
    const nextRect = newPiece.getBoundingClientRect();
    const dx = item.rect.left - nextRect.left;
    const dy = item.rect.top - nextRect.top;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) continue;
    newPiece.animate([
      { transform: "translate(" + dx + "px, " + dy + "px)" },
      { transform: "translate(0, 0)" },
    ], { duration: 190, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  }
  for (const item of snapshot.captured) {
    const clone = item.clone;
    if (!clone) continue;
    clone.classList.add("board-capture-ghost");
    clone.style.position = "fixed";
    clone.style.left = item.rect.left + "px";
    clone.style.top = item.rect.top + "px";
    clone.style.width = item.rect.width + "px";
    clone.style.height = item.rect.height + "px";
    clone.style.zIndex = "1000";
    document.body.append(clone);
    clone.animate([
      { opacity: 1, transform: "scale(1)" },
      { opacity: 0, transform: "scale(0.9)" },
    ], { duration: 120, easing: "ease-out" }).finished.finally(() => clone.remove());
  }
}

function boardSquareAtPoint(x, y) {
  const element = document.elementFromPoint(x, y);
  const square = element?.closest?.(".square[data-square]");
  return square && boardElement.contains(square) ? square : null;
}

function updateDragGhost(event) {
  if (!dragState?.ghost) return;
  dragState.ghost.style.left = event.clientX + "px";
  dragState.ghost.style.top = event.clientY + "px";
}

function clearDragState() {
  if (!dragState) return;
  dragState.ghost?.remove();
  boardElement.querySelector(".square.drag-over")?.classList.remove("drag-over");
  boardElement.querySelector(".piece.dragging-source")?.classList.remove("dragging-source");
  dragState = null;
}

function beginBoardDrag(event) {
  if (event.button !== 0 || event.isPrimary === false || trainingErrorAnimating || (mode === "studio" && chessLab && !chessLab.canHumanMove())) return;
  const squareButton = event.target.closest?.(".square[data-square]");
  if (!squareButton) return;
  const chess = activeGame();
  const from = squareButton.dataset.square;
  const piece = chess.get(from);
  if (!piece || piece.color !== chess.turn() || chess.isGameOver() || pendingPromotion) return;
  dragState = {
    pointerId: event.pointerId,
    from,
    color: piece.color,
    type: piece.type,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    target: null,
    legalMoves: chess.moves({ square: from, verbose: true }),
    ghost: null,
  };
}

function moveBoardDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId || trainingErrorAnimating) return;
  const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
  if (!dragState.active && distance < 5) return;

  if (!dragState.active) {
    dragState.active = true;
    try { boardElement.setPointerCapture(event.pointerId); } catch { /* Il puntatore può essere già stato catturato. */ }
    selectedSquare = dragState.from;
    renderBoard();
    const source = boardElement.querySelector('[data-square="' + dragState.from + '"] .piece');
    source?.classList.add("dragging-source");
    const ghost = document.createElement("div");
    ghost.className = "board-drag-ghost";
    ghost.append(createPieceElement(dragState.color, dragState.type));
    document.body.append(ghost);
    dragState.ghost = ghost;
  }

  event.preventDefault();
  updateDragGhost(event);
  const targetSquare = boardSquareAtPoint(event.clientX, event.clientY);
  const nextTarget = targetSquare?.dataset.square || null;
  if (dragState.target !== nextTarget) {
    boardElement.querySelector(".square.drag-over")?.classList.remove("drag-over");
    dragState.target = nextTarget;
    if (targetSquare) targetSquare.classList.add("drag-over");
  }
}

function endBoardDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const state = dragState;
  const targetSquare = boardSquareAtPoint(event.clientX, event.clientY)?.dataset.square || null;
  if (!state.active) {
    dragState = null;
    return;
  }

  suppressBoardClick = true;
  window.setTimeout(() => { suppressBoardClick = false; }, 0);
  clearDragState();
  const legal = state.legalMoves.filter((move) => move.to === targetSquare);
  if (!legal.length) {
    selectedSquare = null;
    renderBoard();
    return;
  }
  const promotions = legal.filter((move) => Boolean(move.promotion));
  if (promotions.length) {
    openPromotionChooser(state.from, targetSquare, promotions);
    return;
  }
  commitSelectedMove(legal[0]);
}

function cancelBoardDrag(event) {
  if (!dragState || (event && event.pointerId !== dragState.pointerId)) return;
  const wasActive = dragState.active;
  clearDragState();
  if (wasActive) {
    selectedSquare = null;
    renderBoard();
  }
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
      const expectedTrainingMove = mode === "training" ? trainingMoves[trainingIndex] : null;
      if (expectedTrainingMove && trainingHintLevel >= 1 && square === expectedTrainingMove.from) button.classList.add("hint-source");
      if (expectedTrainingMove && trainingHintLevel >= 2 && square === expectedTrainingMove.to) button.classList.add("hint-target");
      if (mode === "training" && (!trainingMoves.length || trainingErrorAnimating)) button.disabled = true;

      if (piece) {
        button.append(createPieceElement(piece.color, piece.type));
        button.setAttribute("aria-label", pieceNames[piece.type] + " " + (piece.color === "w" ? "bianco" : "nero") + " in " + square);
      } else {
        button.setAttribute("aria-label", "Casa vuota " + square);
      }

      if (displayCol === 0) {
        const rank = document.createElement("span");
        rank.className = "coord-label coord-rank";
        rank.textContent = String(8 - rowIndex);
        rank.setAttribute("aria-hidden", "true");
        button.append(rank);
      }
      if (displayRow === 7) {
        const file = document.createElement("span");
        file.className = "coord-label coord-file";
        file.textContent = files[colIndex];
        file.setAttribute("aria-hidden", "true");
        button.append(file);
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
  updateFenPanel();
  $("#line-move-count").textContent = mode === "training"
    ? trainingIndex + " / " + trainingMoves.length + " mosse eseguite"
    : studioPly + " / " + studioSans.length + " semimosse · posizione " + (studioPly + 1);
  $("#board-label").textContent = mode === "training" ? "ALLENAMENTO" : "STUDIO";
  $("#board-orientation").textContent = boardFlipped ? "Vista: Nero" : "Vista: Bianco";
  $("#undo").disabled = mode === "training" || studioPly === 0;
  $("#redo").disabled = mode === "training" || studioPly >= studioSans.length;
  $("#flip-board").textContent = "↻";
  $("#flip-board").setAttribute("aria-pressed", String(boardFlipped));
  $("#flip-board").setAttribute("aria-label", "Ruota la scacchiera (F)");
  $("#flip-board").title = "Ruota la scacchiera (F) · Vista: " + (boardFlipped ? "Nero" : "Bianco");
}

function renderMoves() {
  const allMoves = mode === "training" ? trainingMoves : studioMoveObjects;
  const cursor = mode === "training" ? trainingIndex : studioPly;
  const moves = mode === "training" ? allMoves.slice(0, cursor) : allMoves;
  moveListElement.replaceChildren();

  if (!moves.length) {
    const empty = document.createElement("span");
    empty.className = "empty-state";
    empty.textContent = mode === "training"
      ? "Le mosse giocate appariranno qui."
      : "Gioca una mossa sulla scacchiera per iniziare.";
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
        const edge = studioTree.getEdge(studioPath[moveIndex]);
        const notes = [edge?.comment, ...(edge?.nags || [])].filter(Boolean);
        if (notes.length) san.title = notes.join(" · ");
        san.setAttribute("aria-label", "Vai alla posizione dopo " + san.textContent
          + (notes.length ? ". Annotazioni: " + notes.join(", ") : ""));
        san.setAttribute("aria-pressed", String(ply === studioPly));
        san.addEventListener("click", () => positionForPly(ply));
      }
      row.append(san);
    }
    moveListElement.append(row);
  }

  const current = moveListElement.querySelector(".current-move");
  current?.scrollIntoView({
    block: "nearest",
    behavior: document.documentElement.dataset.motion === "reduced" ? "auto" : "smooth",
  });
}

function relativeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startToday - startDate) / 86_400_000);
  if (days <= 0) return "oggi";
  if (days === 1) return "ieri";
  if (days < 7) return days + " giorni fa";
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  }).format(date);
}

function renderRepertoire() {
  const list = $("#repertoire-list");
  list.replaceChildren();

  if (repertoire.length > 6) {
    const search = document.createElement("div");
    search.className = "repertoire-search";
    const input = document.createElement("input");
    input.type = "search";
    input.className = "text-input";
    input.placeholder = "Cerca nei repertori…";
    input.setAttribute("aria-label", "Cerca nei repertori");
    input.value = repertoireSearch;
    input.addEventListener("input", () => {
      repertoireSearch = input.value;
      renderRepertoire();
      const next = list.querySelector("input[type=search]");
      next?.focus();
      next?.setSelectionRange(repertoireSearch.length, repertoireSearch.length);
    });
    search.append(input);
    list.append(search);
  }

  if (!repertoire.length) {
    const empty = document.createElement("div");
    empty.className = "repertoire-empty";
    const message = document.createElement("p");
    message.textContent = "Qui compariranno i tuoi repertori.";
    const create = document.createElement("button");
    create.type = "button";
    create.className = "button small primary";
    create.textContent = "Crea il primo repertorio";
    create.addEventListener("click", () => { void newPosition(); });
    empty.append(message, create);
    list.append(empty);
    return;
  }

  const query = repertoireSearch.trim().toLocaleLowerCase("it");
  const matches = repertoire.filter((line) => String(line.title || "Repertorio senza nome")
    .toLocaleLowerCase("it").includes(query));
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "repertoire-empty";
    empty.textContent = "Nessun repertorio corrisponde a “" + repertoireSearch.trim() + "”.";
    list.append(empty);
    return;
  }

  for (const line of matches) {
    const row = document.createElement("div");
    row.className = "repertoire-entry";
    if (line.id === activeLineId) row.classList.add("current");

    const open = document.createElement("button");
    open.type = "button";
    open.className = "repertoire-open";
    const title = line.title || "Repertorio senza nome";
    open.title = title;
    const name = document.createElement("span");
    name.className = "repertoire-name";
    name.textContent = title;
    const meta = document.createElement("small");
    const count = Number.isInteger(line.edgeCount)
      ? line.edgeCount
      : (Array.isArray(line.sans) ? line.sans.length : 0);
    const positions = Number.isInteger(line.nodeCount) ? line.nodeCount : 0;
    const date = relativeDate(line.updatedAt || line.createdAt);
    meta.textContent = count + " " + (count === 1 ? "mossa" : "mosse")
      + (positions ? " · " + positions + " " + (positions === 1 ? "posizione" : "posizioni") : "")
      + (date ? " · " + date : "");
    open.append(name, meta);
    open.setAttribute("aria-label", "Apri repertorio " + title + ". " + meta.textContent);
    open.addEventListener("click", () => { void openLine(line.id); });

    const menu = document.createElement("details");
    menu.className = "repertoire-menu";
    const summary = document.createElement("summary");
    summary.textContent = "⋯";
    summary.setAttribute("aria-label", "Azioni per " + title);
    const panel = document.createElement("div");
    panel.className = "repertoire-menu-panel";
    const action = (label, callback, danger = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = danger ? "menu-danger" : "";
      button.textContent = label;
      button.addEventListener("click", async () => {
        menu.open = false;
        await callback();
      });
      panel.append(button);
    };
    action("Apri", () => openLine(line.id));
    action("Allena", async () => {
      if (await openLine(line.id)) startTraining();
    });
    const separator = document.createElement("div");
    separator.className = "menu-separator";
    panel.append(separator);
    action("Elimina", () => deleteLine(line.id), true);
    menu.append(summary, panel);
    row.append(open, menu);
    list.append(row);
  }
}

function renderMode() {
  const training = mode === "training";
  $("#nav-studio").classList.toggle("active", !training);
  $("#nav-training").classList.toggle("active", training);
  $("#nav-studio").setAttribute("aria-current", training ? "false" : "page");
  $("#nav-training").setAttribute("aria-current", training ? "page" : "false");
  $("#mode-eyebrow").textContent = training ? "ALLENAMENTO" : "STUDIO";
  $("#page-title").dataset.mode = training ? "training" : "studio";
  titleInput.readOnly = training;
  titleInput.setAttribute("aria-label", training ? "Repertorio in allenamento" : "Nome del repertorio");
  $("#page-subtitle").textContent = training
    ? "Rigioca la linea dall'inizio. Ogni mossa sbagliata viene annullata."
      + (dirty ? " Stai allenando la versione corrente, non ancora salvata." : "")
    : "Costruisci il tuo repertorio una mossa alla volta, con varianti e trasposizioni.";
  $("#save-line").disabled = training || !databaseReady;
  $("#reset").textContent = training ? "Esci dall'allenamento" : "Nuovo";
  document.body.dataset.mode = training ? "training" : "studio";
  $("#training-session-card").hidden = !training;
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

function formatElapsed(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return String(minutes).padStart(2, "0") + ":" + String(remainder).padStart(2, "0");
}

function stopTrainingTimer() {
  if (trainingTimer !== null) {
    window.clearInterval(trainingTimer);
    trainingTimer = null;
  }
}

function startTrainingTimer() {
  stopTrainingTimer();
  trainingElapsedSeconds = 0;
  trainingTimer = window.setInterval(() => {
    if (mode !== "training" || trainingIndex >= trainingMoves.length || document.visibilityState !== "visible") return;
    trainingElapsedSeconds += 1;
    renderTrainingSession();
  }, 1000);
}

function resetTrainingCounters() {
  if (trainingErrorTimer !== null) window.clearTimeout(trainingErrorTimer);
  trainingErrorTimer = null;
  trainingErrorAnimating = false;
  trainingErrors = 0;
  trainingHints = 0;
  trainingFirstTryErrors = 0;
  trainingRevealCount = 0;
  trainingMistakes = [];
  trainingMistakePlies = new Set();
  trainingHintLevel = 0;
  trainingRevealPending = false;
  trainingErrorAnimating = false;
  startTrainingTimer();
}

function trainingPrecision() {
  if (!trainingMoves.length) return null;
  const mistakes = trainingFirstTryErrors + trainingRevealCount;
  return Math.max(0, Math.min(100, (trainingMoves.length - mistakes) / trainingMoves.length * 100));
}

function setTrainingStatus(message, type = "normal") {
  const status = $("#training-status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", type === "error");
  status.classList.toggle("success", type === "success");
}

function renderTrainingHistory() {
  const target = $("#training-move-history");
  target.replaceChildren();
  const moves = trainingMoves.slice(0, trainingIndex);
  if (!moves.length) {
    const empty = document.createElement("span");
    empty.className = "empty-state";
    empty.textContent = "Le mosse giocate appariranno qui.";
    target.append(empty);
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
      const move = moves[index + offset];
      const san = document.createElement("span");
      san.className = "san";
      san.textContent = move.san;
      row.append(san);
    }
    target.append(row);
  }
}

function renderTrainingSession() {
  const card = $("#training-session-card");
  if (!card) return;
  const empty = mode === "training" && trainingMoves.length === 0;
  $("#training-empty").hidden = !empty;
  $("#training-session-content").hidden = empty;
  if (empty) {
    $("#training-session-heading").textContent = "Allenamento";
    return;
  }
  const completed = mode === "training" && trainingMoves.length > 0 && trainingIndex >= trainingMoves.length;
  const total = trainingMoves.length;
  const ratio = total ? Math.min(100, trainingIndex / total * 100) : 0;
  const progress = $("#training-progressbar");
  progress.setAttribute("aria-valuemax", String(total));
  progress.setAttribute("aria-valuenow", String(trainingIndex));
  progress.setAttribute("aria-valuetext", trainingIndex + " mosse completate su " + total);
  $("#training-progress-fill").style.width = ratio + "%";
  $("#training-progress-label").textContent = "Mossa " + Math.min(trainingIndex + (completed ? 0 : 1), total) + " di " + total;
  $("#training-errors").textContent = String(trainingErrors);
  $("#training-moves-correct").textContent = String(Math.max(0, trainingIndex - trainingRevealCount));
  $("#training-hints").textContent = String(trainingHints);
  $("#training-elapsed").textContent = formatElapsed(trainingElapsedSeconds);
  renderTrainingHistory();
  $("#training-session-heading").textContent = completed ? "Linea completata" : "Sessione";
  $("#training-hint").hidden = completed;
  $("#training-reveal").hidden = completed;
  $("#training-restart").textContent = completed ? "Ripeti" : "Ricomincia";
  const summary = $("#training-summary");
  summary.hidden = !completed;
  if (completed) {
    const precision = trainingPrecision();
    const detail = trainingMistakes.length
      ? trainingMistakes.sort((a, b) => a - b).join(", ")
      : "";
    const title = document.createElement("h3");
    title.textContent = "Linea completata";
    const grid = document.createElement("div");
    grid.className = "training-summary-grid";
    const values = [
      ["Mosse", total],
      ["Errori", trainingErrors],
      ["Suggerimenti", trainingHints],
      ["Tempo", formatElapsed(trainingElapsedSeconds)],
      ["Precisione", precision.toFixed(1) + "%"],
    ];
    for (const [label, value] of values) {
      const cell = document.createElement("span");
      const strong = document.createElement("b");
      strong.textContent = String(value);
      cell.append(strong, document.createElement("br"), document.createTextNode(label));
      grid.append(cell);
    }
    const message = document.createElement("p");
    message.textContent = trainingErrors === 0
      ? "Nessun errore: linea memorizzata."
      : "Hai commesso " + trainingErrors + " errori" + (detail ? ". Ripassa le mosse " + detail + "." : ".");
    summary.replaceChildren(title, grid, message);
  } else {
    summary.replaceChildren();
  }
}

function addTrainingError(ply) {
  trainingErrors += 1;
  if (!trainingMistakePlies.has(ply)) {
    trainingMistakePlies.add(ply);
    trainingMistakes.push(ply);
    trainingFirstTryErrors += 1;
  }
  renderTrainingSession();
}

function showTrainingHint() {
  if (mode !== "training" || trainingIndex >= trainingMoves.length || trainingErrorAnimating) return;
  trainingHintLevel = Math.min(3, trainingHintLevel + 1);
  trainingHints += 1;
  const expected = trainingMoves[trainingIndex];
  const levelText = trainingHintLevel === 1
    ? "Inizia dalla casa " + expected.from + "."
    : trainingHintLevel === 2
      ? "Sposta il pezzo da " + expected.from + " a " + expected.to + "."
      : "La notazione della mossa è " + expected.san + ".";
  $("#training-hint-text").textContent = levelText;
  setTrainingStatus("Suggerimento " + trainingHintLevel + " di 3.");
  renderBoard();
  renderTrainingSession();
}

function revealTrainingMove() {
  if (mode !== "training" || trainingIndex >= trainingMoves.length || trainingErrorAnimating) return;
  const expected = trainingMoves[trainingIndex];
  const move = trainingGame.moves({ square: expected.from, verbose: true }).find((candidate) =>
    candidate.to === expected.to
    && (candidate.promotion || undefined) === (expected.promotion || undefined)
  );
  if (!move) {
    setTrainingStatus("La mossa attesa non è legale in questa posizione.", "error");
    return;
  }
  trainingHints += 1;
  trainingErrors += 1;
  trainingRevealCount += 1;
  trainingMistakes.push(trainingIndex + 1);
  trainingHintLevel = 0;
  trainingRevealPending = true;
  setTrainingStatus("Mossa mostrata: " + expected.san + ".", "error");
  renderTrainingSession();
  commitSelectedMove(move);
}

function restartTraining() {
  if (mode !== "training" || !trainingInitialMoves.length) return;
  trainingMoves = trainingInitialMoves.map((move) => ({ ...move }));
  trainingStartFen = trainingInitialFen;
  trainingGame = new Chess(trainingStartFen);
  trainingIndex = 0;
  selectedSquare = null;
  resetTrainingCounters();
  renderAll();
  setTrainingStatus("Allenamento ricominciato. Trova la prima mossa.");
}

function renderAll() {
  stopAnalysisForChangedPosition();
  renderBoard();
  renderMoves();
  renderVariations();
  renderRepertoire();
  renderMode();
  renderTrainingSession();
  chessLab?.onPositionChanged();
}

function closePromotionChooser() {
  pendingPromotion = null;
  promotionDialog.hidden = true;
  promotionOptions.replaceChildren();
  const origin = promotionOriginSquare;
  promotionOriginSquare = null;
  if (origin) window.setTimeout(() => boardElement.querySelector('[data-square="' + origin + '"]')?.focus(), 0);
}

function openPromotionChooser(from, to, legalMoves) {
  const chess = activeGame();
  pendingPromotion = { from, to, legalMoves };
  promotionOriginSquare = from;
  promotionOptions.replaceChildren();
  const color = chess.turn();

  for (const type of ["q", "r", "b", "n"]) {
    const choice = legalMoves.find((move) => move.promotion === type);
    if (!choice) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "promotion-choice";
    button.setAttribute("aria-label", "Promuovi a " + promotionNames[type]);
    button.setAttribute("aria-keyshortcuts", ({ q: "D 1", r: "T 2", b: "A 3", n: "C 4" })[type]);
    button.dataset.promotion = type;
    const piece = createPieceElement(color, type);
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
    if (!expected || trainingErrorAnimating) return;
    const animation = captureMoveAnimation(selectedMove);
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
      return;
    }

    const correct = played.from === expected.from
      && played.to === expected.to
      && (played.promotion || undefined) === (expected.promotion || undefined);
    if (!correct) {
      addTrainingError(trainingIndex + 1);
      trainingHintLevel = 0;
      $("#training-hint-text").textContent = "";
      setTrainingStatus("Non è la mossa del repertorio. Riprova.", "error");
      selectedSquare = null;
      const target = played.to;
      const reduced = document.documentElement.dataset.motion === "reduced"
        || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        trainingGame.undo();
        renderBoard();
        const square = boardElement.querySelector('[data-square="' + target + '"]');
        square?.classList.add("training-error");
        window.setTimeout(() => square?.classList.remove("training-error"), 600);
      } else {
        trainingErrorAnimating = true;
        renderBoard();
        animateBoardMove(animation);
        if (trainingErrorTimer !== null) window.clearTimeout(trainingErrorTimer);
        trainingErrorTimer = window.setTimeout(() => {
          trainingErrorTimer = null;
          if (mode !== "training" || !trainingGame) {
            trainingErrorAnimating = false;
            return;
          }
          trainingGame.undo();
          renderBoard();
          const square = boardElement.querySelector('[data-square="' + target + '"]');
          square?.classList.add("training-error");
          window.setTimeout(() => square?.classList.remove("training-error"), 600);
          trainingErrorAnimating = false;
          renderTrainingSession();
        }, 200);
      }
      return;
    }

    const revealed = trainingRevealPending;
    trainingRevealPending = false;
    trainingIndex += 1;
    trainingHintLevel = 0;
    selectedSquare = null;
    $("#training-hint-text").textContent = "";
    renderAll();
    animateBoardMove(animation);
    if (revealed) {
      setTrainingStatus("Mossa mostrata: " + played.san + ".", "error");
    } else {
      setTrainingStatus(trainingIndex === trainingMoves.length ? "Linea completata." : "Mossa corretta.", "success");
    }
    const destination = boardElement.querySelector('[data-square="' + played.to + '"]');
    destination?.classList.add("training-success");
    window.setTimeout(() => destination?.classList.remove("training-success"), 350);
    if (trainingIndex >= trainingMoves.length) {
      stopTrainingTimer();
      renderTrainingSession();
    }
    return;
  }

  if (game.isGameOver()) {
    showToast(gameStatus(game));
    return;
  }

  const animation = captureMoveAnimation(selectedMove);
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
  animateBoardMove(animation);
}

function handleSquareClick(square) {
  if (trainingErrorAnimating || (mode === "training" && !trainingMoves.length)) return;
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
    const destination = boardElement.querySelector('[data-square="' + square + '"]');
    destination?.classList.add("invalid-move");
    window.setTimeout(() => destination?.classList.remove("invalid-move"), 120);
    return;
  }

  const promotions = choices.filter((move) => Boolean(move.promotion));
  if (promotions.length) {
    openPromotionChooser(selectedSquare, square, promotions);
    return;
  }

  commitSelectedMove(choices[0]);
}

async function openLine(id) {
  const line = repertoire.find((item) => item.id === id);
  if (!line || !(await confirmDiscardChanges("aprire un altro repertorio"))) return false;
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
    return true;
  } catch (error) {
    showToast("PGN non leggibile: " + error.message, { type: "error" });
    return false;
  }
}

async function deleteLine(id) {
  const line = repertoire.find((item) => item.id === id);
  if (!line) return;
  const title = line.title || "Repertorio senza nome";
  const accepted = await confirmDialog({
    title: "Eliminare “" + title + "”?",
    message: "Il repertorio verrà eliminato definitivamente da questo dispositivo. Esporta il PGN prima, se vuoi conservarne una copia.",
    actions: [
      { label: "Annulla", value: "cancel", variant: "ghost", safe: true },
      { label: "Elimina repertorio", value: "delete", variant: "danger" },
    ],
  });
  if (accepted !== "delete") return;
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
  if (mode === "training") return false;
  if (!databaseReady) {
    showToast("Database non pronto: il salvataggio è disattivato.", { type: "error" });
    return false;
  }
  if (!studioTree.edges.size) {
    showToast("Aggiungi almeno una mossa prima di salvare.", { type: "warning" });
    return false;
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
      if (!persistRepertoire()) return false;
    }
    activeLineId = id;
    setDirty(false);
    renderAll();
    showToast("Repertorio salvato.", { type: "success" });
    return true;
  } catch (error) {
    showToast("Errore salvataggio SQLite: " + error.message, { type: "error" });
    return false;
  }
}

async function openGeneratedPuzzle(fen, solutionUci) {
  if (!(await confirmDiscardChanges("aprire il puzzle generato"))) return false;
  const puzzle = new Chess(fen);
  const expected = puzzle.moves({ verbose: true }).find((move) =>
    move.from + move.to + (move.promotion || "") === solutionUci
  );
  if (!expected) return false;

  chessLab?.stopPlay();
  trainingInitialFen = fen;
  trainingInitialMoves = [{
    from: expected.from,
    to: expected.to,
    san: expected.san,
    ...(expected.promotion ? { promotion: expected.promotion } : {}),
  }];
  trainingStartFen = trainingInitialFen;
  trainingMoves = trainingInitialMoves.map((move) => ({ ...move }));
  trainingGame = new Chess(trainingStartFen);
  trainingIndex = 0;
  selectedSquare = null;
  mode = "training";
  resetTrainingCounters();
  closePromotionChooser();
  renderAll();
  setTrainingStatus("Puzzle avviato. Trova la mossa che evita l'errore.");
  return true;
}

function startTraining() {
  if (mode === "training") {
    restartTraining();
    return;
  }
  chessLab?.stopPlay();
  trainingInitialMoves = studioMoveObjects.map((move) => ({
    from: move.from,
    to: move.to,
    san: move.san,
    ...(move.promotion ? { promotion: move.promotion } : {}),
  }));
  trainingInitialFen = baseFen;
  trainingMoves = trainingInitialMoves.map((move) => ({ ...move }));
  trainingStartFen = trainingInitialFen;
  trainingGame = new Chess(trainingStartFen);
  trainingIndex = 0;
  selectedSquare = null;
  mode = "training";
  closePromotionChooser();
  if (trainingMoves.length) {
    resetTrainingCounters();
  } else {
    stopTrainingTimer();
    trainingElapsedSeconds = 0;
    trainingErrors = 0;
    trainingHints = 0;
    trainingFirstTryErrors = 0;
    trainingRevealCount = 0;
    trainingMistakes = [];
    trainingMistakePlies = new Set();
    trainingHintLevel = 0;
  }
  renderAll();
  if (trainingMoves.length) setTrainingStatus("Rigioca la linea dall'inizio. Trova la prima mossa.");
}


function leaveTraining() {
  stopTrainingTimer();
  if (trainingErrorTimer !== null) window.clearTimeout(trainingErrorTimer);
  trainingErrorTimer = null;
  mode = "studio";
  trainingGame = null;
  trainingMoves = [];
  trainingInitialMoves = [];
  trainingIndex = 0;
  trainingHintLevel = 0;
  trainingErrorAnimating = false;
  trainingRevealPending = false;
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
  if (!(await confirmDiscardChanges("importare le partite selezionate"))) {
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
    await openLine(savedEntries[0].id);
    renderAll();
  }
  return { saved: savedEntries.length, skipped, errors };
}

async function importPgn() {
  const text = $("#pgn-input").value.trim();
  if (!text) {
    showToast("Incolla prima un testo PGN.");
    return;
  }
  try {
    const imported = RepertoireTree.fromPgn(text);
    if (!(await confirmDiscardChanges("importare questo PGN"))) return;
    chessLab?.stopPlay();
    rebuildTimeline(imported);
    mode = "studio";
    activeLineId = null;
    titleInput.value = "Repertorio importato";
    setDirty(true);
    closePromotionChooser();
    renderAll();
    showToast("PGN importato: varianti e trasposizioni caricate.", { type: "success" });
  } catch (error) {
    showToast("PGN non valido: " + error.message, { type: "error" });
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
  showToast("File PGN esportato.", { type: "success" });
}

async function newPosition() {
  if (mode === "training") {
    leaveTraining();
    return;
  }
  if (!(await confirmDiscardChanges("creare un nuovo repertorio"))) return;
  chessLab?.stopPlay();
  baseFen = DEFAULT_FEN;
  studioTree = new RepertoireTree(DEFAULT_FEN);
  syncStudioPath([]);
  studioPly = 0;
  activeLineId = null;
  selectedSquare = null;
  closePromotionChooser();
  titleInput.value = "Nuovo repertorio";
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

boardElement.addEventListener("pointerdown", beginBoardDrag);
boardElement.addEventListener("pointermove", moveBoardDrag);
boardElement.addEventListener("pointerup", endBoardDrag);
boardElement.addEventListener("pointercancel", cancelBoardDrag);
boardElement.addEventListener("lostpointercapture", cancelBoardDrag);
boardElement.addEventListener("click", (event) => {
  if (suppressBoardClick) {
    suppressBoardClick = false;
    return;
  }
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
$("#to-start").addEventListener("click", () => {
  if (mode === "studio") positionForPly(0);
});
$("#to-end").addEventListener("click", () => {
  if (mode === "studio") positionForPly(studioSans.length);
});
$("#flip-board").addEventListener("click", () => {
  boardFlipped = !boardFlipped;
  renderBoard();
});
$("#copy-fen").addEventListener("click", copyFen);
$("#copy-fen-inline").addEventListener("click", copyFen);
$("#save-line").addEventListener("click", () => { void saveLine(); });
$("#import-pgn").addEventListener("click", () => {
  const tools = document.querySelector(".tools-card");
  if (tools) tools.open = true;
  $("#pgn-input").focus();
});
$("#export-pgn").addEventListener("click", exportPgn);
$("#import-pgn-inline").addEventListener("click", () => { void importPgn(); });
$("#export-pgn-inline").addEventListener("click", exportPgn);

const appearanceMenu = document.querySelector(".appearance-menu");
syncAppearanceControls();
appearanceMenu.addEventListener("toggle", () => {
  $("#appearance-toggle").setAttribute("aria-expanded", String(appearanceMenu.open));
});
$("#ui-theme").addEventListener("change", (event) => {
  uiPreferences.theme = event.target.value;
  applyUiPreferences();
  saveUiPreferences();
});
$("#board-theme").addEventListener("change", (event) => {
  uiPreferences.boardTheme = event.target.value;
  applyUiPreferences();
  saveUiPreferences();
  renderBoard();
});
$("#board-coordinates").addEventListener("change", (event) => {
  uiPreferences.coordinates = event.target.value;
  applyUiPreferences();
  saveUiPreferences();
});
$("#motion-setting").addEventListener("change", (event) => {
  uiPreferences.motion = event.target.value;
  applyUiPreferences();
  saveUiPreferences();
});
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (uiPreferences.theme === "system") applyUiPreferences();
});
window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener("change", () => {
  if (uiPreferences.motion === "system") applyUiPreferences();
});
$("#shortcuts-toggle").addEventListener("click", openShortcutsDialog);
$("#shortcuts-close").addEventListener("click", closeShortcutsDialog);
$("#shortcuts-dialog").addEventListener("click", (event) => {
  if (event.target === $("#shortcuts-dialog")) closeShortcutsDialog();
});
$("#training-hint").addEventListener("click", showTrainingHint);
$("#training-reveal").addEventListener("click", revealTrainingMove);
$("#training-restart").addEventListener("click", restartTraining);
$("#training-exit").addEventListener("click", leaveTraining);
$("#training-empty-exit").addEventListener("click", leaveTraining);

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
titleInput.addEventListener("input", () => { setDirty(true); updateTopbarStatus(); });

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const typing = target instanceof HTMLElement && (
    target.isContentEditable
    || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );

  if (pendingPromotion) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePromotionChooser();
      selectedSquare = null;
      renderBoard();
      return;
    }
    if (event.key === "Tab") {
      const options = [...promotionDialog.querySelectorAll("button:not(:disabled)")];
      const first = options[0];
      const last = options[options.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
      return;
    }
    const choice = ({ "1": "q", d: "q", "2": "r", t: "r", "3": "b", a: "b", "4": "n", c: "n" })[event.key.toLowerCase()];
    if (choice) {
      const button = promotionOptions.querySelector('[data-promotion="' + choice + '"]');
      if (button) {
        event.preventDefault();
        button.click();
      }
    }
    return;
  }

  if (!$("#shortcuts-dialog").hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeShortcutsDialog();
      return;
    }
    if (event.key === "Tab") {
      const buttons = [...$("#shortcuts-dialog").querySelectorAll("button:not(:disabled)")];
      if (buttons.length && event.shiftKey && document.activeElement === buttons[0]) {
        event.preventDefault();
        buttons[buttons.length - 1].focus();
      } else if (buttons.length && !event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
        event.preventDefault();
        buttons[0].focus();
      }
      return;
    }
  }

  if (event.key === "Escape") {
    closeOpenMenus();
    if (selectedSquare) {
      selectedSquare = null;
      renderBoard();
    }
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (mode === "studio") void saveLine();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    if (mode === "studio") void newPosition();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") {
    event.preventDefault();
    if (mode === "studio") toggleFenPanel();
    return;
  }
  if (typing) return;
  if (mode === "training" && event.key.toLowerCase() === "h") {
    event.preventDefault();
    showTrainingHint();
    return;
  }
  if (event.key === "?" || (event.shiftKey && event.key === "/")) {
    event.preventDefault();
    openShortcutsDialog();
    return;
  }
  if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    boardFlipped = !boardFlipped;
    renderBoard();
    return;
  }
  if (mode !== "studio") return;
  if (target instanceof HTMLElement && target.tagName === "BUTTON" && !target.matches(".square, .san-move")) return;
  if (event.key === "ArrowLeft" && studioPly > 0) {
    event.preventDefault();
    positionForPly(studioPly - 1);
  } else if (event.key === "ArrowRight" && studioPly < studioSans.length) {
    event.preventDefault();
    positionForPly(studioPly + 1);
  } else if (event.key === "Home") {
    event.preventDefault();
    positionForPly(0);
  } else if (event.key === "End") {
    event.preventDefault();
    positionForPly(studioSans.length);
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
  getHeaders: () => ({ ...(studioTree.headers || {}) }),
  getPlayerNames: () => {
    try {
      const profiles = JSON.parse(localStorage.getItem("chess-os.connected-accounts.v1") || "{}");
      return [profiles.chesscom, profiles.lichess].filter((name) => typeof name === "string" && name.trim());
    } catch {
      return [];
    }
  },
  openPuzzle: openGeneratedPuzzle,
  openArchiveGame: (id) => {
    return openLine(id);
  },
});
void initializePersistence();