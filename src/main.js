import { Chess } from "chess.js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { RepertoireTree } from "./repertoire-tree.js";
import { initializeChessSuite } from "./chess-suite.js";
import { initializeExtendedTraining } from "./extended-training.js";
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
let reviewQueue = [];
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
let chessSuite = null;
let extendedTraining = null;

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
    };
  } catch {
    return { cards: [], logs: [], sessions: [] };
  }
}

function persistLocalReviewState() {
  try {
    localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify({
      cards: studyCards,
      logs: reviewLogs,
      sessions: reviewSessions,
    }));
    return true;
  } catch {
    showToast("Non riesco a salvare lo storico FSRS nella memoria locale.");
    return false;
  }
}

async function loadStudyData() {
  if (persistenceMode === "sqlite") {
    const [storedCards, storedLogs, storedSessions] = await Promise.all([
      invoke("list_study_cards"),
      invoke("list_review_logs"),
      invoke("list_training_sessions"),
    ]);
    studyCards = storedCards.map((record) => {
      let fsrs;
      try { fsrs = JSON.parse(record.fsrsJson); } catch { fsrs = null; }
      return { ...record, fsrs };
    }).filter((record) => record.fsrs && typeof record.fsrs === "object");
    reviewLogs = storedLogs;
    reviewSessions = storedSessions;
  } else {
    const saved = readReviewState();
    studyCards = saved.cards;
    reviewLogs = saved.logs;
    reviewSessions = saved.sessions;
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
  if (mode === "training") return reviewLastMove;
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
  const currentCount = mode === "training" ? reviewCompleted : studioPly;
  const totalCount = mode === "training" ? reviewSessionTotal : studioSans.length;
  $("#move-count").textContent = mode === "training"
    ? currentCount + " / " + totalCount + " carte"
    : currentCount + " / " + totalCount + " semimosse";
  $("#line-move-count").textContent = mode === "training"
    ? (currentReviewCard ? currentReviewCard.repertoireTitle + " · " + currentReviewCard.side : "Sessione giornaliera")
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
  $("#mode-eyebrow").textContent = training ? "REPERTORIO / RIPASSO FSRS" : "REPERTORIO / ANALISI";
  $("#page-title").textContent = training ? "Ripasso giornaliero" : "Chess Studio";
  $("#page-subtitle").textContent = training
    ? "Allena il richiamo delle mosse con intervalli adattivi."
    : "Costruisci linee principali, varianti e transposizioni.";
  $("#save-line").disabled = training || !databaseReady;
  $("#reset").textContent = training ? "Esci dal ripasso" : "Nuova posizione";
  for (const selector of ["#line-card", "#moves-card", "#variations-card", "#import-card"]) {
    $(selector).hidden = training;
  }
  $("#review-panel").hidden = !training;
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
  renderBoard();
  renderMoves();
  renderVariations();
  renderRepertoire();
  renderMode();
  renderReviewPanel();
  chessSuite?.refresh();
  extendedTraining?.refresh();
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
  const chess = activeGame();
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
  const line = repertoire.find((item) => item.id === id);
  if (!line || !confirmDiscardChanges("aprire un'altra linea")) return;
  if (mode === "training" && reviewSessionId && !reviewSessionFinished) {
    void markReviewSessionFinished().catch((error) => {
      showToast("Non riesco a chiudere la sessione: " + error.message);
    });
    reviewSessionId = null;
    reviewSessionFinished = false;
  }
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

function startTraining() {
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
    }
    reviewSessions.unshift({
      id,
      startedAt: now.toISOString(),
      finishedAt: null,
      side,
      cardsReviewed: 0,
      correctCount: 0,
      againCount: 0,
    });
    if (persistenceMode === "browser" && !persistLocalReviewState()) {
      reviewSessions = reviewSessions.filter((session) => session.id !== id);
      isStartingReviewSession = false;
      startButton.disabled = false;
      return;
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
  const sessionId = reviewSessionId;
  if (!sessionId || reviewSessionFinished) return;
  const finishedAt = new Date().toISOString();
  if (persistenceMode === "sqlite") {
    await invoke("finish_training_session", {
      input: { id: sessionId, finishedAt },
    });
  }
  reviewSessions = reviewSessions.map((session) => (
    session.id === sessionId ? { ...session, finishedAt } : session
  ));
  if (persistenceMode === "browser" && !persistLocalReviewState()) {
    throw new Error("Storico sessioni non salvato nella memoria locale.");
  }
  if (reviewSessionId === sessionId) reviewSessionFinished = true;
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
    }
    const session = reviewSessions.find((entry) => entry.id === reviewSessionId);
    if (session) {
      session.cardsReviewed = (session.cardsReviewed || 0) + 1;
      session.correctCount = (session.correctCount || 0) + (reviewSolved ? 1 : 0);
      session.againCount = (session.againCount || 0) + (result.log.rating === 1 ? 1 : 0);
    }
    if (persistenceMode === "browser" && !persistLocalReviewState()) {
      isSavingReview = false;
      return;
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

function formatHistoryDate(value) {
  if (!value) return "Data non disponibile";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data non valida";
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function historyRow(titleText, detailText, statusText, statusClass = "") {
  const row = document.createElement("div");
  row.className = "review-history-row";
  const copy = document.createElement("div");
  copy.className = "review-history-copy";
  const title = document.createElement("strong");
  title.textContent = titleText;
  const detail = document.createElement("small");
  detail.textContent = detailText;
  copy.append(title, detail);
  row.append(copy);
  if (statusText) {
    const status = document.createElement("span");
    status.className = "review-history-status" + (statusClass ? " " + statusClass : "");
    status.textContent = statusText;
    row.append(status);
  }
  return row;
}

function renderReviewHistory(cards) {
  const sessionsList = $("#review-history-sessions");
  const reviewsList = $("#review-history-reviews");
  sessionsList.replaceChildren();
  reviewsList.replaceChildren();

  const sessions = [...reviewSessions].sort((a, b) => (
    new Date(b.startedAt || 0) - new Date(a.startedAt || 0)
  ));
  if (!sessions.length) {
    const empty = document.createElement("p");
    empty.className = "review-history-empty";
    empty.textContent = "Le sessioni completate appariranno qui.";
    sessionsList.append(empty);
  } else {
    for (const session of sessions.slice(0, 8)) {
      const count = Number(session.cardsReviewed || 0);
      const correct = Number(session.correctCount || 0);
      const accuracy = count ? Math.round((correct / count) * 100) : 0;
      const side = session.side === "white" ? "Bianco" : session.side === "black" ? "Nero" : "Entrambi";
      const status = session.finishedAt
        ? "Completata"
        : session.id === reviewSessionId ? "In corso" : "Interrotta";
      const detail = formatHistoryDate(session.startedAt) + " · " + side + " · " +
        count + " carte · " + accuracy + "% richiamo corretto" +
        (session.finishedAt ? " · fine " + formatHistoryDate(session.finishedAt) : "");
      sessionsList.append(historyRow("Sessione di ripasso", detail, status,
        status === "Interrotta" ? "interrupted" : status === "In corso" ? "active" : "complete"));
    }
  }

  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const ratingNames = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
  if (!reviewLogs.length) {
    const empty = document.createElement("p");
    empty.className = "review-history-empty";
    empty.textContent = "Non hai ancora registrato valutazioni.";
    reviewsList.append(empty);
  } else {
    for (const log of reviewLogs.slice(0, 15)) {
      const card = cardsById.get(log.cardId || log.card_id);
      const moveLabel = card
        ? card.repertoireTitle + " · " + card.san + " · " + (card.side === "white" ? "Bianco" : "Nero")
        : "Carta del repertorio";
      const detail = formatHistoryDate(log.reviewedAt || log.reviewed_at) +
        (Number.isFinite(Number(log.elapsedMs ?? log.elapsed_ms))
          ? " · " + (Number(log.elapsedMs ?? log.elapsed_ms) / 1000).toFixed(1) + " s"
          : "");
      let recalled = false;
      try {
        const metadata = JSON.parse(log.stateJson || log.state_json || "{}");
        recalled = metadata.recalled === true;
      } catch {
        recalled = false;
      }
      const result = recalled ? "Richiamo corretto" : "Richiamo mancato";
      const rating = ratingNames[Number(log.rating)] || "Valutazione";
      reviewsList.append(historyRow(moveLabel, detail + " · " + result, rating,
        rating === "Again" ? "interrupted" : "complete"));
    }
  }
}

function renderReviewPanel() {
  const now = new Date();
  const side = $("#review-side").value;
  const cards = buildReviewCards(repertoire, studyCards, now);
  renderReviewHistory(cards);
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

async function exportFullBackup() {
  const button = $("#backup-export");
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "Preparazione backup…";
  try {
    const trainingState = extendedTraining?.exportState?.() || {};
    const suiteState = chessSuite?.exportState?.() || {};
    const backup = {
      format: "chessos-backup",
      version: 2,
      exportedAt: new Date().toISOString(),
      appVersion: "0.1.0",
      repertoires: repertoire,
      dailyReview: {
        cards: studyCards,
        logs: reviewLogs,
        sessions: reviewSessions,
      },
      extendedTraining: trainingState,
      chessSuite: suiteState,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "chessos-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    $("#backup-status").textContent =
      "Backup esportato · " + repertoire.length + " repertori · " +
      studyCards.length + " carte FSRS · " + reviewLogs.length + " log · " +
      (trainingState.cards?.length || 0) + " flashcard dagli errori.";
  } catch (error) {
    $("#backup-status").textContent = "Esportazione non riuscita: " + error.message;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function mergeById(existing, incoming) {
  const map = new Map((existing || []).filter((item) => item?.id).map((item) => [item.id, item]));
  for (const item of incoming || []) {
    if (item?.id) map.set(item.id, item);
  }
  return [...map.values()];
}

async function importFullBackup() {
  const button = $("#backup-import");
  const fileInput = $("#backup-file");
  const file = fileInput.files?.[0];
  if (!file) { $("#backup-status").textContent = "Seleziona un backup JSON."; return; }
  if (file.size > 50 * 1024 * 1024) { $("#backup-status").textContent = "Il backup supera il limite di 50 MB."; return; }
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "Controllo backup…";
  try {
    const backup = JSON.parse(await file.text());
    if (backup.format !== "chessos-backup" || ![1, 2].includes(backup.version)) {
      throw new Error("Formato o versione del backup non riconosciuti.");
    }
    if (!Array.isArray(backup.repertoires) || backup.repertoires.length > 10000) {
      throw new Error("Elenco dei repertori non valido o troppo grande.");
    }

    const validatedRepertoires = backup.repertoires.map((entry, index) => {
      if (!entry || typeof entry.id !== "string" || !entry.id.trim()) {
        throw new Error("ID repertorio non valido al record " + (index + 1) + ".");
      }
      const tree = entry.tree ? RepertoireTree.fromJSON(entry.tree) : RepertoireTree.fromPgn(entry.pgn || "");
      const pgn = typeof entry.pgn === "string" && entry.pgn
        ? entry.pgn
        : tree.toPgn({ Event: entry.title || "Imported repertoire" });
      return {
        ...entry,
        id: entry.id,
        title: String(entry.title || "Repertorio importato").slice(0, 200),
        pgn,
        sans: Array.isArray(entry.sans) ? entry.sans : tree.mainlinePath().map((edgeId) => tree.getEdge(edgeId).san),
        tree: tree.toJSON(),
        createdAt: entry.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });

    const daily = backup.dailyReview || {};
    const restoredCards = Array.isArray(daily.cards) ? daily.cards : [];
    const restoredLogs = Array.isArray(daily.logs) ? daily.logs : [];
    const restoredSessions = Array.isArray(daily.sessions) ? daily.sessions : [];
    if (restoredCards.length > 100000 || restoredLogs.length > 500000 || restoredSessions.length > 100000) {
      throw new Error("Lo storico FSRS supera il limite di record supportato.");
    }

    for (const entry of validatedRepertoires) {
      if (persistenceMode === "sqlite") {
        const tree = RepertoireTree.fromJSON(entry.tree);
        const saved = await invoke("save_repertoire", {
          input: repertoirePayload(entry, tree),
        });
        repertoire = [saved, ...repertoire.filter((item) => item.id !== entry.id)];
      } else {
        repertoire = [entry, ...repertoire.filter((item) => item.id !== entry.id)];
      }
    }
    if (persistenceMode === "browser" && !persistRepertoire()) {
      throw new Error("Non riesco a salvare i repertori nella memoria locale.");
    }

    studyCards = mergeById(studyCards, restoredCards);
    reviewLogs = mergeById(reviewLogs, restoredLogs);
    reviewSessions = mergeById(reviewSessions, restoredSessions);

    if (persistenceMode === "sqlite") {
      const cardsForDb = studyCards.map((card) => ({
        id: card.id,
        repertoireId: card.repertoireId || card.repertoire_id,
        edgeId: card.edgeId || card.edge_id,
        side: card.side,
        dueAt: card.dueAt || card.due_at || card.fsrs?.due,
        stability: Number(card.stability ?? card.fsrs?.stability ?? 0),
        difficulty: Number(card.difficulty ?? card.fsrs?.difficulty ?? 0),
        reps: Number(card.reps ?? card.fsrs?.reps ?? 0),
        lapses: Number(card.lapses ?? card.fsrs?.lapses ?? 0),
        state: String(card.state ?? card.fsrs?.state ?? "new"),
        fsrsJson: typeof card.fsrsJson === "string" ? card.fsrsJson : JSON.stringify(card.fsrs || {}),
        createdAt: card.createdAt || new Date().toISOString(),
        updatedAt: card.updatedAt || new Date().toISOString(),
      })).filter((card) => card.repertoireId && card.edgeId && card.dueAt);
      await invoke("restore_review_data", {
        input: {
          cards: cardsForDb,
          logs: reviewLogs.map((log) => ({
            id: log.id,
            cardId: log.cardId || log.card_id,
            sessionId: log.sessionId || log.session_id || null,
            rating: Number(log.rating),
            reviewedAt: log.reviewedAt || log.reviewed_at,
            elapsedMs: log.elapsedMs ?? log.elapsed_ms ?? null,
            scheduledDays: Number(log.scheduledDays ?? log.scheduled_days ?? 0),
            stateJson: log.stateJson || log.state_json || "{}",
          })),
          sessions: reviewSessions.map((session) => ({
            id: session.id,
            startedAt: session.startedAt || session.started_at,
            finishedAt: session.finishedAt || session.finished_at || null,
            side: session.side || "both",
            cardsReviewed: Number(session.cardsReviewed ?? session.cards_reviewed ?? 0),
            correctCount: Number(session.correctCount ?? session.correct_count ?? 0),
            againCount: Number(session.againCount ?? session.again_count ?? 0),
          })),
        },
      });
      await loadStudyData();
    } else if (!persistLocalReviewState()) {
      throw new Error("Storico FSRS non salvato nella memoria locale.");
    }

    const currentExtended = extendedTraining?.exportState?.() || {};
    const incomingExtended = backup.extendedTraining || {};
    await extendedTraining?.importState?.({
      ...currentExtended,
      ...incomingExtended,
      cards: mergeById(currentExtended.cards, incomingExtended.cards),
    });

    const currentSuite = chessSuite?.exportState?.() || {};
    const incomingSuite = backup.chessSuite || {};
    await chessSuite?.importState?.({
      ...currentSuite,
      ...incomingSuite,
      endgameProgress: {
        ...(currentSuite.endgameProgress || {}),
        ...(incomingSuite.endgameProgress || {}),
      },
    });

    renderAll();
    $("#backup-status").textContent =
      "Ripristino completato · " + validatedRepertoires.length + " repertori importati/aggiornati · " +
      studyCards.length + " schede FSRS · " + (extendedTraining?.exportState?.().cards?.length || 0) +
      " flashcard aggiuntive. I record sono stati uniti per ID; i dati locali non presenti nel backup non sono stati cancellati.";
    showToast("Backup ChessOS ripristinato.");
  } catch (error) {
    $("#backup-status").textContent = "Ripristino interrotto: " + error.message;
  } finally {
    button.disabled = false;
    button.textContent = original;
    fileInput.value = "";
  }
}

async function createEndgameFlashcard() {
  const lesson = chessSuite?.getCurrentEndgameLesson?.();
  if (!lesson) { showToast("Seleziona prima una lezione Endgame."); return; }
  extendedTraining?.addConceptCard({
    front: "Richiama la tecnica: " + lesson.title + ". " + lesson.focus,
    back: "Obiettivo: " + lesson.objective + "\n\nMetodo: " + lesson.method + "\n\nErrore tipico: " + lesson.errors,
    fen: lesson.fen,
  });
}

boardElement.addEventListener("click", (event) => {
  const squareButton = event.target.closest("button[data-square]");
  if (squareButton) handleSquareClick(squareButton.dataset.square);
});

$("#nav-studio").addEventListener("click", () => {
  if (mode === "training") leaveTraining();
});
$("#nav-training").addEventListener("click", () => startTraining());
$("#review-side").addEventListener("change", renderReviewPanel);
$("#backup-export").addEventListener("click", () => { void exportFullBackup(); });
$("#backup-import").addEventListener("click", () => { void importFullBackup(); });
$("#endgame-create-card").addEventListener("click", createEndgameFlashcard);
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

chessSuite = initializeChessSuite({
  getCurrentTree: () => studioTree,
  loadGeneratedTree: (tree, title) => {
    rebuildTimeline(tree);
    mode = "studio";
    activeLineId = null;
    titleInput.value = title;
    setDirty(true);
    renderAll();
    showToast("Repertorio generato. Controlla e salva la linea nello Studio.");
  },
  getCurrentFen: () => activeGame().fen(),
  getCurrentEdge: () => studioPly > 0 ? studioTree.getEdge(studioPath[studioPly - 1]) : null,
  onAnnotationSaved: () => {
    setDirty(true);
    renderAll();
  },
  onImportedGames: (pgn) => extendedTraining?.loadImportedPgn(pgn),
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
renderAll();
void initializePersistence();