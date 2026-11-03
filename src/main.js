import { Chess } from "chess.js";
import "./style.css";

const STORAGE_KEY = "chess-os.repertoire.v1";
const symbols = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

let game = new Chess();
let mode = "studio";
let selectedSquare = null;
let repertoire = readRepertoire();
let activeLineId = null;
let dirty = false;
let trainingGame = null;
let trainingMoves = [];
let trainingIndex = 0;
let toastTimer = null;

const $ = (selector) => document.querySelector(selector);
const boardElement = $("#chessboard");
const titleInput = $("#line-title");
const moveListElement = $("#move-list");

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

function gameStatus(chess) {
  if (chess.isCheckmate()) return `Scacco matto · vince il ${chess.turn() === "w" ? "Nero" : "Bianco"}`;
  if (chess.isStalemate()) return "Stallo";
  if (chess.isThreefoldRepetition()) return "Patta · triplice ripetizione";
  if (chess.isInsufficientMaterial()) return "Patta · materiale insufficiente";
  if (chess.isDraw()) return "Patta";
  if (chess.isCheck()) return "Scacco";
  return "Partita in corso";
}

function renderBoard() {
  const chess = activeGame();
  const board = chess.board();
  const legalTargets = new Set(
    selectedSquare
      ? chess.moves({ square: selectedSquare, verbose: true }).map((move) => move.to)
      : [],
  );

  boardElement.replaceChildren();
  board.forEach((rank, rowIndex) => {
    rank.forEach((piece, columnIndex) => {
      const square = String.fromCharCode(97 + columnIndex) + String(8 - rowIndex);
      const button = document.createElement("button");
      const isLight = (rowIndex + columnIndex) % 2 === 0;
      button.type = "button";
      button.dataset.square = square;
      button.className = `square ${isLight ? "light" : "dark"}`;
      if (selectedSquare === square) button.classList.add("selected");
      if (legalTargets.has(square)) button.classList.add(piece ? "capture-target" : "legal-target");
      if (piece) {
        const pieceSpan = document.createElement("span");
        pieceSpan.className = `piece ${piece.color === "w" ? "white-piece" : "black-piece"}`;
        pieceSpan.textContent = symbols[piece.color][piece.type];
        button.append(pieceSpan);
        button.setAttribute("aria-label", `${piece.color === "w" ? "Bianco" : "Nero"} ${piece.type} in ${square}`);
      } else {
        button.setAttribute("aria-label", square);
      }
      boardElement.append(button);
    });
  });

  const turn = chess.turn() === "w" ? "Bianco" : "Nero";
  $("#turn-label").textContent = `${turn} al tratto`;
  $("#game-status").textContent = gameStatus(chess);
  $("#move-count").textContent = `${chess.history().length} ${chess.history().length === 1 ? "mossa" : "mosse"}`;
  $("#line-move-count").textContent = chess.history().length
    ? `${chess.history().length} semimosse registrate`
    : "Ancora nessuna mossa";
  $("#board-label").textContent = mode === "training" ? "MODALITÀ ALLENAMENTO" : "PARTITA / ANALISI";
  $("#undo").disabled = mode === "training" || chess.history().length === 0;
}

function renderMoves() {
  const moves = mode === "training" ? trainingMoves.map((move) => move.san) : game.history();
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
    number.textContent = `${Math.floor(index / 2) + 1}.`;
    row.append(number);

    for (let offset = 0; offset < 2 && index + offset < moves.length; offset += 1) {
      const moveIndex = index + offset;
      const san = document.createElement("span");
      san.className = "san";
      san.textContent = moves[moveIndex];
      if (mode === "training" && moveIndex < trainingIndex) san.classList.add("played");
      if (mode === "training" && moveIndex === trainingIndex) san.classList.add("next-move");
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
    const count = Array.isArray(line.sans) ? line.sans.length : 0;
    meta.textContent = `${count} ${count === 1 ? "semimossa" : "semimosse"}`;
    open.append(name, meta);
    open.addEventListener("click", () => openLine(line.id));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-line";
    remove.textContent = "×";
    remove.title = "Elimina linea";
    remove.setAttribute("aria-label", `Elimina ${line.title || "linea"}`);
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
  $("#save-line").disabled = training;
  $("#reset").textContent = training ? "Esci dal ripasso" : "Nuova posizione";
}

function renderAll() {
  renderBoard();
  renderMoves();
  renderRepertoire();
  renderMode();
}

function openLine(id) {
  const line = repertoire.find((item) => item.id === id);
  if (!line) return;
  try {
    const loaded = new Chess();
    loaded.loadPgn(line.pgn);
    game = loaded;
    activeLineId = line.id;
    titleInput.value = line.title || "Linea senza nome";
    setDirty(false);
    mode = "studio";
    trainingGame = null;
    selectedSquare = null;
    renderAll();
  } catch (error) {
    showToast(`PGN non leggibile: ${error.message}`);
  }
}

function deleteLine(id) {
  const line = repertoire.find((item) => item.id === id);
  if (!line) return;
  const accepted = window.confirm(`Eliminare “${line.title || "Linea senza nome"}” dal repertorio?`);
  if (!accepted) return;
  repertoire = repertoire.filter((item) => item.id !== id);
  persistRepertoire();
  if (activeLineId === id) {
    activeLineId = null;
    setDirty(true);
  }
  renderAll();
  showToast("Linea eliminata.");
}

function saveLine() {
  if (mode === "training") return;
  if (!game.history().length) {
    showToast("Aggiungi almeno una mossa prima di salvare.");
    return;
  }

  const pgn = game.pgn();
  const sans = game.history();
  const title = titleInput.value.trim() || "Linea senza nome";
  const id = activeLineId || (globalThis.crypto?.randomUUID?.() ?? `line-${Date.now()}`);
  const previous = repertoire.find((item) => item.id === id);
  const entry = {
    id,
    title,
    pgn,
    sans,
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  repertoire = previous
    ? repertoire.map((item) => (item.id === id ? entry : item))
    : [entry, ...repertoire];
  if (!persistRepertoire()) return;
  activeLineId = id;
  setDirty(false);
  renderAll();
  showToast("Linea salvata nel repertorio.");
}

function startTraining(line = null) {
  let sourceGame = new Chess();
  try {
    if (line) sourceGame.loadPgn(line.pgn);
    else sourceGame.loadPgn(game.pgn());
  } catch (error) {
    showToast(`Impossibile avviare il ripasso: ${error.message}`);
    return;
  }

  trainingMoves = sourceGame.history({ verbose: true });
  if (!trainingMoves.length) {
    showToast("Salva o crea una linea con almeno una mossa per allenarti.");
    return;
  }
  trainingGame = new Chess();
  trainingIndex = 0;
  selectedSquare = null;
  if (line) {
    activeLineId = line.id;
    titleInput.value = line.title || "Linea senza nome";
    setDirty(false);
  }
  mode = "training";
  renderAll();
  showToast("Ripasso avviato: trova la prima mossa.");
}

function leaveTraining() {
  mode = "studio";
  trainingGame = null;
  trainingMoves = [];
  trainingIndex = 0;
  selectedSquare = null;
  renderAll();
}

function handleSquareClick(square) {
  const chess = activeGame();
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

  if (mode === "training") {
    const expected = trainingMoves[trainingIndex];
    if (!expected) return;
    let played;
    try {
      played = trainingGame.move({
        from: selectedSquare,
        to: square,
        promotion: expected.promotion || "q",
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
    if (trainingIndex === trainingMoves.length) {
      showToast("Linea completata. Ottimo lavoro!");
    } else {
      showToast("Mossa corretta.");
    }
    return;
  }

  let played;
  try {
    played = game.move({ from: selectedSquare, to: square, promotion: "q" });
  } catch {
    played = null;
  }
  selectedSquare = null;
  if (!played) {
    renderBoard();
    showToast("Mossa non legale.");
    return;
  }
  setDirty(true);
  renderAll();
}

function importPgn() {
  const text = $("#pgn-input").value.trim();
  if (!text) {
    showToast("Incolla prima un testo PGN.");
    return;
  }
  try {
    const imported = new Chess();
    imported.loadPgn(text);
    game = imported;
    mode = "studio";
    activeLineId = null;
    titleInput.value = "PGN importato";
    setDirty(true);
    selectedSquare = null;
    renderAll();
    showToast("PGN importato correttamente.");
  } catch (error) {
    showToast(`PGN non valido: ${error.message}`);
  }
}

function exportPgn() {
  const pgn = game.pgn();
  if (!pgn) {
    showToast("Non ci sono mosse da esportare.");
    return;
  }
  const blob = new Blob([pgn + "\n"], { type: "application/x-chess-pgn;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${(titleInput.value.trim() || "chess-line").replace(/[^a-z0-9-_]+/gi, "-")}.pgn`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast("File PGN esportato.");
}

function newPosition() {
  if (mode === "training") {
    leaveTraining();
    return;
  }
  game = new Chess();
  activeLineId = null;
  selectedSquare = null;
  titleInput.value = "Nuova linea";
  setDirty(true);
  renderAll();
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
  if (mode !== "studio") return;
  if (game.undo()) {
    selectedSquare = null;
    setDirty(true);
    renderAll();
  }
});
$("#save-line").addEventListener("click", saveLine);
$("#import-pgn").addEventListener("click", importPgn);
$("#export-pgn").addEventListener("click", exportPgn);
titleInput.addEventListener("input", () => setDirty(true));

renderAll();