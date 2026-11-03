import { Chess } from "chess.js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  STUDY_CARDS_KEY,
  OPPONENT_REPORT_KEY,
  analyzeOpponentPgn,
  buildWeaknessHeatmap,
  createErrorFlashcard,
  createMistakeFlashcards,
  getDueStudyCards,
  getTranspositionGroups,
  gradeStudyCard,
} from "./study-tools.js";

const IMPORTED_GAMES_KEY = "chess-os.imported-games.v1";
const $ = (selector) => document.querySelector(selector);

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

async function loadSetting(key) {
  if (isTauri()) {
    try { return await invoke("get_app_setting", { key }); } catch { return null; }
  }
  try { return localStorage.getItem(key); } catch { return null; }
}

async function saveSetting(key, value) {
  if (isTauri()) {
    await invoke("set_app_setting", { key, value });
    return;
  }
  localStorage.setItem(key, value);
}

export function initializeExtendedTraining({ getCurrentTree, getCurrentMoves, getBaseFen, getCurrentTitle, loadPath, toast }) {
  let cards = [];
  let opponentReport = null;
  let importedPgn = "";
  let activeCardId = null;
  let answerVisible = false;
  let seenThisSession = new Set();
  let blindfold = null;
  let ready = false;

  async function initialize() {
    try {
      cards = JSON.parse(await loadSetting(STUDY_CARDS_KEY) || "[]");
      if (!Array.isArray(cards)) cards = [];
    } catch { cards = []; }
    try {
      opponentReport = JSON.parse(await loadSetting(OPPONENT_REPORT_KEY) || "null");
    } catch { opponentReport = null; }
    importedPgn = await loadSetting(IMPORTED_GAMES_KEY) || "";
    const PGN_FIELDS = ["#mistake-pgn", "#opponent-pgn", "#opening-pgn", "#tactics-pgn", "#generator-pgn"];
    for (const selector of PGN_FIELDS) {
      const field = $(selector);
      if (field && importedPgn) field.value = importedPgn;
    }
    ready = true;
    render();
  }

  async function persistCards() {
    await saveSetting(STUDY_CARDS_KEY, JSON.stringify(cards));
  }

  async function persistOpponentReport() {
    await saveSetting(OPPONENT_REPORT_KEY, JSON.stringify(opponentReport));
  }

  function updateImportedPgn(pgn) {
    importedPgn = String(pgn || "");
    void saveSetting(IMPORTED_GAMES_KEY, importedPgn).catch((error) => {
      toast("Non riesco a salvare l'archivio PGN: " + error.message);
    });
    for (const selector of ["#mistake-pgn", "#opponent-pgn", "#opening-pgn", "#tactics-pgn", "#generator-pgn"]) {
      const field = $(selector);
      if (field) field.value = importedPgn;
    }
  }

  function renderCards() {
    const summary = $("#flashcard-summary");
    const review = $("#flashcard-review");
    if (!summary || !review) return;
    const due = getDueStudyCards(cards);
    summary.textContent = cards.length + " carte errori/concezioni · " + due.length + " da ripassare.";
    review.replaceChildren();
    if (!activeCardId) {
      review.append(node("p", "empty-state", cards.length
        ? "Le carte sono archiviate separatamente dal ripasso delle mosse del repertorio."
        : "Non hai ancora carte da errore. Importa un PGN o prova il Blindfold."));
      return;
    }
    const card = cards.find((item) => item.id === activeCardId);
    if (!card) { activeCardId = null; return; }
    review.append(node("div", "flashcard-face", card.front));
    if (!answerVisible) {
      const reveal = node("button", "button small primary", "Mostra soluzione");
      reveal.type = "button";
      reveal.addEventListener("click", () => { answerVisible = true; renderCards(); });
      review.append(reveal);
      return;
    }
    review.append(node("div", "flashcard-answer", card.back));
    review.append(node("p", "tool-description", "Valuta il richiamo secondo FSRS."));
    const actions = node("div", "tool-actions");
    for (const [grade, label] of [["again", "Again"], ["hard", "Hard"], ["good", "Good"], ["easy", "Easy"]]) {
      const button = node("button", "button small ghost grade-" + grade, label);
      button.type = "button";
      button.addEventListener("click", async () => {
        try {
          cards = cards.map((item) => item.id === card.id ? gradeStudyCard(item, grade) : item);
          await persistCards();
          seenThisSession.add(card.id);
          const next = getDueStudyCards(cards).find((item) => !seenThisSession.has(item.id));
          activeCardId = next?.id || null;
          answerVisible = false;
          renderCards();
          renderHeatmap();
          if (!next) toast("Ripasso delle flashcard completato.");
        } catch (error) { toast("Errore nello scheduling FSRS: " + error.message); }
      });
      actions.append(button);
    }
    review.append(actions);
  }

  function startCardReview() {
    seenThisSession.clear();
    const next = getDueStudyCards(cards).find((item) => !seenThisSession.has(item.id));
    if (!next) { toast(cards.length ? "Nessuna flashcard dovuta." : "Genera prima delle flashcard dagli errori."); return; }
    activeCardId = next.id;
    answerVisible = false;
    renderCards();
  }

  async function generateMistakeCards() {
    const pgn = $("#mistake-pgn")?.value.trim();
    if (!pgn) { toast("Incolla una o più partite PGN."); return; }
    try {
      const result = createMistakeFlashcards(getCurrentTree(), pgn, cards);
      cards = [...result.cards, ...cards];
      await persistCards();
      render();
      $("#flashcard-summary").textContent =
        result.cards.length + " nuove carte da " + result.gamesRead + " partite valide; " +
        result.ignoredGames.length + " PGN ignorati.";
      toast(result.cards.length ? "Flashcard generate e salvate." : "Nessuna deviazione trovata nelle posizioni conosciute.");
    } catch (error) { toast("Generazione flashcard non riuscita: " + error.message); }
  }

  function addErrorCard({ fen, expected, actual, source }) {
    const key = String(fen).trim().split(/\s+/).slice(0, 4).join(" ");
    const duplicate = cards.some((card) => card.positionKey === key &&
      (card.expectedSan || []).join("|") === (Array.isArray(expected) ? expected : [expected]).join("|"));
    if (duplicate) return false;
    cards.unshift(createErrorFlashcard({ fen, expectedSan: expected, actualSan: actual, source }));
    void persistCards().catch((error) => toast("Carta non salvata: " + error.message));
    return true;
  }

  function startBlindfold() {
    const moves = getCurrentMoves();
    if (!moves.length) { toast("Apri una linea con mosse nello Studio prima di avviare il Blindfold."); return; }
    blindfold = { game: new Chess(getBaseFen()), moves: moves.map((move) => ({
      from: move.from, to: move.to, san: move.san, fen: move.before,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    })), index: 0 };
    const wrap = $("#blindfold-input-wrap");
    if (wrap) wrap.hidden = false;
    document.body.classList.add("blindfold-active");
    $("#blindfold-status").textContent = "Blindfold avviato · " + moves.length + " semimosse da richiamare.";
    $("#blindfold-answer").value = "";
    $("#blindfold-answer").focus();
    toast("Blindfold avviato: nessuna scacchiera o notazione sarà mostrata.");
  }

  function stopBlindfold() {
    blindfold = null;
    document.body.classList.remove("blindfold-active");
    const wrap = $("#blindfold-input-wrap");
    if (wrap) wrap.hidden = true;
    const answer = $("#blindfold-answer");
    if (answer) answer.value = "";
    const status = $("#blindfold-status");
    if (status) status.textContent = "Blindfold terminato.";
  }

  function submitBlindfoldAnswer() {
    if (!blindfold) return;
    const expected = blindfold.moves[blindfold.index];
    const answer = $("#blindfold-answer").value.trim();
    if (!expected) { toast("Linea completata."); return; }
    if (!answer) { toast("Inserisci la mossa in notazione SAN."); return; }
    const before = blindfold.game.fen();
    const probe = new Chess(before);
    let move = null;
    try { move = probe.move(answer); } catch { move = null; }
    const correct = move && move.from === expected.from && move.to === expected.to &&
      (move.promotion || undefined) === (expected.promotion || undefined);
    if (!correct) {
      const added = addErrorCard({ fen: before, expected: expected.san, actual: answer, source: "blindfold" });
      $("#blindfold-answer").value = "";
      $("#blindfold-status").textContent = "Risposta errata. " +
        (added ? "È stata creata una flashcard FSRS." : "La flashcard per questa posizione esiste già.") + " Riprova.";
      renderCards();
      return;
    }
    blindfold.game.move({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
    blindfold.index += 1;
    $("#blindfold-answer").value = "";
    $("#blindfold-status").textContent = blindfold.index === blindfold.moves.length
      ? "Linea completata senza vedere la scacchiera."
      : "Corretta · " + blindfold.index + "/" + blindfold.moves.length + ". Continua.";
    if (blindfold.index === blindfold.moves.length) stopBlindfold();
  }

  function addConceptCard({ front, back, fen }) {
    const question = String(front || "").trim();
    const answer = String(back || "").trim();
    if (!question || !answer) { toast("Domanda e risposta della flashcard sono obbligatorie."); return false; }
    const exists = cards.some((card) => card.type === "concept" && card.front === question);
    if (exists) { toast("Questa flashcard esiste già."); return false; }
    const card = createErrorFlashcard({
      fen: fen || getBaseFen(),
      expectedSan: "richiama il concetto",
      source: "study-concept",
    });
    card.type = "concept";
    card.front = question;
    card.back = answer;
    card.expectedSan = [];
    cards.unshift(card);
    void persistCards().then(render).catch((error) => toast("Flashcard non salvata: " + error.message));
    toast("Flashcard aggiunta al ripasso FSRS.");
    return true;
  }

  function renderHeatmap() {
    const summary = $("#heatmap-summary");
    const list = $("#heatmap-list");
    if (!summary || !list) return;
    const tree = getCurrentTree();
    const rows = buildWeaknessHeatmap(tree, cards);
    const count = (status) => rows.filter((row) => row.status === status).length;
    summary.textContent = rows.length + " posizioni · " + count("weak") + " deboli · " +
      count("learning") + " in apprendimento · " + count("stable") + " stabili · " +
      count("unmeasured") + " non valutate.";
    list.replaceChildren();
    for (const rowData of rows.slice(0, 20)) {
      const row = node("div", "heatmap-row");
      row.append(node("span", "heatmap-marker " + rowData.status));
      const label = node("div", "heatmap-position");
      label.append(node("strong", "", rowData.line || "Posizione iniziale"));
      label.append(node("small", "", rowData.reviews + " ripassi · " + rowData.lapses + " dimenticanze"));
      row.append(label, node("span", "heatmap-state", ({
        weak: "Debole", learning: "In apprendimento", stable: "Stabile", unmeasured: "Non valutata",
      })[rowData.status]));
      list.append(row);
    }
  }

  function renderOpponentReport() {
    const target = $("#opponent-report");
    if (!target) return;
    target.replaceChildren();
    if (!opponentReport) { target.append(node("p", "empty-state", "Nessuna analisi ancora.")); return; }
    const report = opponentReport;
    target.append(node("p", "report-summary",
      report.gameCount + " partite · " + (report.side === "white" ? "Bianco" : "Nero") + " · " +
      report.averagePlies + " semimosse medie."));
    const r = report.results;
    target.append(node("p", "report-results",
      r.wins + " vittorie · " + r.draws + " patte · " + r.losses + " sconfitte · " + r.unknown + " sconosciuti."));
    for (const [heading, rows] of [
      ["Aperture", report.openings],
      ["Prima mossa", report.firstMoves],
      ["Prime tre mosse", report.moveSequences || []],
    ]) {
      target.append(node("strong", "report-heading", heading));
      for (const item of rows) target.append(node("div", "report-row",
        item.count + "× (" + item.percentage + "%) · " + item.label));
    }
    if (report.ignoredGames?.length) target.append(node("p", "tool-warning", report.ignoredGames.length + " PGN non validi ignorati."));
  }

  function renderTranspositions() {
    const summary = $("#transposition-summary");
    const list = $("#transposition-list");
    if (!summary || !list) return;
    const groups = getTranspositionGroups(getCurrentTree());
    summary.textContent = groups.length + " posizioni trasposte.";
    list.replaceChildren();
    if (!groups.length) { list.append(node("p", "empty-state", "Nessuna trasposizione nella linea attiva.")); return; }
    for (const group of groups) {
      const card = node("div", "transposition-entry");
      card.append(node("strong", "", group.paths.length + " sequenze → stessa posizione"));
      card.append(node("small", "", group.fen));
      for (const path of group.paths) {
        const button = node("button", "transposition-path-button", path.moves || "Posizione iniziale");
        button.type = "button";
        button.addEventListener("click", () => loadPath(path.edgeIds));
        card.append(button);
      }
      list.append(card);
    }
  }

  async function runOpponentAnalysis() {
    const pgn = $("#opponent-pgn")?.value.trim();
    if (!pgn) { toast("Incolla le partite PGN dell'avversario."); return; }
    try {
      opponentReport = analyzeOpponentPgn(pgn, $("#opponent-side").value);
      await persistOpponentReport();
      renderOpponentReport();
      toast("Report avversario aggiornato.");
    } catch (error) { toast("Analisi avversario non riuscita: " + error.message); }
  }

  function render() {
    if (!ready) return;
    renderCards();
    renderHeatmap();
    renderOpponentReport();
    renderTranspositions();
  }

  const initializePromise = initialize().catch((error) => toast("Errore inizializzazione strumenti: " + error.message));
  $("#generate-cards")?.addEventListener("click", () => { void generateMistakeCards(); });
  $("#review-cards")?.addEventListener("click", startCardReview);
  $("#start-blindfold")?.addEventListener("click", startBlindfold);
  $("#submit-blindfold")?.addEventListener("click", submitBlindfoldAnswer);
  $("#stop-blindfold")?.addEventListener("click", stopBlindfold);
  $("#blindfold-answer")?.addEventListener("keydown", (event) => { if (event.key === "Enter") submitBlindfoldAnswer(); });
  $("#analyze-opponent")?.addEventListener("click", () => { void runOpponentAnalysis(); });

  return {
    refresh: render,
    ready: initializePromise,
    addErrorCard,
    addConceptCard,
    stopBlindfold,
    loadImportedPgn: updateImportedPgn,
    exportState: () => ({ cards, opponentReport, importedPgn }),
    async importState(state) {
      if (!state || typeof state !== "object") return;
      if (Array.isArray(state.cards)) cards = state.cards;
      if (state.opponentReport) opponentReport = state.opponentReport;
      if (typeof state.importedPgn === "string") importedPgn = state.importedPgn;
      await persistCards();
      if (opponentReport) await persistOpponentReport();
      await saveSetting(IMPORTED_GAMES_KEY, importedPgn);
      render();
    },
  };
}
