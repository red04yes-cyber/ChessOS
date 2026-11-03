function validateUsername(username) {
  const value = String(username || "").trim();
  if (!/^[a-zA-Z0-9_-]{2,30}$/.test(value)) throw new Error("Nome utente non valido.");
  return value;
}

async function fetchText(url, accept, token = "") {
  let response;
  try {
    const headers = { Accept: accept };
    if (token) headers.Authorization = "Bearer " + token;
    response = await fetch(url, { headers });
  } catch (error) {
    throw new Error("Connessione al servizio non riuscita: " + error.message + ". Puoi scaricare il PGN dal sito e importarlo da file.");
  }
  if (response.status === 429) throw new Error("Limite richieste raggiunto (HTTP 429). Attendi almeno un minuto prima di riprendere la sincronizzazione.");
  if (response.status === 401 || response.status === 403) throw new Error("Accesso negato dal servizio. Controlla username e token API, se richiesto.");
  if (!response.ok) throw new Error("Il servizio ha risposto HTTP " + response.status + ".");
  return response;
}

const EVENT_HEADER = /^\s*\[Event\s+"/i;
const MAX_GAME_BYTES = 10_000_000;
const BATCH_GAMES = 100;

async function streamPgnGames(response, onBatch, onProgress, label) {
  let batch = [];
  let current = "";
  let count = 0;

  const flush = async () => {
    const pgn = current.trim();
    if (!pgn) return;
    batch.push(pgn);
    current = "";
    count += 1;
    if (batch.length >= BATCH_GAMES) {
      await onBatch(batch.join("\n\n"), { count, label });
      batch = [];
    }
  };
  const line = async (value) => {
    if (EVENT_HEADER.test(value) && current.trim()) await flush();
    current += value + "\n";
    if (current.length > MAX_GAME_BYTES) {
      throw new Error("Una singola partita PGN supera il limite di 10 MB.");
    }
  };
  const reader = response.body?.getReader();
  if (!reader) {
    const source = await response.text();
    const lines = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
    for (const value of lines) await line(value);
  } else {
    const decoder = new TextDecoder();
    let remainder = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      remainder += decoder.decode(value, { stream: true });
      const lines = remainder.split("\n");
      remainder = lines.pop() || "";
      for (const valueLine of lines) await line(valueLine.replace(/\r$/, ""));
      if (onProgress) onProgress({ count, label });
    }
    remainder += decoder.decode();
    if (remainder) await line(remainder.replace(/\r$/, ""));
  }
  await flush();
  if (batch.length) await onBatch(batch.join("\n\n"), { count, label });
  return count;
}

export async function syncChessComGames(username, onBatch, onProgress = () => {}) {
  const player = validateUsername(username).toLowerCase();
  const url = "https://api.chess.com/pub/player/" + encodeURIComponent(player) + "/games/archives";
  const archivesResponse = await fetchText(url, "application/json");
  const archiveData = await archivesResponse.json();
  const archives = Array.isArray(archiveData.archives) ? archiveData.archives : [];
  if (!archives.length) throw new Error("Nessun archivio pubblico trovato per questo account Chess.com.");
  let total = 0;
  for (let index = 0; index < archives.length; index += 1) {
    const archive = String(archives[index]).replace(/\/+$/, "");
    onProgress({ phase: "archive", current: index + 1, total: archives.length, label: archive.split("/").slice(-2).join("/") });
    const response = await fetchText(archive + "/pgn", "application/x-chess-pgn,text/plain");
    total += await streamPgnGames(response, onBatch, onProgress, archive.split("/").slice(-2).join("/"));
  }
  return { games: total, archives: archives.length };
}

export async function syncLichessGames(username, token, onBatch, onProgress = () => {}) {
  const player = validateUsername(username);
  const params = new URLSearchParams({
    moves: "true",
    tags: "true",
    clocks: "false",
    evals: "false",
    opening: "true",
    sort: "dateAsc",
  });
  const url = "https://lichess.org/api/games/user/" + encodeURIComponent(player) + "?" + params.toString();
  const response = await fetchText(url, "application/x-chess-pgn", String(token || "").trim());
  const total = await streamPgnGames(response, onBatch, onProgress, "Lichess");
  if (!total) throw new Error("Nessuna partita esportabile trovata per questo account Lichess.");
  return { games: total };
}

// Compatibility helpers for callers that need a single PGN string instead of streaming batches.
export async function fetchChessComGames(username, months = 2) {
  const player = validateUsername(username).toLowerCase();
  const archivesResponse = await fetchText(
    "https://api.chess.com/pub/player/" + encodeURIComponent(player) + "/games/archives",
    "application/json",
  );
  const archiveData = await archivesResponse.json();
  const all = Array.isArray(archiveData.archives) ? archiveData.archives : [];
  const count = Math.max(1, Math.min(Number(months) || 2, all.length || 1));
  const selected = all.slice(-count);
  const parts = [];
  for (const archive of selected) {
    const response = await fetchText(String(archive).replace(/\/+$/, "") + "/pgn", "application/x-chess-pgn,text/plain");
    const pgn = await response.text();
    if (pgn.trim()) parts.push(pgn);
  }
  if (!parts.length) throw new Error("Gli archivi selezionati non contengono partite PGN.");
  return parts.join("\n\n");
}

export async function fetchLichessGames(username, maxGames = 50, token = "") {
  const player = validateUsername(username);
  const params = new URLSearchParams({
    max: String(Math.max(1, Math.min(maxGames, 100))),
    clocks: "false",
    evals: "false",
    opening: "true",
  });
  const url = "https://lichess.org/api/games/user/" + encodeURIComponent(player) + "?" + params.toString();
  const response = await fetchText(url, "application/x-chess-pgn", token);
  const pgn = await response.text();
  if (!pgn.trim()) throw new Error("Nessuna partita pubblica esportabile trovata per questo account Lichess.");
  return pgn;
}
