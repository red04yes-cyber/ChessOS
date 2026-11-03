import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parseUciInfo, uciPvToSan } from "./engine-uci.js";
import { parsePgnCollection } from "./pgn-import.js";
import { fetchChessComGames, fetchLichessGames } from "./game-sources.js";
import { classifyMoveLoss, explainMove, scoreToWhiteCentipawns } from "./chess-coach.js";

const fmt = new Intl.NumberFormat("it-IT");

export function initChessLab(options) {
  const { container, desktopApp, getGame, getMode, getPositions, getMoves, startEngine, playUciMove, importGames } = options;
  const style = document.createElement("style");
  style.textContent = [
    ".chess-lab-card{min-width:0}",
    ".lab-sections{display:grid;gap:9px}",
    ".lab-section{border:1px solid #354253;border-radius:7px;background:#192331;padding:10px}",
    ".lab-section summary{cursor:pointer;color:#d6deea;font-size:10px;font-weight:800;letter-spacing:.04em}",
    ".lab-body{display:grid;gap:8px;margin-top:9px}",
    ".lab-row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}",
    ".lab-row .text-input{min-width:0;flex:1 1 100px;padding:7px;font-size:10px}",
    ".lab-note{color:#91a0b2;font-size:9px;line-height:1.45;margin:0}",
    ".lab-status{color:#aebccc;font-size:10px;line-height:1.5}",
    ".lab-status.error{color:#e99b96}",
    ".lab-list{display:grid;gap:6px;max-height:280px;overflow:auto}",
    ".lab-result{border:1px solid #354253;border-radius:6px;padding:8px;background:#202a37;display:grid;gap:5px}",
    ".lab-result-head{display:flex;justify-content:space-between;gap:8px;color:#e4c17d;font-size:10px;font-weight:800}",
    ".lab-result p{margin:0;color:#c5d0dd;font-size:10px;line-height:1.5}",
    ".lab-result small{color:#8796a8;font-size:9px}",
    ".lab-move{display:grid;grid-template-columns:52px minmax(0,1fr) 78px;gap:6px;align-items:center;padding:7px;border:1px solid #354253;border-radius:6px;background:#202a37}",
    ".lab-move button{border:0;background:transparent;color:#e4c17d;text-align:left;font-weight:800;cursor:pointer}",
    ".lab-move small{color:#c5d0dd;font-size:9px}",
    ".lab-tag{border-radius:4px;background:#344253;color:#cbd5e1;padding:3px 6px;font-size:9px}",
    ".lab-progress{height:5px;background:#2c394a;border-radius:5px;overflow:hidden}",
    ".lab-progress>span{display:block;height:100%;width:0;background:#d7a64b;transition:width .15s}",
    ".lab-file{color:#9eadbd;font-size:10px;max-width:100%}",
    ".lab-input{width:100%;min-height:60px;background:#121923;color:#e6edf5;border:1px solid #3a4656;border-radius:5px;padding:8px;font:inherit;font-size:10px;resize:vertical}",
    ".lab-link{color:#e2bd70;font-size:9px;text-decoration:underline}"
  ].join("");
  document.head.append(style);

  const card = document.createElement("section");
  card.className = "detail-card chess-lab-card";
  card.innerHTML = [
    '<div class="card-heading"><span class="card-icon">✦</span><span>CHESS LAB</span></div>',
    '<div class="lab-sections">',
    '<details class="lab-section" open><summary>1–2 · Analisi partita e spiegazione degli errori</summary><div class="lab-body">',
    '<div class="lab-row"><label class="field-label" for="lab-depth">Profondità</label><select id="lab-depth" class="text-input"><option value="8">8</option><option value="10" selected>10</option><option value="12">12</option></select><button class="button small primary" id="lab-review">Analizza le mosse</button><button class="button small ghost" id="lab-review-stop" disabled>Interrompi</button></div>',
    '<div class="lab-status" id="lab-review-status">Apri o importa una partita con mosse.</div><div class="lab-progress"><span id="lab-review-progress"></span></div><div class="lab-list" id="lab-review-results"></div>',
    '<p class="lab-note">Il motore confronta la valutazione prima e dopo ogni mossa. Le spiegazioni indicano il tema riconosciuto o, in assenza di una causa evidente, la differenza rispetto alla linea migliore.</p>',
    '</div></details>',
    '<details class="lab-section"><summary>3 · Opening Explorer</summary><div class="lab-body">',
    '<div class="lab-row"><select id="lab-explorer-source" class="text-input"><option value="masters">Partite dei Maestri</option><option value="lichess">Database Lichess</option></select><button class="button small primary" id="lab-explorer">Esplora posizione</button></div>',
    '<label class="field-label" for="lab-lichess-token">Token API Lichess</label><input id="lab-lichess-token" class="text-input" type="password" autocomplete="off" placeholder="Token personale · non salvato" />',
    '<a class="lab-link" href="https://lichess.org/account/oauth/token" target="_blank" rel="noopener noreferrer">Crea un token Lichess</a>',
    '<div class="lab-status" id="lab-explorer-status">Statistiche di mosse, risultati e popolarità della posizione.</div><div class="lab-list" id="lab-explorer-results"></div>',
    '</div></details>',
    '<details class="lab-section"><summary>4 · Gioca contro Stockfish</summary><div class="lab-body">',
    '<div class="lab-row"><label class="field-label" for="lab-player-color">Tu giochi con</label><select id="lab-player-color" class="text-input"><option value="w">Bianco</option><option value="b">Nero</option></select><button class="button small primary" id="lab-play-toggle" ' + (desktopApp ? "" : "disabled") + '>Inizia partita</button></div>',
    '<div class="lab-status" id="lab-play-status">' + (desktopApp ? "Parti dalla posizione corrente o da una variante selezionata." : "Stockfish è disponibile nella versione desktop Windows.") + '</div>',
    '<p class="lab-note">Il motore gioca automaticamente quando è il suo turno. Puoi terminare la partita in qualsiasi momento.</p>',
    '</div></details>',
    '<details class="lab-section"><summary>5 · Importa partite da file, Chess.com o Lichess</summary><div class="lab-body">',
    '<label class="field-label" for="lab-pgn-file">File PGN locale</label><input id="lab-pgn-file" class="lab-file" type="file" accept=".pgn,.txt,application/x-chess-pgn,text/plain" />',
    '<div class="lab-row"><select id="lab-platform" class="text-input"><option value="chesscom">Chess.com</option><option value="lichess">Lichess</option></select><input id="lab-username" class="text-input" maxlength="30" placeholder="Username pubblico" autocomplete="off" /><button class="button small ghost" id="lab-import-account">Scarica partite</button></div>',
    '<textarea id="lab-pgn-text" class="lab-input" rows="3" placeholder="Oppure incolla uno o più PGN…"></textarea><div class="lab-row"><button class="button small primary" id="lab-import-text">Importa PGN</button></div>',
    '<div class="lab-status" id="lab-import-status">Fino a 100 partite per importazione. Le partite valide vengono conservate anche se altre non superano la verifica.</div><div class="lab-list" id="lab-import-errors"></div>',
    '<p class="lab-note">I profili remoti devono essere pubblici. L'importazione non richiede la password dell'account.</p>',
    '</div></details>',
    '</div>'
  ].join("");
  container.append(card);

  const $ = (selector) => card.querySelector(selector);
  const pending = new Map();
  let requestSequence = Date.now() * 10;
  let reviewCancelled = false;
  let reviewRunning = false;
  let playActive = false;
  let playBusy = false;
  let playerColor = "w";
  let openingController = null;
  const openingCache = new Map();
  let tokenInMemory = "";

  function setStatus(selector, message, isError = false) {
    const element = $(selector);
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", isError);
  }

  const eventReady = listen("stockfish://line", (event) => {
    const payload = event.payload || {};
    const requestId = Number(payload.requestId ?? payload.request_id ?? 0);
    const line = String(payload.line || "");
    const search = pending.get(requestId);
    if (!search) return;
    if (line.startsWith("info ")) {
      const info = parseUciInfo(line);
      if (info && info.multipv === 1) search.info = info;
    } else if (line.startsWith("bestmove ")) {
      pending.delete(requestId);
      window.clearTimeout(search.timer);
      search.resolve({ bestmove: line.trim().split(/\s+/)[1] || "(none)", info: search.info });
    }
  });

  async function ensureEngine() {
    if (!desktopApp) throw new Error("Stockfish è disponibile solo nell'app desktop Windows.");
    if (!(await startEngine())) throw new Error("Stockfish non è riuscito ad avviarsi.");
    await eventReady;
  }

  async function searchPosition(fen, depth) {
    await ensureEngine();
    const requestId = ++requestSequence;
    let resolveSearch;
    let rejectSearch;
    const promise = new Promise((resolve, reject) => { resolveSearch = resolve; rejectSearch = reject; });
    const search = { info: null, resolve: resolveSearch, reject: rejectSearch, timer: null };
    search.timer = window.setTimeout(() => {
      if (pending.delete(requestId)) {
        void invoke("stockfish_stop_analysis").catch(() => {});
        rejectSearch(new Error("Timeout nella risposta di Stockfish."));
      }
    }, 60_000);
    pending.set(requestId, search);
    try {
      await invoke("stockfish_analyze", { fen, depth, multiPv: 1, requestId });
    } catch (error) {
      if (pending.delete(requestId)) {
        window.clearTimeout(search.timer);
        rejectSearch(error);
      }
    }
    return promise;
  }

  function renderReviewRows(rows, total, truncated) {
    const target = $("#lab-review-results");
    target.replaceChildren();
    for (const row of rows) {
      const element = document.createElement("article");
      element.className = "lab-result";
      const head = document.createElement("div");
      head.className = "lab-result-head";
      const jump = document.createElement("button");
      jump.type = "button";
      jump.textContent = row.label;
      jump.title = "Vai a questa mossa";
      jump.addEventListener("click", () => {
        const index = row.ply - 1;
        const button = document.querySelectorAll("#move-list .san-move")[index];
        button?.click();
      });
      const tag = document.createElement("span");
      tag.className = "lab-tag";
      tag.textContent = row.classification;
      head.append(jump, tag);
      const detail = document.createElement("p");
      detail.textContent = row.explanation;
      const best = document.createElement("small");
      best.textContent = "Perdita stimata " + (row.loss / 100).toFixed(2) + " · migliore linea: " + (row.best || "—");
      element.append(head, detail, best);
      target.append(element);
    }
    if (!rows.length) {
      const empty = document.createElement("span");
      empty.className = "empty-state";
      empty.textContent = "Nessun errore significativo trovato alla profondità selezionata.";
      target.append(empty);
    }
    const note = document.createElement("p");
    note.className = "lab-note";
    note.textContent = total + " semimosse confrontate" + (truncated ? " · analisi limitata alle prime 80 semimosse." : "");
    target.append(note);
  }

  async function reviewGame() {
    if (reviewRunning) return;
    if (getMode() !== "studio") {
      setStatus("#lab-review-status", "Esci dall'allenamento prima di analizzare una partita.", true);
      return;
    }
    const moves = getMoves();
    const positions = getPositions();
    if (!moves.length || positions.length !== moves.length + 1) {
      setStatus("#lab-review-status", "Apri o importa una partita con almeno una mossa.", true);
      return;
    }
    const maxPlies = Math.min(moves.length, 80);
    const depth = Number($("#lab-depth").value) || 10;
    reviewRunning = true;
    reviewCancelled = false;
    $("#lab-review").disabled = true;
    $("#lab-review-stop").disabled = false;
    $("#lab-review-results").replaceChildren();
    $("#lab-review-progress").style.width = "0%";
    const evaluations = [];
    try {
      for (let index = 0; index <= maxPlies; index += 1) {
        if (reviewCancelled) break;
        setStatus("#lab-review-status", "Analisi Stockfish: posizione " + (index + 1) + " / " + (maxPlies + 1) + "…");
        $("#lab-review-progress").style.width = ((index + 1) / (maxPlies + 1) * 100) + "%";
        evaluations.push(await searchPosition(positions[index], depth));
      }
      if (reviewCancelled) {
        setStatus("#lab-review-status", "Analisi interrotta.");
        return;
      }
      const rows = [];
      for (let index = 0; index < maxPlies; index += 1) {
        const beforeSide = positions[index].split(/\s+/)[1];
        const afterSide = positions[index + 1].split(/\s+/)[1];
        const before = scoreToWhiteCentipawns(evaluations[index].info, beforeSide);
        const after = scoreToWhiteCentipawns(evaluations[index + 1].info, afterSide);
        if (before === null || after === null) continue;
        const loss = Math.max(0, beforeSide === "w" ? before - after : after - before);
        if (loss < 60) continue;
        const move = moves[index];
        const uci = move.from + move.to + (move.promotion || "");
        const bestLine = evaluations[index].info?.pv?.length
          ? uciPvToSan(positions[index], evaluations[index].info.pv)
          : "";
        const mover = beforeSide === "w" ? "Bianco" : "Nero";
        const label = mover === "Bianco"
          ? Math.ceil((index + 1) / 2) + ". " + move.san
          : Math.ceil((index + 1) / 2) + "... " + move.san;
        rows.push({
          ply: index + 1,
          label,
          loss,
          classification: classifyMoveLoss(loss),
          best: bestLine.split(" ").slice(0, 5).join(" "),
          explanation: explainMove(positions[index], uci, evaluations[index].info, loss),
        });
      }
      renderReviewRows(rows, maxPlies, moves.length > maxPlies);
      setStatus("#lab-review-status", "Analisi completata: " + rows.length + " imprecisioni, errori o sviste individuati.");
    } catch (error) {
      setStatus("#lab-review-status", "Analisi non riuscita: " + error.message, true);
    } finally {
      reviewRunning = false;
      $("#lab-review").disabled = false;
      $("#lab-review-stop").disabled = true;
    }
  }

  async function stopReview() {
    reviewCancelled = true;
    try { await invoke("stockfish_stop_analysis"); } catch { /* Il motore potrebbe aver già concluso. */ }
  }

  async function playEngineTurn() {
    if (!playActive || playBusy || getMode() !== "studio") return;
    const chess = getGame();
    if (chess.isGameOver() || chess.turn() === playerColor) {
      setStatus("#lab-play-status", chess.isGameOver() ? "Partita terminata." : "Tocca a te.");
      return;
    }
    playBusy = true;
    $("#lab-play-toggle").disabled = true;
    const fen = chess.fen();
    setStatus("#lab-play-status", "Stockfish sta scegliendo la mossa…");
    try {
      const result = await searchPosition(fen, Number($("#lab-depth").value) || 10);
      if (!playActive || getGame().fen() !== fen) return;
      if (!result.bestmove || ["(none)", "(null)"].includes(result.bestmove)) {
        playActive = false;
        setStatus("#lab-play-status", "Nessuna mossa legale: partita terminata.");
        return;
      }
      if (!playUciMove(result.bestmove)) {
        playActive = false;
        setStatus("#lab-play-status", "La mossa proposta dal motore non è stata applicata.", true);
      } else {
        setStatus("#lab-play-status", "Stockfish ha giocato " + result.bestmove + ". Tocca a te.");
      }
    } catch (error) {
      playActive = false;
      setStatus("#lab-play-status", "Partita interrotta: " + error.message, true);
    } finally {
      playBusy = false;
      $("#lab-play-toggle").disabled = false;
      $("#lab-play-toggle").textContent = playActive ? "Termina partita" : "Inizia partita";
    }
  }

  function onPositionChanged() {
    if (!playActive || playBusy || getMode() !== "studio") return;
    const chess = getGame();
    if (chess.turn() !== playerColor && !chess.isGameOver()) void playEngineTurn();
  }

  async function togglePlay() {
    if (playActive) {
      playActive = false;
      if (playBusy) {
        try { await invoke("stockfish_stop_analysis"); } catch { /* Ricerca già terminata. */ }
      }
      setStatus("#lab-play-status", "Partita contro Stockfish terminata.");
      $("#lab-play-toggle").textContent = "Inizia partita";
      $("#lab-play-toggle").disabled = false;
      return;
    }
    if (getMode() !== "studio") {
      setStatus("#lab-play-status", "Apri una posizione in Studio prima di iniziare.", true);
      return;
    }
    playerColor = $("#lab-player-color").value;
    try {
      await ensureEngine();
      playActive = true;
      $("#lab-play-toggle").textContent = "Termina partita";
      setStatus("#lab-play-status", "Partita avviata dalla posizione corrente.");
      onPositionChanged();
      if (getGame().turn() === playerColor) setStatus("#lab-play-status", "Tocca a te.");
    } catch (error) {
      setStatus("#lab-play-status", error.message, true);
    }
  }

  async function exploreOpening() {
    tokenInMemory = $("#lab-lichess-token").value.trim();
    if (!tokenInMemory) {
      setStatus("#lab-explorer-status", "Inserisci un token personale Lichess. Il token resta in memoria e non viene salvato.", true);
      return;
    }
    if (openingController) openingController.abort();
    openingController = new AbortController();
    const source = $("#lab-explorer-source").value;
    const cacheKey = source + "|" + getGame().fen();
    $("#lab-explorer").disabled = true;
    $("#lab-explorer-results").replaceChildren();
    setStatus("#lab-explorer-status", "Consultazione Opening Explorer…");
    try {
      let data = openingCache.get(cacheKey);
      if (!data) {
        const params = new URLSearchParams({ fen: getGame().fen(), moves: "12", topGames: "8", recentGames: "0", variant: "chess" });
        const response = await fetch("https://explorer.lichess.org/" + source + "?" + params.toString(), {
          signal: openingController.signal,
          headers: { Authorization: "Bearer " + tokenInMemory, Accept: "application/json" },
        });
        if (response.status === 429) throw new Error("Limite Lichess raggiunto: attendi almeno un minuto prima di riprovare.");
        if (response.status === 401 || response.status === 403) throw new Error("Token Lichess non valido o senza accesso all'Opening Explorer.");
        if (!response.ok) throw new Error("Opening Explorer ha risposto HTTP " + response.status + ".");
        data = await response.json();
        openingCache.set(cacheKey, data);
      }
      const target = $("#lab-explorer-results");
      const name = data.opening?.name;
      const total = Number(data.white || 0) + Number(data.draws || 0) + Number(data.black || 0);
      setStatus("#lab-explorer-status", (name ? name + " · " : "") + fmt.format(total) + " partite nel database.");
      for (const move of data.moves || []) {
        const games = Number(move.white || 0) + Number(move.draws || 0) + Number(move.black || 0);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "lab-move";
        const san = document.createElement("span");
        san.textContent = move.san || move.uci;
        const count = document.createElement("span");
        count.className = "lab-tag";
        count.textContent = fmt.format(games);
        const results = document.createElement("small");
        results.textContent = "B " + number(move.white) + " · ½ " + number(move.draws) + " · N " + number(move.black);
        button.append(san, count, results);
        button.addEventListener("click", () => {
          if (!playUciMove(move.uci)) setStatus("#lab-explorer-status", "La mossa non è legale nella posizione corrente.", true);
        });
        target.append(button);
      }
      if (!(data.moves || []).length) setStatus("#lab-explorer-status", "Nessuna statistica trovata per questa posizione.");
    } catch (error) {
      if (error.name !== "AbortError") setStatus("#lab-explorer-status", error.message, true);
    } finally {
      $("#lab-explorer").disabled = false;
    }
  }

  function showImportErrors(parseErrors, saveErrors) {
    const target = $("#lab-import-errors");
    target.replaceChildren();
    for (const error of [...parseErrors, ...saveErrors]) {
      const item = document.createElement("p");
      item.className = "lab-note";
      item.textContent = "Partita " + error.index + ": " + error.message;
      target.append(item);
    }
  }

  async function importCollection(source, label) {
    if (!String(source || "").trim()) throw new Error("Nessun testo PGN da importare.");
    const parsed = parsePgnCollection(source);
    if (!parsed.games.length) {
      showImportErrors(parsed.errors, []);
      setStatus("#lab-import-status", "Nessuna partita valida da salvare.", true);
      return;
    }
    setStatus("#lab-import-status", "Salvataggio di " + parsed.games.length + " partite " + label + "…");
    const result = await importGames(parsed.games);
    showImportErrors(parsed.errors, result.errors || []);
    setStatus("#lab-import-status", result.saved + " di " + parsed.total + " partite salvate nel repertorio.");
  }

  $("#lab-review").addEventListener("click", () => { void reviewGame(); });
  $("#lab-review-stop").addEventListener("click", () => { void stopReview(); });
  $("#lab-explorer").addEventListener("click", () => { void exploreOpening(); });
  $("#lab-play-toggle").addEventListener("click", () => { void togglePlay(); });
  $("#lab-import-text").addEventListener("click", () => {
    void importCollection($("#lab-pgn-text").value, "incollate")
      .catch((error) => setStatus("#lab-import-status", error.message, true));
  });
  $("#lab-pgn-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 10_000_000) throw new Error("Il file supera il limite di 10 MB.");
      await importCollection(await file.text(), "dal file " + file.name);
    } catch (error) {
      setStatus("#lab-import-status", error.message, true);
    } finally {
      event.target.value = "";
    }
  });
  $("#lab-import-account").addEventListener("click", async () => {
    const platform = $("#lab-platform").value;
    const username = $("#lab-username").value.trim();
    $("#lab-import-account").disabled = true;
    try {
      setStatus("#lab-import-status", "Download degli archivi pubblici da " + platform + "…");
      const pgn = platform === "chesscom"
        ? await fetchChessComGames(username, 2)
        : await fetchLichessGames(username, 50);
      await importCollection(pgn, "da " + platform);
    } catch (error) {
      setStatus("#lab-import-status", error.message, true);
    } finally {
      $("#lab-import-account").disabled = false;
    }
  });

  return {
    onPositionChanged,
    stopPlay() {
      playActive = false;
      if (openingController) openingController.abort();
    },
  };
}
