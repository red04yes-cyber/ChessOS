import { Chess } from "chess.js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { RepertoireTree } from "./repertoire-tree.js";
import { analyzeOpponentPgn, buildWeaknessHeatmap, createErrorFlashcard, createMistakeFlashcards, getDueStudyCards, getTranspositionGroups, gradeStudyCard, readStudyCards, saveStudyCards, OPPONENT_REPORT_KEY } from "./study-tools.js";
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
let blindfoldMode = false;
let studyCards = readStudyCards();
let reviewActive = false;
let activeReviewCardId = null;
let reviewSessionSeen = new Set();
let opponentReport = (() => { try { return JSON.parse(localStorage.getItem(OPPONENT_REPORT_KEY) || "null"); } catch { return null; } })();

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

      if (piece && !(mode === "training" && blindfoldMode)) {
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

  if (mode === "training" && blindfoldMode) {
    const masked = document.createElement("span");
    masked.className = "empty-state";
    masked.textContent = "Notazione nascosta · richiama la prossima mossa a memoria.";
    moveListElement.append(masked);
    return;
  }

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
  $("#blindfold-input-wrap").hidden = !(training && blindfoldMode);
  $("#start-blindfold").textContent = training && blindfoldMode ? "Blindfold in corso" : "Avvia Blindfold sulla linea attiva";
  $("#start-blindfold").disabled = training && blindfoldMode;
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


function addStudyCard(card) {
  const fingerprint = card.positionKey + "|" + (card.expectedSan || []).join(",");
  const exists = studyCards.some((item) => item.positionKey + "|" + (item.expectedSan || []).join(",") === fingerprint);
  if (exists) return false;
  studyCards = [card, ...studyCards];
  try { saveStudyCards(studyCards); } catch (error) { showToast("Carta creata ma non salvata: " + error.message); }
  return true;
}

function makeElement(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

function renderFlashcards() {
  const summary = $("#flashcard-summary");
  const review = $("#flashcard-review");
  if (!summary || !review) return;
  const due = getDueStudyCards(studyCards);
  summary.textContent = studyCards.length + " carte totali · " + due.length + " da ripassare oggi.";
  review.replaceChildren();

  if (!reviewActive) {
    const note = makeElement("p", "empty-state", studyCards.length
      ? "Le carte generate dagli errori sono salvate localmente e programmate con FSRS."
      : "Nessuna carta ancora. Importa un PGN sopra o commetti un errore durante il Blindfold.");
    review.append(note);
    return;
  }

  const current = studyCards.find((card) => card.id === activeReviewCardId);
  if (!current) {
    reviewActive = false;
    activeReviewCardId = null;
    review.append(makeElement("p", "empty-state", "Sessione terminata."));
    return;
  }

  review.append(makeElement("div", "flashcard-face", current.front));
  if (!reviewAnswerVisible) {
    const reveal = makeElement("button", "button small primary", "Mostra risposta");
    reveal.type = "button";
    reveal.addEventListener("click", () => { reviewAnswerVisible = true; renderFlashcards(); });
    review.append(reveal);
    return;
  }

  review.append(makeElement("div", "flashcard-answer", current.back));
  review.append(makeElement("p", "tool-description", "Quanto è stato facile ricordare la continuazione?"));
  const grades = [
    ["again", "Di nuovo"],
    ["hard", "Difficile"],
    ["good", "Bene"],
    ["easy", "Facile"],
  ];
  const actions = makeElement("div", "tool-actions");
  for (const [grade, label] of grades) {
    const button = makeElement("button", "button small ghost grade-" + grade, label);
    button.type = "button";
    button.addEventListener("click", () => {
      try {
        studyCards = studyCards.map((card) => card.id === current.id ? gradeStudyCard(card, grade) : card);
        saveStudyCards(studyCards);
        reviewSessionSeen.add(current.id);
        const next = getDueStudyCards(studyCards).find((card) => !reviewSessionSeen.has(card.id));
        if (next) {
          activeReviewCardId = next.id;
          reviewAnswerVisible = false;
        } else {
          reviewActive = false;
          activeReviewCardId = null;
          showToast("Sessione di ripasso completata.");
        }
        renderAllTools();
      } catch (error) { showToast("Errore FSRS: " + error.message); }
    });
    actions.append(button);
  }
  review.append(actions);
  const finish = makeElement("button", "button small ghost", "Termina ripasso");
  finish.type = "button";
  finish.addEventListener("click", () => { reviewActive = false; activeReviewCardId = null; renderFlashcards(); });
  review.append(finish);
}

let reviewAnswerVisible = false;

function startCardReview() {
  const next = getDueStudyCards(studyCards).find((card) => !reviewSessionSeen.has(card.id));
  if (!next) {
    showToast(studyCards.length ? "Non ci sono carte dovute al momento." : "Genera prima alcune flashcard da un PGN.");
    return;
  }
  reviewActive = true;
  activeReviewCardId = next.id;
  reviewAnswerVisible = false;
  renderFlashcards();
}

function renderHeatmap() {
  const summary = $("#heatmap-summary");
  const list = $("#heatmap-list");
  if (!summary || !list) return;
  const rows = buildWeaknessHeatmap(studioTree, studyCards);
  const count = (status) => rows.filter((item) => item.status === status).length;
  summary.textContent = rows.length + " posizioni · " + count("weak") + " deboli · " + count("learning") + " in apprendimento · " + count("stable") + " stabili · " + count("unmeasured") + " non valutate.";
  list.replaceChildren();
  for (const item of rows.slice(0, 14)) {
    const row = makeElement("div", "heatmap-row");
    const marker = makeElement("span", "heatmap-marker " + item.status);
    const label = makeElement("div", "heatmap-position");
    const chess = new Chess(item.fen);
    const fenPlacement = item.fen.split(/\s+/)[0];
    label.append(makeElement("strong", "", fenPlacement));
    label.append(makeElement("small", "", item.cardCount
      ? item.reviews + " ripassi · " + item.lapses + " dimenticanze"
      : chess.turn() === "w" ? "Bianco al tratto · nessun dato" : "Nero al tratto · nessun dato"));
    row.append(marker, label, makeElement("span", "heatmap-state", ({
      weak: "Debole",
      learning: "In apprendimento",
      stable: "Stabile",
      unmeasured: "Non valutata",
    })[item.status]));
    list.append(row);
  }
}

function renderOpponentReport() {
  const target = $("#opponent-report");
  if (!target) return;
  target.replaceChildren();
  if (!opponentReport) {
    target.append(makeElement("p", "empty-state", "Nessuna analisi ancora."));
    return;
  }
  const report = opponentReport;
  target.append(makeElement("p", "report-summary",
    report.gameCount + " partite analizzate · " + (report.side === "white" ? "Bianco" : "Nero") + " · media " + report.averagePlies + " semimosse."));
  const result = report.results;
  target.append(makeElement("p", "report-results",
    "Risultati: " + result.wins + " vittorie · " + result.draws + " patte · " + result.losses + " sconfitte · " + result.unknown + " ignoti."));
  target.append(makeElement("strong", "report-heading", "Aperture più frequenti"));
  for (const item of report.openings) {
    target.append(makeElement("div", "report-row", item.count + "× (" + item.percentage + "%)  " + item.label));
  }
  target.append(makeElement("strong", "report-heading", "Prima mossa del colore analizzato"));
  for (const item of report.firstMoves) {
    target.append(makeElement("div", "report-row", item.count + "× (" + item.percentage + "%)  " + item.label));
  }
  if (report.ignoredGames?.length) target.append(makeElement("p", "tool-warning", report.ignoredGames.length + " PGN non validi ignorati."));
}

function renderTranspositions() {
  const summary = $("#transposition-summary");
  const list = $("#transposition-list");
  if (!summary || !list) return;
  const groups = getTranspositionGroups(studioTree);
  summary.textContent = groups.length + " posizioni transposte · " + groups.reduce((sum, group) => sum + group.paths.length, 0) + " percorsi in ingresso.";
  list.replaceChildren();
  if (!groups.length) {
    list.append(makeElement("p", "empty-state", "Nessuna trasposizione nel repertorio attivo."));
    return;
  }
  for (const group of groups) {
    const card = makeElement("div", "transposition-entry");
    card.append(makeElement("strong", "", group.paths.length + " sequenze → stessa posizione"));
    card.append(makeElement("small", "", group.fen.split(/\s+/)[0]));
    for (const path of group.paths) card.append(makeElement("p", "transposition-path", path.moves));
    list.append(card);
  }
}

function renderAllTools() {
  renderFlashcards();
  renderHeatmap();
  renderOpponentReport();
  renderTranspositions();
}

function generateMistakeCards() {
  const pgn = $("#mistake-pgn").value.trim();
  if (!pgn) { showToast("Incolla prima una partita PGN."); return; }
  try {
    const result = createMistakeFlashcards(studioTree, pgn, studyCards);
    if (result.cards.length) {
      studyCards = [...result.cards, ...studyCards];
      saveStudyCards(studyCards);
    }
    $("#flashcard-summary").textContent = result.cards.length + " nuove carte generate da " + result.gamesRead + " partite. " + result.ignoredGames.length + " PGN ignorati.";
    renderAllTools();
    showToast(result.cards.length ? "Flashcard create e salvate." : "Nessuna deviazione rilevata nelle posizioni conosciute.");
  } catch (error) { showToast("Analisi PGN non riuscita: " + error.message); }
}

function runOpponentAnalysis() {
  const pgn = $("#opponent-pgn").value.trim();
  if (!pgn) { showToast("Incolla le partite PGN dell'avversario."); return; }
  try {
    opponentReport = analyzeOpponentPgn(pgn, $("#opponent-side").value);
    if (!opponentReport.gameCount) {
      opponentReport = null;
      showToast("Nessuna partita PGN valida trovata.");
    } else {
      localStorage.setItem(OPPONENT_REPORT_KEY, JSON.stringify(opponentReport));
      showToast("Report avversario aggiornato.");
    }
    renderOpponentReport();
  } catch (error) { showToast("Analisi avversario non riuscita: " + error.message); }
}

function submitBlindfoldAnswer() {
  if (mode !== "training" || !blindfoldMode || !trainingGame) return;
  const expected = trainingMoves[trainingIndex];
  const answer = $("#blindfold-answer").value.trim();
  if (!expected) { showToast("Linea completata."); return; }
  if (!answer) { showToast("Scrivi una mossa in notazione SAN."); return; }

  const before = trainingGame.fen();
  const probe = new Chess(before);
  let parsed;
  try { parsed = probe.move(answer); } catch { parsed = null; }
  const correct = parsed
    && parsed.from === expected.from
    && parsed.to === expected.to
    && (parsed.promotion || undefined) === (expected.promotion || undefined);
  if (!correct) {
    const added = addStudyCard(createErrorFlashcard({
      fen: before,
      expectedSan: expected.san,
      actualSan: answer,
      source: "blindfold",
    }));
    $("#blindfold-answer").value = "";
    $("#blindfold-status").textContent = "Mossa non corretta. Riprova: " + (added ? "ho creato una flashcard sull'errore." : "la carta per questo errore esiste già.");
    showToast("Risposta errata: prova ancora.");
    return;
  }

  trainingGame.move({
    from: parsed.from,
    to: parsed.to,
    ...(parsed.promotion ? { promotion: parsed.promotion } : {}),
  });
  trainingIndex += 1;
  $("#blindfold-answer").value = "";
  $("#blindfold-status").textContent = trainingIndex === trainingMoves.length
    ? "Linea completata senza vedere la scacchiera."
    : "Corretto. Continua richiamando la prossima mossa.";
  renderAll();
  showToast(trainingIndex === trainingMoves.length ? "Blindfold completato!" : "Mossa corretta.");
}

function renderAll() {
  renderBoard();
  renderMoves();
  renderVariations();
  renderRepertoire();
  renderMode();
  renderAllTools();
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
      addStudyCard(createErrorFlashcard({
        fen: trainingGame.fen(),
        expectedSan: expected.san,
        actualSan: played.san,
        source: "repertoire-training",
      }));
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
  if (mode === "training" && blindfoldMode) {
    showToast("Blindfold attivo: inserisci la mossa in notazione SAN.");
    return;
  }
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
  try {
    const loaded = line.tree ? RepertoireTree.fromJSON(line.tree) : RepertoireTree.fromPgn(line.pgn);
    rebuildTimeline(loaded);
    activeLineId = line.id;
    titleInput.value = line.title || "Linea senza nome";
    setDirty(false);
    mode = "studio";
    trainingGame = null;
    blindfoldMode = false;
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

function startTraining({ blindfold = false } = {}) {
  blindfoldMode = blindfold;
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
  blindfoldMode = false;
  trainingGame = null;
  trainingMoves = [];
  trainingIndex = 0;
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

boardElement.addEventListener("click", (event) => {
  const squareButton = event.target.closest("button[data-square]");
  if (squareButton) handleSquareClick(squareButton.dataset.square);
});

$("#nav-studio").addEventListener("click", () => {
  if (mode === "training") leaveTraining();
});
$("#nav-training").addEventListener("click", () => startTraining());
$("#generate-cards").addEventListener("click", generateMistakeCards);
$("#review-cards").addEventListener("click", startCardReview);
$("#start-blindfold").addEventListener("click", () => startTraining({ blindfold: true }));
$("#submit-blindfold").addEventListener("click", submitBlindfoldAnswer);
$("#blindfold-answer").addEventListener("keydown", (event) => { if (event.key === "Enter") submitBlindfoldAnswer(); });
$("#analyze-opponent").addEventListener("click", runOpponentAnalysis);
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
void initializePersistence();