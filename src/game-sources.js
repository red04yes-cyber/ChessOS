function validateUsername(username) {
  const value = String(username || "").trim();
  if (!/^[a-zA-Z0-9_-]{2,30}$/.test(value)) throw new Error("Nome utente non valido.");
  return value;
}

async function fetchText(url, accept) {
  let response;
  try {
    response = await fetch(url, { headers: { Accept: accept } });
  } catch (error) {
    throw new Error("Connessione al servizio non riuscita: " + error.message + ". Puoi scaricare il PGN dal sito e importarlo da file.");
  }
  if (response.status === 429) throw new Error("Limite richieste raggiunto (HTTP 429). Attendi almeno un minuto.");
  if (!response.ok) throw new Error("Il servizio ha risposto HTTP " + response.status + ".");
  return response;
}

export async function fetchChessComGames(username, months = 2) {
  const player = validateUsername(username).toLowerCase();
  const url = "https://api.chess.com/pub/player/" + encodeURIComponent(player) + "/games/archives";
  const archivesResponse = await fetchText(url, "application/json");
  const archiveData = await archivesResponse.json();
  const archives = Array.isArray(archiveData.archives)
    ? archiveData.archives.slice(-Math.max(1, Math.min(months, 6)))
    : [];
  if (!archives.length) throw new Error("Nessun archivio pubblico trovato per questo account Chess.com.");
  const pgnParts = [];
  for (const archive of archives) {
    const response = await fetchText(String(archive).replace(/\/+$/, "") + "/pgn", "application/x-chess-pgn,text/plain");
    const pgn = await response.text();
    if (pgn.trim()) pgnParts.push(pgn);
  }
  if (!pgnParts.length) throw new Error("Gli archivi selezionati non contengono partite PGN.");
  return pgnParts.join("\n\n");
}

export async function fetchLichessGames(username, maxGames = 50) {
  const player = validateUsername(username);
  const params = new URLSearchParams({
    max: String(Math.max(1, Math.min(maxGames, 100))),
    clocks: "false",
    evals: "false",
    opening: "true",
  });
  const url = "https://lichess.org/api/games/user/" + encodeURIComponent(player) + "?" + params.toString();
  const response = await fetchText(url, "application/x-chess-pgn");
  const pgn = await response.text();
  if (!pgn.trim()) throw new Error("Nessuna partita pubblica esportabile trovata per questo account Lichess.");
  return pgn;
}
