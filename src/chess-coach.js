import { Chess } from "chess.js";
import { uciPvToSan } from "./engine-uci.js";

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

export function scoreToWhiteCentipawns(info, sideToMove = "w") {
  if (!info || !["w", "b"].includes(sideToMove) || !Number.isFinite(info.score)) return null;
  const value = sideToMove === "w" ? info.score : -info.score;
  if (info.scoreType === "mate") {
    if (value === 0) return 0;
    return Math.sign(value) * (100_000 - Math.min(Math.abs(value), 999) * 100);
  }
  return value;
}

export function classifyMoveLoss(lossCp) {
  if (!Number.isFinite(lossCp)) return "non valutabile";
  if (lossCp < 60) return "buona";
  if (lossCp < 120) return "imprecisione";
  if (lossCp < 250) return "errore";
  return "svista";
}

export function explainMove(fen, playedUci, bestInfo, lossCp) {
  const chess = new Chess(fen);
  const from = playedUci.slice(0, 2);
  const to = playedUci.slice(2, 4);
  let played;
  try {
    played = chess.move({
      from,
      to,
      ...(playedUci.length > 4 ? { promotion: playedUci[4] } : {}),
    });
  } catch {
    played = null;
  }
  if (!played) return "La mossa non è legale nella posizione analizzata.";

  const bestUci = bestInfo?.pv?.[0] || "";
  const bestSan = bestInfo?.pv?.length ? uciPvToSan(fen, bestInfo.pv).split(" ")[0] : "";
  const exposedSquare = played.to;
  const vulnerableCaptures = chess.moves({ verbose: true }).filter((move) =>
    move.to === exposedSquare && move.captured
  );
  if (vulnerableCaptures.length) {
    const cheapestAttacker = Math.min(...vulnerableCaptures.map((move) => PIECE_VALUE[move.piece] || 99));
    const victimValue = PIECE_VALUE[played.piece] || 0;
    if (victimValue >= cheapestAttacker) {
      return "La mossa lascia il " + ({ p: "pedone", n: "cavallo", b: "alfiere", r: "torre", q: "donna", k: "re" }[played.piece] || "pezzo")
        + " esposto in " + exposedSquare + ". Il principio violato è la sicurezza dei pezzi: prima di muovere controlla quali catture può effettuare l'avversario.";
    }
  }

  if (played.captured && bestUci && bestUci !== playedUci) {
    const bestPosition = new Chess(fen);
    const alternatives = bestPosition.moves({ verbose: true });
    const betterCapture = alternatives.find((move) =>
      move.from + move.to + (move.promotion || "") === bestUci && move.captured
    );
    if (betterCapture && (PIECE_VALUE[betterCapture.captured] || 0) > (PIECE_VALUE[played.captured] || 0)) {
      return "La cattura scelta vince meno materiale della continuazione " + bestSan
        + ". Il principio è confrontare gli scambi e calcolare le risposte forzanti prima di catturare.";
    }
  }

  if (chess.isCheck()) {
    return "La mossa dà scacco, ma la valutazione peggiora: lo scacco non è automaticamente utile se concede tempi o materiale. "
      + (bestSan ? "La continuazione più precisa iniziava con " + bestSan + "." : "");
  }

  const pawns = (Math.max(0, lossCp) / 100).toFixed(2);
  return "Non emerge una singola causa tattica evidente. Stockfish stima un peggioramento di circa " + pawns
    + " pedoni rispetto alla migliore continuazione" + (bestSan ? " (" + bestSan + ")" : "")
    + ". Ricontrolla minacce, catture, attività dei pezzi e sicurezza del re.";
}
