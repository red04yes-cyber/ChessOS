import { Chess } from "chess.js";

function parseUciMove(uci) {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    ...(uci.length > 4 ? { promotion: uci[4] } : {}),
  };
}

export function parseStockfishAnalysis(lines, fen) {
  const info = lines
    .filter((line) => line.startsWith("info depth ") && !/\bmultipv [2-9]/.test(line))
    .at(-1) || "";
  const bestLine = lines.find((line) => line.startsWith("bestmove ")) || "";
  const bestmove = bestLine.split(/\s+/)[1] || null;
  const depth = Number(info.match(/\bdepth (\d+)/)?.[1] || 0);
  const cp = info.match(/\bscore cp (-?\d+)/);
  const mate = info.match(/\bscore mate (-?\d+)/);
  const pvUci = info.match(/\bpv (.+)$/)?.[1]?.trim().split(/\s+/) || [];
  const chess = new Chess(fen);
  const pvSan = [];
  for (const uci of pvUci) {
    try {
      const move = chess.move(parseUciMove(uci));
      if (!move) break;
      pvSan.push(move.san);
    } catch { break; }
  }
  return {
    bestmove,
    bestSan: bestmove && bestmove !== "(none)" ? (() => {
      const board = new Chess(fen);
      try { return board.move(parseUciMove(bestmove))?.san || bestmove; } catch { return bestmove; }
    })() : null,
    depth,
    scoreCp: cp ? Number(cp[1]) : null,
    mate: mate ? Number(mate[1]) : null,
    pvUci,
    pvSan,
    raw: info,
  };
}

export class StockfishEngine {
  constructor() {
    this.worker = null;
    this.readyPromise = null;
    this.pending = null;
    this.busy = false;
  }

  async ensureReady() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
      const path = new URL(`${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`, document.baseURI);
      this.worker = new Worker(path, { name: "ChessOS Stockfish 19 Lite" });
      this.worker.onmessage = (event) => {
        const line = String(event.data || "").trim();
        const pending = this.pending;
        if (!pending) return;
        pending.lines.push(line);
        if (pending.done(line)) {
          window.clearTimeout(pending.timer);
          this.pending = null;
          pending.resolve(pending.lines);
        }
      };
      this.worker.onerror = (error) => {
        if (this.pending) {
          window.clearTimeout(this.pending.timer);
          this.pending.reject(new Error(error.message || "Errore del worker Stockfish."));
          this.pending = null;
        }
      };
      await this.command(["uci"], (line) => line === "uciok", 30000);
      await this.command(["setoption name Threads value 1", "setoption name Hash value 64", "isready"], (line) => line === "readyok", 30000);
    })().catch((error) => {
      this.worker?.terminate();
      this.worker = null;
      this.readyPromise = null;
      throw error;
    });
    return this.readyPromise;
  }

  command(commands, done, timeout = 60000) {
    if (!this.worker) return Promise.reject(new Error("Motore non inizializzato."));
    if (this.pending) return Promise.reject(new Error("Il motore sta già elaborando una richiesta."));
    return new Promise((resolve, reject) => {
      const pending = { lines: [], done, resolve, reject, timer: null };
      pending.timer = window.setTimeout(() => {
        if (this.pending !== pending) return;
        this.pending = null;
        reject(new Error("Timeout del motore Stockfish."));
      }, timeout);
      this.pending = pending;
      for (const command of commands) this.worker.postMessage(command);
    });
  }

  async analyze(fen, depth = 14, multiPv = 1) {
    await this.ensureReady();
    if (this.busy) throw new Error("Il motore è già impegnato. Attendi la fine dell'analisi.");
    this.busy = true;
    try {
      const lines = await this.command([
        `setoption name MultiPV value ${Math.max(1, Math.min(5, multiPv))}`,
        "position fen " + fen,
        "go depth " + Math.max(1, Math.min(22, depth)),
      ], (line) => line.startsWith("bestmove "), 120000);
      return parseStockfishAnalysis(lines, fen);
    } finally {
      this.busy = false;
    }
  }

  async bestMove(fen, depth = 10, elo = null) {
    await this.ensureReady();
    if (this.busy) throw new Error("Il motore è già impegnato. Attendi la fine dell'analisi.");
    this.busy = true;
    try {
      const commands = [
        "setoption name UCI_LimitStrength value " + (elo ? "true" : "false"),
        ...(elo ? ["setoption name UCI_Elo value " + Math.max(1320, Math.min(3190, elo))] : []),
        "position fen " + fen,
        "go depth " + Math.max(1, Math.min(18, depth)),
      ];
      const lines = await this.command(commands, (line) => line.startsWith("bestmove "), 120000);
      return parseAnalysis(lines, fen);
    } finally {
      this.busy = false;
    }
  }

  terminate() {
    if (this.pending) {
      window.clearTimeout(this.pending.timer);
      this.pending.reject(new Error("Motore interrotto."));
      this.pending = null;
    }
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    this.busy = false;
  }
}

export const stockfish = new StockfishEngine();
