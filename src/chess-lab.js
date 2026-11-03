import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parseUciInfo } from "./engine-uci.js";
import { parsePgnCollection } from "./pgn-import.js";
import { syncChessComGames, syncLichessGames } from "./game-sources.js";
import { buildMoveReview, timelineFromPgn } from "./chess-metrics.js";

const fmt = new Intl.NumberFormat("it-IT");

export function initChessLab(options) {
  const { container, desktopApp, getGame, getMode, getPositions, getMoves, startEngine, playUciMove, importGames, getArchive = () => [], getPlayerNames = () => [], openPuzzle = () => false, openArchiveGame = () => false } = options;
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
    ".lab-link{color:#e2bd70;font-size:9px;text-decoration:underline}",
    ".lab-metrics{display:flex;gap:7px;flex-wrap:wrap;color:#e6edf5;font-size:10px;line-height:1.5}",
    ".lab-metric{border:1px solid #354253;border-radius:6px;padding:7px 9px;background:#202a37}",
    ".lab-chart{min-height:92px;border:1px solid #354253;border-radius:6px;background:#121923;padding:6px;overflow:hidden}",
    ".lab-chart svg{width:100%;height:100px;display:block}",
    ".lab-chart text{font:9px sans-serif;fill:#91a0b2}",
    ".lab-puzzle{display:grid;gap:5px;border:1px solid #80683d;border-radius:6px;padding:8px;background:#292a2b}",
    ".lab-puzzle button{justify-self:start}",
    ".lab-archive-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:center;border:1px solid #354253;border-radius:6px;padding:7px;background:#202a37}",
    ".lab-archive-row p{margin:0;color:#c5d0dd;font-size:10px;line-height:1.4}",
    ".lab-account-grid{display:grid;gap:7px}",
    ".lab-account-grid .text-input{min-width:0;width:100%;padding:7px;font-size:10px}"
  ].join("");
  document.head.append(style);

  const card = document.createElement("section");
  card.className = "detail-card chess-lab-card";
  card.innerHTML = [
    '<div class="card-heading"><span class="card-icon">✦</span><span>CHESS LAB</span></div>',
    '<div class="lab-sections">',
    '<details class="lab-section" open><summary>1–2 · Analisi partita e spiegazione degli errori</summary><div class="lab-body">',
    '<div class="lab-row"><label class="field-label" for="lab-depth">Profondità</label><select id="lab-depth" class="text-input"><option value="8">8</option><option value="10" selected>10</option><option value="12">12</option></select><button class="button small primary" id="lab-review">Analizza le mosse</button><button class="button small ghost" id="lab-review-stop" disabled>Interrompi</button></div>',
    '<div class="lab-status" id="lab-review-status">Apri una partita oppure sincronizza un account e analizza l\'archivio.</div><div class="lab-progress"><span id="lab-review-progress"></span></div><div class="lab-metrics" id="lab-review-summary"></div><div class="lab-chart" id="lab-review-chart"></div><div class="lab-list" id="lab-review-results"></div><div class="lab-list" id="lab-puzzles"></div>',
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
    '<details class="lab-section" open><summary>5 · Sincronizza account e importa partite</summary><div class="lab-body">',
    '<div class="lab-account-grid">',
    '<label class="field-label" for="lab-chesscom-user">Username Chess.com</label><input id="lab-chesscom-user" class="text-input" maxlength="30" placeholder="Il tuo username pubblico" autocomplete="off" />',
    '<label class="field-label" for="lab-lichess-user">Username Lichess</label><input id="lab-lichess-user" class="text-input" maxlength="30" placeholder="Il tuo username Lichess" autocomplete="off" />',
    '<label class="field-label" for="lab-lichess-import-token">Token Lichess (facoltativo)</label><input id="lab-lichess-import-token" class="text-input" type="password" autocomplete="off" placeholder="Solo in memoria · nessuna password" />',
    '<a class="lab-link" href="https://lichess.org/account/oauth/token" target="_blank" rel="noopener noreferrer">Crea token API Lichess</a>',
    '<button class="button small primary" id="lab-sync-accounts">Sincronizza account</button></div>',
    '<p class="lab-note">Chess.com: il servizio ufficiale espone solo le partite pubbliche, senza login. Lichess: esporta tutte le partite; il token facoltativo resta in memoria e non viene salvato.</p>',
    '<label class="field-label" for="lab-pgn-file">Oppure importa un file PGN</label><input id="lab-pgn-file" class="lab-file" type="file" accept=".pgn,.txt,application/x-chess-pgn,text/plain" />',
    '<textarea id="lab-pgn-text" class="lab-input" rows="3" placeholder="Oppure incolla uno o più PGN…"></textarea><div class="lab-row"><button class="button small ghost" id="lab-import-text">Importa PGN</button></div>',
    '<div class="lab-status" id="lab-import-status">La sincronizzazione scarica gli archivi mensili Chess.com e l\'export completo Lichess, in sequenza. Le partite già presenti vengono saltate.</div><div class="lab-list" id="lab-import-errors"></div>',
    '</div></details>',
    '<details class="lab-section"><summary>6 · Analizza tutte le partite archiviate e crea puzzle</summary><div class="lab-body">',
    '<div class="lab-row"><label class="field-label" for="lab-archive-limit">Partite</label><select id="lab-archive-limit" class="text-input"><option value="10">Ultime 10</option><option value="25" selected>Ultime 25</option><option value="50">Ultime 50</option><option value="all">Tutte</option></select><button class="button small primary" id="lab-archive-analyze">Analizza archivio</button><button class="button small ghost" id="lab-archive-stop" disabled>Interrompi</button></div>',
    '<div class="lab-status" id="lab-archive-status">Analizza ogni mossa con Stockfish e conserva localmente precisione, grafico e puzzle generati.</div><div class="lab-progress"><span id="lab-archive-progress"></span></div><div class="lab-metrics" id="lab-archive-summary"></div><div class="lab-chart" id="lab-archive-chart"></div><div class="lab-list" id="lab-archive-results"></div>',
    '<p class="lab-note">La precisione è una stima interna basata sulla perdita media in centipawn, non coincide con il punteggio proprietario di Chess.com o Lichess. Per contenere i tempi l\'analisi dell\'archivio usa profondità 8 e al massimo 60 semimosse per partita; puoi interromperla e riprenderla.</p>',
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
  let archiveCancelled = false;
  let archiveRunning = false;
  let latestReviewReport = null;
  const ANALYSIS_STORAGE_KEY = "chess-os.move-analysis.v1";
  let searchBusy = false;

  function setStatus(selector, message, isError = false) {
    const element = $(selector);
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", isError);
  }

  let eventError = null;
  const eventReady = desktopApp
    ? listen("stockfish://line", (event) => {
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
      }).catch((error) => { eventError = error; })
    : Promise.resolve();

  async function ensureEngine() {
    if (!desktopApp) throw new Error("Stockfish è disponibile solo nell'app desktop Windows.");
    if (!(await startEngine())) throw new Error("Stockfish non è riuscito ad avviarsi.");
    await eventReady;
    if (eventError) throw eventError;
  }

  async function searchPosition(fen, depth) {
    if (searchBusy) throw new Error("Stockfish è già impegnato in un'altra analisi.");
    searchBusy = true;
    try {
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
      return await promise;
    } finally {
      searchBusy = false;
    }
  }

  function renderLineChart(targetSelector, values, mode = "evaluation") {
    const target = $(targetSelector);
    target.replaceChildren();
    const clean = values.filter(Number.isFinite);
    if (!clean.length) {
      target.textContent = "Grafico disponibile dopo l'analisi.";
      return;
    }
    const width = 420, height = 100, pad = 12;
    const min = mode === "accuracy" ? 0 : -600;
    const max = mode === "accuracy" ? 100 : 600;
    const points = clean.map((value, index) => {
      const x = pad + (clean.length === 1 ? 0 : index / (clean.length - 1) * (width - pad * 2));
      const bounded = Math.max(min, Math.min(max, value));
      const y = height - pad - ((bounded - min) / (max - min)) * (height - pad * 2);
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", mode === "accuracy" ? "Andamento della precisione per partita" : "Andamento della valutazione dal punto di vista del Bianco");
    const baseline = document.createElementNS(svg.namespaceURI, "line");
    const baselineY = mode === "accuracy" ? height - pad : height / 2;
    baseline.setAttribute("x1", String(pad)); baseline.setAttribute("x2", String(width - pad));
    baseline.setAttribute("y1", String(baselineY)); baseline.setAttribute("y2", String(baselineY));
    baseline.setAttribute("stroke", "#526174"); baseline.setAttribute("stroke-dasharray", "3 4");
    const line = document.createElementNS(svg.namespaceURI, "polyline");
    line.setAttribute("points", points); line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#e4c17d"); line.setAttribute("stroke-width", "2.5");
    line.setAttribute("stroke-linecap", "round"); line.setAttribute("stroke-linejoin", "round");
    const first = document.createElementNS(svg.namespaceURI, "text");
    first.setAttribute("x", String(pad)); first.setAttribute("y", "9");
    first.textContent = mode === "accuracy" ? Math.round(clean[0]) + "%" : (clean[0] / 100).toFixed(1);
    const last = document.createElementNS(svg.namespaceURI, "text");
    last.setAttribute("x", String(width - pad)); last.setAttribute("y", "9");
    last.setAttribute("text-anchor", "end");
    last.textContent = mode === "accuracy" ? Math.round(clean[clean.length - 1]) + "%" : (clean[clean.length - 1] / 100).toFixed(1);
    svg.append(baseline, line, first, last);
    target.append(svg);
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
      best.textContent = "Perdita " + (row.loss / 100).toFixed(2) + " · migliore linea: " + (row.best || "—");
      element.append(head, detail, best);
      target.append(element);
    }
    if (!rows.length) {
      const empty = document.createElement("span");
      empty.className = "empty-state";
      empty.textContent = "Nessuna mossa valutabile trovata.";
      target.append(empty);
    }
    const note = document.createElement("p");
    note.className = "lab-note";
    note.textContent = total + " semimosse confrontate" + (truncated ? " · analisi limitata alle prime mosse previste." : "");
    target.append(note);
  }

  function renderPuzzles(puzzles) {
    const target = $("#lab-puzzles");
    target.replaceChildren();
    if (!puzzles.length) return;
    const heading = document.createElement("p");
    heading.className = "lab-note";
    heading.textContent = "PUZZLE CREATI DAGLI ERRORI";
    target.append(heading);
    for (const puzzle of puzzles) {
      const item = document.createElement("article");
      item.className = "lab-puzzle";
      const title = document.createElement("strong");
      title.textContent = puzzle.moveLabel + " · " + puzzle.quality;
      const detail = document.createElement("p");
      detail.textContent = "Trova la continuazione migliore: " + (puzzle.explanation || "Evita la perdita di materiale o valutazione.");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button small primary";
      button.textContent = "Risolvi puzzle";
      button.addEventListener("click", () => {
        if (!openPuzzle(puzzle.fen, puzzle.solutionUci)) {
          setStatus("#lab-review-status", "Non è stato possibile aprire questo puzzle.", true);
        }
      });
      item.append(title, detail, button);
      target.append(item);
    }
  }

  function renderReviewReport(report, total, truncated) {
    latestReviewReport = report;
    const target = $("#lab-review-summary");
    target.replaceChildren();
    const addMetric = (label, value) => {
      const item = document.createElement("span");
      item.className = "lab-metric";
      item.textContent = label + ": " + value;
      target.append(item);
    };
    addMetric("Precisione stimata", report.playerAccuracy === null ? "—" : report.playerAccuracy.toFixed(1) + "%");
    addMetric("Bianco", report.whiteAccuracy === null ? "—" : report.whiteAccuracy.toFixed(1) + "%");
    addMetric("Nero", report.blackAccuracy === null ? "—" : report.blackAccuracy.toFixed(1) + "%");
    addMetric("Brillanti", report.counts.Brillante || 0);
    addMetric("Errori/sviste", (report.counts.Errore || 0) + (report.counts.Svista || 0));
    renderLineChart("#lab-review-chart", report.evals, "evaluation");
    renderReviewRows(report.rows, total, truncated);
    renderPuzzles(report.puzzles);
  }

  async function reviewGame() {
    if (reviewRunning || archiveRunning) return;
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
    const depth = Number($("#lab-depth").value) || 10;
    reviewRunning = true;
    reviewCancelled = false;
    $("#lab-review").disabled = true;
    $("#lab-review-stop").disabled = false;
    $("#lab-review-results").replaceChildren();
    $("#lab-review-progress").style.width = "0%";
    try {
      const maxPlies = Math.min(moves.length, 80);
      const evaluations = [];
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
      const report = buildMoveReview(positions.slice(0, maxPlies + 1), moves.slice(0, maxPlies), evaluations, {
        headers: options.getHeaders?.() || {},
        playerNames: getPlayerNames(),
      });
      renderReviewReport(report, maxPlies, moves.length > maxPlies);
      setStatus("#lab-review-status", "Analisi completata: " + report.rows.length + " mosse classificate; " + report.puzzles.length + " puzzle generabili.");
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

  function readAnalysisStore() {
    try {
      const value = JSON.parse(localStorage.getItem(ANALYSIS_STORAGE_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  function writeAnalysisStore(store) {
    try {
      const entries = Object.entries(store).slice(-100);
      localStorage.setItem(ANALYSIS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      setStatus("#lab-archive-status", "Analisi completate, ma lo spazio locale non basta per salvarle tutte.", true);
    }
  }

  function archiveDate(report) {
    const value = String(report.date || "");
    const match = value.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/);
    return match ? match[1] + "-" + match[2] + "-" + match[3] : value || report.createdAt || "";
  }

  function renderArchiveReports(reports) {
    const sorted = [...reports].sort((a, b) => archiveDate(a).localeCompare(archiveDate(b)));
    const scores = sorted.map((report) => report.playerAccuracy ?? report.accuracy).filter(Number.isFinite);
    const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
    const puzzles = sorted.reduce((sum, report) => sum + (report.puzzles?.length || 0), 0);
    const summary = $("#lab-archive-summary");
    summary.replaceChildren();
    const metric = (label, value) => {
      const item = document.createElement("span");
      item.className = "lab-metric";
      item.textContent = label + ": " + value;
      summary.append(item);
    };
    metric("Partite analizzate", sorted.length);
    metric("Precisione media", average === null ? "—" : average.toFixed(1) + "%");
    metric("Puzzle", puzzles);
    renderLineChart("#lab-archive-chart", scores, "accuracy");
    const target = $("#lab-archive-results");
    target.replaceChildren();
    for (const report of [...sorted].reverse()) {
      const item = document.createElement("article");
      item.className = "lab-archive-row";
      const detail = document.createElement("p");
      detail.textContent = (report.title || "Partita") + " · " + (archiveDate(report) || "data non disponibile")
        + " · Precisione " + ((report.playerAccuracy ?? report.accuracy) === null ? "—" : (report.playerAccuracy ?? report.accuracy).toFixed(1) + "%")
        + " · " + (report.puzzles?.length || 0) + " puzzle";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "button small ghost";
      open.textContent = "Apri report";
      open.addEventListener("click", () => {
        if (!openArchiveGame(report.id)) {
          setStatus("#lab-archive-status", "Non è stato possibile aprire la partita nel repertorio.", true);
          return;
        }
        renderReviewReport(report, report.totalPlies || report.rows.length, Boolean(report.truncated));
        setStatus("#lab-review-status", "Report salvato · " + report.title);
      });
      item.append(detail, open);
      target.append(item);
    }
    if (!sorted.length) {
      target.textContent = "Non ci sono ancora report. Avvia l'analisi dell'archivio.";
    }
  }

  async function analyzeArchive() {
    if (!desktopApp) {
      setStatus("#lab-archive-status", "L'analisi Stockfish dell'archivio richiede l'app desktop Windows.", true);
      return;
    }
    if (archiveRunning || reviewRunning) return;
    const allEntries = getArchive().filter((entry) => entry?.id && entry?.pgn);
    if (!allEntries.length) {
      setStatus("#lab-archive-status", "L'archivio è vuoto: sincronizza prima un account o importa un PGN.", true);
      return;
    }
    const selected = $("#lab-archive-limit").value;
    const limit = selected === "all" ? allEntries.length : Number(selected);
    const entries = allEntries.slice(0, limit);
    const store = readAnalysisStore();
    const todo = entries.filter((entry) => store[entry.id]?.version !== 2);
    if (!todo.length) {
      renderArchiveReports(entries.map((entry) => store[entry.id]).filter(Boolean));
      setStatus("#lab-archive-status", "Le " + entries.length + " partite selezionate hanno già un report salvato. Cambia intervallo per continuare con altre partite.");
      return;
    }

    archiveRunning = true;
    archiveCancelled = false;
    $("#lab-archive-analyze").disabled = true;
    $("#lab-archive-stop").disabled = false;
    $("#lab-archive-progress").style.width = "0%";
    let completed = 0;
    let failed = 0;
    try {
      for (const [index, entry] of todo.entries()) {
        if (archiveCancelled) break;
        setStatus("#lab-archive-status", "Partita " + (index + 1) + " / " + todo.length + ": " + (entry.title || "senza titolo"));
        let timeline;
        try {
          timeline = timelineFromPgn(entry.pgn);
          if (!timeline.moves.length) throw new Error("La partita non contiene mosse.");
          const maxPlies = Math.min(timeline.moves.length, 60);
          const evaluations = [];
          for (let ply = 0; ply <= maxPlies; ply += 1) {
            if (archiveCancelled) break;
            const absolute = completed + (ply + 1) / (maxPlies + 1);
            $("#lab-archive-progress").style.width = (absolute / todo.length * 100) + "%";
            setStatus("#lab-archive-status", "Partita " + (index + 1) + " / " + todo.length + " · posizione " + (ply + 1) + " / " + (maxPlies + 1));
            evaluations.push(await searchPosition(timeline.positions[ply], 8));
          }
          if (archiveCancelled) break;
          const review = buildMoveReview(
            timeline.positions.slice(0, maxPlies + 1),
            timeline.moves.slice(0, maxPlies),
            evaluations,
            { headers: timeline.headers, playerNames: getPlayerNames() },
          );
          const report = {
            version: 2,
            id: entry.id,
            title: entry.title || timeline.headers.Event || "Partita",
            date: timeline.headers.Date || "",
            createdAt: entry.createdAt || "",
            totalPlies: maxPlies,
            truncated: timeline.moves.length > maxPlies,
            accuracy: review.accuracy,
            whiteAccuracy: review.whiteAccuracy,
            blackAccuracy: review.blackAccuracy,
            playerAccuracy: review.playerAccuracy,
            playerSide: review.playerSide,
            counts: review.counts,
            rows: review.rows,
            evals: review.evals,
            puzzles: review.puzzles,
          };
          store[entry.id] = report;
          writeAnalysisStore(store);
          completed += 1;
        } catch (error) {
          failed += 1;
          const errors = $("#lab-archive-results");
          const line = document.createElement("p");
          line.className = "lab-note";
          line.textContent = (entry.title || "Partita") + ": " + error.message;
          errors.append(line);
        }
      }
      const reports = entries.map((entry) => store[entry.id]).filter(Boolean);
      renderArchiveReports(reports);
      setStatus("#lab-archive-status", (archiveCancelled ? "Analisi interrotta. " : "Analisi completata. ")
        + completed + " nuove partite analizzate, " + failed + " non riuscite. I report già salvati sono stati mantenuti.");
    } catch (error) {
      setStatus("#lab-archive-status", "Analisi archivio non riuscita: " + error.message, true);
    } finally {
      archiveRunning = false;
      $("#lab-archive-analyze").disabled = !desktopApp;
      $("#lab-archive-stop").disabled = true;
    }
  }

  async function stopArchiveAnalysis() {
    archiveCancelled = true;
    try { await invoke("stockfish_stop_analysis"); } catch { /* La ricerca potrebbe essere già conclusa. */ }
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
      if (playActive && getMode() === "studio" && getGame().turn() !== playerColor && !getGame().isGameOver()) {
        window.setTimeout(onPositionChanged, 0);
      }
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
    if (!String(source || "").trim()) return { saved: 0, skipped: 0, errors: [] };
    const parsed = parsePgnCollection(source);
    if (!parsed.games.length) {
      showImportErrors(parsed.errors, []);
      setStatus("#lab-import-status", "Nessuna partita valida da salvare: " + parsed.errors.length + " errori.", true);
      return { saved: 0, skipped: 0, errors: parsed.errors };
    }
    setStatus("#lab-import-status", "Salvataggio di " + parsed.games.length + " partite " + label + "…");
    const result = await importGames(parsed.games);
    showImportErrors(parsed.errors, result.errors || []);
    setStatus("#lab-import-status", result.saved + " nuove partite salvate, " + (result.skipped || 0) + " già presenti, " + (parsed.errors.length + (result.errors || []).length) + " errori.");
    return { ...result, errors: [...parsed.errors, ...(result.errors || [])], total: parsed.total };
  }

  async function syncAccounts() {
    const chesscom = $("#lab-chesscom-user").value.trim();
    const lichess = $("#lab-lichess-user").value.trim();
    const token = $("#lab-lichess-import-token").value.trim();
    if (!chesscom && !lichess) {
      setStatus("#lab-import-status", "Inserisci almeno uno username Chess.com o Lichess.", true);
      return;
    }
    try {
      localStorage.setItem("chess-os.connected-accounts.v1", JSON.stringify({ chesscom, lichess }));
    } catch {
      // I nomi utente sono una preferenza locale, non un requisito per la sincronizzazione.
    }
    $("#lab-sync-accounts").disabled = true;
    let saved = 0;
    let skipped = 0;
    let failures = 0;
    const importBatch = async (pgn, label) => {
      const result = await importCollection(pgn, label);
      saved += result.saved || 0;
      skipped += result.skipped || 0;
      failures += (result.errors || []).length;
    };
    try {
      if (chesscom) {
        setStatus("#lab-import-status", "Sincronizzazione di tutte le mensilità pubbliche Chess.com…");
        const result = await syncChessComGames(chesscom,
          (pgn, meta) => importBatch(pgn, "da Chess.com " + (meta.label || "")),
          (progress) => {
            if (progress.phase === "archive") {
              setStatus("#lab-import-status", "Chess.com: archivio " + progress.current + " / " + progress.total + " (" + progress.label + ")…");
            }
          });
      }
      if (lichess) {
        setStatus("#lab-import-status", "Sincronizzazione dell'export completo Lichess…");
        const result = await syncLichessGames(lichess, token,
          (pgn, meta) => importBatch(pgn, "da Lichess"),
          (progress) => {
            setStatus("#lab-import-status", "Lichess: " + progress.count + " partite scaricate…");
          });
      }
      setStatus("#lab-import-status", "Sincronizzazione terminata: " + saved + " nuove partite aggiunte, " + skipped + " doppioni saltati, " + failures + " errori di importazione.");
    } catch (error) {
      setStatus("#lab-import-status", "Sincronizzazione parziale: " + error.message + " · Le partite già importate restano salvate.", true);
    } finally {
      $("#lab-sync-accounts").disabled = false;
      $("#lab-lichess-import-token").value = "";
    }
  }

  try {
    const profiles = JSON.parse(localStorage.getItem("chess-os.connected-accounts.v1") || "{}");
    $("#lab-chesscom-user").value = typeof profiles.chesscom === "string" ? profiles.chesscom : "";
    $("#lab-lichess-user").value = typeof profiles.lichess === "string" ? profiles.lichess : "";
  } catch {
    // Preferenze assenti o non leggibili: i campi restano modificabili.
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
  $("#lab-sync-accounts").addEventListener("click", () => { void syncAccounts(); });
  $("#lab-archive-analyze").disabled = !desktopApp;
  $("#lab-archive-analyze").addEventListener("click", () => { void analyzeArchive(); });
  $("#lab-archive-stop").addEventListener("click", () => { void stopArchiveAnalysis(); });

  return {
    onPositionChanged,
    canHumanMove() {
      return !playActive || getGame().turn() === playerColor;
    },
    stopPlay() {
      const wasBusy = playBusy;
      playActive = false;
      if (wasBusy) void invoke("stockfish_stop_analysis").catch(() => {});
      $("#lab-play-toggle").textContent = "Inizia partita";
      $("#lab-play-toggle").disabled = false;
      if (openingController) openingController.abort();
    },
  };
}
