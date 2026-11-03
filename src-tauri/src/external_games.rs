use reqwest::{Client, StatusCode};
use serde::Serialize;
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

use crate::db::Database;

const BATCH_SIZE: usize = 50;
const MAX_GAME_PGN_BYTES: usize = 5 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: usize = 128 * 1024 * 1024;
const USER_AGENT: &str = "ChessOS/0.1 (https://github.com/red04yes-cyber/ChessOS)";

#[derive(Debug, Clone)]
struct ImportedGame {
    id: String,
    provider: String,
    source_username: String,
    source_game_id: String,
    pgn: String,
    white: String,
    black: String,
    played_at: String,
    result: String,
    time_control: String,
    opening: String,
    source_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedGameSummary {
    pub id: String,
    pub provider: String,
    pub source_username: String,
    pub source_game_id: String,
    pub white: String,
    pub black: String,
    pub played_at: String,
    pub result: String,
    pub time_control: String,
    pub opening: String,
    pub source_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedGameRecord {
    #[serde(flatten)]
    pub summary: ImportedGameSummary,
    pub pgn: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub provider: String,
    pub username: String,
    pub processed: usize,
    pub imported: usize,
    pub duplicates: usize,
    pub skipped: usize,
    pub phase: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub provider: String,
    pub username: String,
    pub processed: usize,
    pub imported: usize,
    pub duplicates: usize,
    pub skipped: usize,
    pub archives: usize,
}

#[derive(Default)]
struct Counters {
    processed: usize,
    imported: usize,
    duplicates: usize,
    skipped: usize,
}

fn emit_progress(app: &AppHandle, provider: &str, username: &str, counts: &Counters, phase: &str) {
    let _ = app.emit(
        "online-game-import-progress",
        ImportProgress {
            provider: provider.to_string(),
            username: username.to_string(),
            processed: counts.processed,
            imported: counts.imported,
            duplicates: counts.duplicates,
            skipped: counts.skipped,
            phase: phase.to_string(),
        },
    );
}

fn persist_batch(database: &Database, batch: &mut Vec<ImportedGame>, counts: &mut Counters) -> Result<(), String> {
    if batch.is_empty() {
        return Ok(());
    }

    let mut connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    {
        let mut statement = transaction.prepare(
            "INSERT INTO imported_games
                (id, provider, source_username, source_game_id, pgn, white, black,
                 played_at, result, time_control, opening, source_url, imported_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(provider, source_game_id) DO NOTHING"
        ).map_err(|error| error.to_string())?;

        for game in batch.drain(..) {
            let inserted = statement.execute(rusqlite::params![
                game.id,
                game.provider,
                game.source_username,
                game.source_game_id,
                game.pgn,
                game.white,
                game.black,
                game.played_at,
                game.result,
                game.time_control,
                game.opening,
                game.source_url,
                now_timestamp()
            ]).map_err(|error| error.to_string())?;
            if inserted == 1 {
                counts.imported += 1;
            } else {
                counts.duplicates += 1;
            }
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

fn now_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn parse_headers(pgn: &str) -> std::collections::HashMap<String, String> {
    let mut headers = std::collections::HashMap::new();
    for line in pgn.lines() {
        let line = line.trim();
        if !line.starts_with('[') || !line.ends_with(']') {
            continue;
        }
        let inner = &line[1..line.len() - 1];
        let Some(space) = inner.find(char::is_whitespace) else {
            continue;
        };
        let key = inner[..space].trim();
        let raw = inner[space..].trim();
        if key.is_empty() || raw.len() < 2 || !raw.starts_with('"') || !raw.ends_with('"') {
            continue;
        }
        let value = raw[1..raw.len() - 1]
            .replace("\\\"", "\"")
            .replace("\\\\", "\\");
        headers.insert(key.to_string(), value);
    }
    headers
}

fn game_id(provider: &str, pgn: &str, site: &str, headers: &std::collections::HashMap<String, String>) -> String {
    let path_id = site
        .split('?').next().unwrap_or(site)
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("")
        .trim();

    if !path_id.is_empty() && path_id != "game" && path_id != "live" && path_id != "daily" {
        return path_id.to_string();
    }

    let mut hasher = DefaultHasher::new();
    provider.hash(&mut hasher);
    headers.get("Date").hash(&mut hasher);
    headers.get("White").hash(&mut hasher);
    headers.get("Black").hash(&mut hasher);
    pgn.hash(&mut hasher);
    format!("pgn-{:016x}", hasher.finish())
}

fn parse_game(provider: &str, username: &str, pgn: String) -> Option<ImportedGame> {
    let pgn = pgn.trim().to_string();
    if pgn.is_empty() || pgn.len() > MAX_GAME_PGN_BYTES {
        return None;
    }
    let headers = parse_headers(&pgn);
    let variant = headers.get("Variant").map(|value| value.to_ascii_lowercase()).unwrap_or_default();
    if !variant.is_empty() && variant != "standard" && variant != "chess" {
        return None;
    }
    let mut saw_movetext_separator = false;
    let has_movetext = pgn.lines().any(|line| {
        let line = line.trim();
        if !saw_movetext_separator {
            if line.is_empty() {
                saw_movetext_separator = true;
            }
            false
        } else {
            !line.is_empty() && !line.starts_with('%')
        }
    });
    if !has_movetext {
        return None;
    }

    let source_url = headers.get("Site")
        .or_else(|| headers.get("Link"))
        .cloned()
        .unwrap_or_default();
    let source_game_id = game_id(provider, &pgn, &source_url, &headers);
    Some(ImportedGame {
        id: format!("{}:{}", provider, source_game_id),
        provider: provider.to_string(),
        source_username: username.to_string(),
        source_game_id,
        pgn,
        white: headers.get("White").cloned().unwrap_or_else(|| "Bianco".into()),
        black: headers.get("Black").cloned().unwrap_or_else(|| "Nero".into()),
        played_at: headers.get("Date").cloned().unwrap_or_default(),
        result: headers.get("Result").cloned().unwrap_or_else(|| "*".into()),
        time_control: headers.get("TimeControl").cloned().unwrap_or_default(),
        opening: headers.get("Opening").cloned().unwrap_or_default(),
        source_url,
    })
}

fn event_offsets(bytes: &[u8]) -> Vec<usize> {
    let marker = b"[Event ";
    if bytes.len() < marker.len() {
        return Vec::new();
    }
    (0..=bytes.len() - marker.len())
        .filter(|index| {
            bytes[*index..].starts_with(marker)
                && (*index == 0 || bytes[*index - 1] == b'\n')
        })
        .collect()
}

fn take_complete_games(buffer: &mut Vec<u8>, final_chunk: bool) -> Vec<String> {
    let starts = event_offsets(buffer);
    let mut games = Vec::new();

    if starts.len() >= 2 {
        for pair in starts.windows(2) {
            if let Ok(game) = String::from_utf8(buffer[pair[0]..pair[1]].to_vec()) {
                if !game.trim().is_empty() {
                    games.push(game);
                }
            }
        }
        *buffer = buffer[*starts.last().unwrap()..].to_vec();
    }

    if final_chunk && !buffer.is_empty() {
        let start = event_offsets(buffer).first().copied().unwrap_or(0);
        if let Ok(game) = String::from_utf8(buffer[start..].to_vec()) {
            if !game.trim().is_empty() {
                games.push(game);
            }
        }
        buffer.clear();
    }

    games
}

fn process_games(
    database: &Database,
    app: &AppHandle,
    provider: &str,
    username: &str,
    games: Vec<String>,
    batch: &mut Vec<ImportedGame>,
    counts: &mut Counters,
) -> Result<(), String> {
    for pgn in games {
        counts.processed += 1;
        match parse_game(provider, username, pgn) {
            Some(game) => batch.push(game),
            None => counts.skipped += 1,
        }
        if batch.len() >= BATCH_SIZE {
            persist_batch(database, batch, counts)?;
            emit_progress(app, provider, username, counts, "download");
        }
    }
    Ok(())
}

fn parse_chess_com_archive_url(url: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = url.trim_end_matches('/').split('/').collect();
    let month = *parts.last()?;
    let year = *parts.get(parts.len().checked_sub(2)?)?;
    if year.len() != 4 || !year.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    if month.len() != 2 || !month.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    let month_number: u8 = month.parse().ok()?;
    if !(1..=12).contains(&month_number) {
        return None;
    }
    Some((year.to_string(), month.to_string()))
}

fn check_http_status(status: StatusCode, provider: &str) -> Result<(), String> {
    if status.is_success() {
        return Ok(());
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        return Err("Il servizio ha applicato un limite alle richieste (HTTP 429). Attendi almeno 60 secondi prima di riprovare.".into());
    }
    if status == StatusCode::NOT_FOUND {
        return Err("Account o archivio non trovato. Controlla lo username.".into());
    }
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return if provider == "lichess" {
            Err("Lichess ha rifiutato il token. Verifica che sia un token API personale valido.".into())
        } else {
            Err("Il servizio non ha autorizzato la richiesta.".into())
        };
    }
    Err(format!("Il servizio {} ha risposto con HTTP {}.", provider, status.as_u16()))
}

fn validate_username(username: &str) -> Result<String, String> {
    let value = username.trim();
    if value.is_empty() || value.len() > 50 || !value.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-') {
        return Err("Username non valido: usa solo lettere, numeri, trattino o underscore.".into());
    }
    Ok(value.to_string())
}

#[tauri::command]
pub async fn import_online_games(
    database: State<'_, Database>,
    app: AppHandle,
    provider: String,
    username: String,
    token: Option<String>,
) -> Result<ImportSummary, String> {
    let username = validate_username(&username)?;
    if provider != "chess_com" && provider != "lichess" {
        return Err("Provider non supportato.".into());
    }
    let token = token.unwrap_or_default().trim().to_string();
    if provider == "lichess" && (token.is_empty() || token.len() > 2048) {
        return Err("Per Lichess inserisci un token API personale valido. Il token non viene salvato.".into());
    }

    let client = Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(30 * 60))
        .build()
        .map_err(|error| format!("Impossibile inizializzare il client HTTP: {}", error))?;

    let mut counts = Counters::default();
    let mut batch = Vec::with_capacity(BATCH_SIZE);
    let mut archives = 0usize;
    emit_progress(&app, &provider, &username, &counts, "start");

    if provider == "chess_com" {
        let archives_url = format!("https://api.chess.com/pub/player/{}/games/archives", username);
        let response = client.get(&archives_url).send().await
            .map_err(|error| format!("Connessione a Chess.com non riuscita: {}", error))?;
        check_http_status(response.status(), "chess.com")?;
        let payload: Value = response.json().await
            .map_err(|error| format!("Risposta degli archivi Chess.com non valida: {}", error))?;
        let archive_urls = payload.get("archives").and_then(Value::as_array)
            .ok_or_else(|| "Chess.com non ha restituito l'elenco degli archivi.".to_string())?;
        archives = archive_urls.len();

        for archive in archive_urls {
            let Some(archive_url) = archive.as_str() else {
                counts.skipped += 1;
                continue;
            };
            let Some((year, month)) = parse_chess_com_archive_url(archive_url) else {
                counts.skipped += 1;
                continue;
            };
            let pgn_url = format!(
                "https://api.chess.com/pub/player/{}/games/{}/{}/pgn",
                username, year, month
            );
            let response = client.get(&pgn_url)
                .header("Accept", "application/x-chess-pgn")
                .send().await
                .map_err(|error| format!("Download interrotto dopo {} partite elaborate: {}", counts.processed, error))?;
            check_http_status(response.status(), "chess.com")?;

            // Stream each monthly archive instead of buffering the full PGN in
            // memory. Completed games are validated/persisted as soon as the
            // next Event header arrives.
            let mut response = response;
            let mut buffer: Vec<u8> = Vec::new();
            let mut archive_bytes = 0usize;
            loop {
                let chunk = match response.chunk().await {
                    Ok(Some(chunk)) => chunk,
                    Ok(None) => break,
                    Err(error) => {
                        let complete = take_complete_games(&mut buffer, false);
                        process_games(database.inner(), &app, &provider, &username, complete, &mut batch, &mut counts)?;
                        let _ = persist_batch(database.inner(), &mut batch, &mut counts);
                        emit_progress(&app, &provider, &username, &counts, "interrupted");
                        return Err(format!(
                            "Download dell'archivio {}/{} interrotto dopo {} partite elaborate: {}. Le partite già salvate restano disponibili.",
                            year, month, counts.processed, error
                        ));
                    }
                };

                archive_bytes = archive_bytes.saturating_add(chunk.len());
                if archive_bytes > MAX_ARCHIVE_BYTES {
                    let complete = take_complete_games(&mut buffer, false);
                    process_games(database.inner(), &app, &provider, &username, complete, &mut batch, &mut counts)?;
                    let _ = persist_batch(database.inner(), &mut batch, &mut counts);
                    emit_progress(&app, &provider, &username, &counts, "interrupted");
                    return Err(format!(
                        "L'archivio {}/{} supera il limite di sicurezza di 128 MiB. Le partite già elaborate sono state salvate.",
                        year, month
                    ));
                }

                buffer.extend_from_slice(&chunk);
                let complete = take_complete_games(&mut buffer, false);
                process_games(database.inner(), &app, &provider, &username, complete, &mut batch, &mut counts)?;
                if counts.processed > 0 && counts.processed % 100 == 0 {
                    emit_progress(&app, &provider, &username, &counts, "download");
                }
            }

            let remaining = take_complete_games(&mut buffer, true);
            process_games(database.inner(), &app, &provider, &username, remaining, &mut batch, &mut counts)?;
            persist_batch(database.inner(), &mut batch, &mut counts)?;
            emit_progress(&app, &provider, &username, &counts, "download");
        }
    } else {
        let url = format!(
            "https://lichess.org/api/games/user/{}?finished=true&sort=dateAsc&opening=true",
            username
        );
        let response = client.get(&url)
            .bearer_auth(&token)
            .header("Accept", "application/x-chess-pgn")
            .send().await
            .map_err(|error| format!("Connessione a Lichess non riuscita: {}", error))?;
        check_http_status(response.status(), "lichess")?;

        let mut response = response;
        let mut buffer: Vec<u8> = Vec::new();
        loop {
            let chunk = match response.chunk().await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                Err(error) => {
                    let _ = persist_batch(database.inner(), &mut batch, &mut counts);
                    emit_progress(&app, &provider, &username, &counts, "interrupted");
                    return Err(format!(
                        "Flusso Lichess interrotto dopo {} partite elaborate: {}",
                        counts.processed, error
                    ));
                }
            };
            buffer.extend_from_slice(&chunk);
            let games = take_complete_games(&mut buffer, false);
            process_games(database.inner(), &app, &provider, &username, games, &mut batch, &mut counts)?;
            if counts.processed % 100 == 0 && counts.processed > 0 {
                emit_progress(&app, &provider, &username, &counts, "download");
            }
        }
        let games = take_complete_games(&mut buffer, true);
        process_games(database.inner(), &app, &provider, &username, games, &mut batch, &mut counts)?;
    }

    persist_batch(database.inner(), &mut batch, &mut counts)?;
    emit_progress(&app, &provider, &username, &counts, "complete");

    Ok(ImportSummary {
        provider,
        username,
        processed: counts.processed,
        imported: counts.imported,
        duplicates: counts.duplicates,
        skipped: counts.skipped,
        archives,
    })
}

#[tauri::command]
pub fn list_imported_games(
    database: State<'_, Database>,
    limit: Option<i64>,
) -> Result<Vec<ImportedGameSummary>, String> {
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    let limit = limit.unwrap_or(20).clamp(1, 100);
    let mut statement = connection.prepare(
        "SELECT id, provider, source_username, source_game_id, white, black, played_at,
                result, time_control, opening, source_url
         FROM imported_games
         ORDER BY played_at DESC, imported_at DESC
         LIMIT ?1"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map([limit], |row| {
        Ok(ImportedGameSummary {
            id: row.get(0)?,
            provider: row.get(1)?,
            source_username: row.get(2)?,
            source_game_id: row.get(3)?,
            white: row.get(4)?,
            black: row.get(5)?,
            played_at: row.get(6)?,
            result: row.get(7)?,
            time_control: row.get(8)?,
            opening: row.get(9)?,
            source_url: row.get(10)?,
        })
    }).map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_imported_game(
    database: State<'_, Database>,
    id: String,
) -> Result<ImportedGameRecord, String> {
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    connection.query_row(
        "SELECT id, provider, source_username, source_game_id, white, black, played_at,
                result, time_control, opening, source_url, pgn
         FROM imported_games WHERE id = ?1",
        [id],
        |row| Ok(ImportedGameRecord {
            summary: ImportedGameSummary {
                id: row.get(0)?,
                provider: row.get(1)?,
                source_username: row.get(2)?,
                source_game_id: row.get(3)?,
                white: row.get(4)?,
                black: row.get(5)?,
                played_at: row.get(6)?,
                result: row.get(7)?,
                time_control: row.get(8)?,
                opening: row.get(9)?,
                source_url: row.get(10)?,
            },
            pgn: row.get(11)?,
        })
    ).map_err(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => "Partita importata non trovata.".to_string(),
        other => other.to_string(),
    })
}

#[tauri::command]
pub fn delete_imported_game(database: State<'_, Database>, id: String) -> Result<bool, String> {
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    let deleted = connection.execute("DELETE FROM imported_games WHERE id = ?1", [id])
        .map_err(|error| error.to_string())?;
    Ok(deleted > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PGN_ONE: &str = "[Event \"Rated Blitz game\"]\n[Site \"https://lichess.org/abc123\"]\n[Date \"2026.10.01\"]\n[White \"Alpha\"]\n[Black \"Beta\"]\n[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 Nc6 1-0";
    const PGN_TWO: &str = "[Event \"Live Chess\"]\n[Site \"https://www.chess.com/game/live/987654\"]\n[Date \"2026.10.02\"]\n[White \"Gamma\"]\n[Black \"Delta\"]\n[Result \"0-1\"]\n\n1. d4 d5 2. c4 e6 0-1";

    #[test]
    fn separates_concatenated_pgn_games_even_when_split_across_chunks() {
        let combined = format!("{}\n\n{}", PGN_ONE, PGN_TWO);
        let mut buffer = combined.as_bytes()[..combined.len() / 2].to_vec();
        let mut games = take_complete_games(&mut buffer, false);
        buffer.extend_from_slice(&combined.as_bytes()[combined.len() / 2..]);
        games.extend(take_complete_games(&mut buffer, true));
        assert_eq!(games.len(), 2);
        assert!(games[0].contains("abc123"));
        assert!(games[1].contains("987654"));
    }

    #[test]
    fn extracts_provider_game_ids_and_headers() {
        let lichess = parse_game("lichess", "player", PGN_ONE.to_string()).unwrap();
        let chess_com = parse_game("chess_com", "player", PGN_TWO.to_string()).unwrap();
        assert_eq!(lichess.source_game_id, "abc123");
        assert_eq!(chess_com.source_game_id, "987654");
        assert_eq!(lichess.white, "Alpha");
        assert_eq!(chess_com.result, "0-1");
    }

    #[test]
    fn skips_non_standard_variants_and_malformed_games() {
        let variant = PGN_ONE.replace("[Event", "[Variant \"Chess960\"]\n[Event");
        assert!(parse_game("lichess", "player", variant).is_none());
        assert!(parse_game("lichess", "player", "not a PGN".into()).is_none());
    }

    #[test]
    fn imported_games_are_persisted_and_deduplicated() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&mut connection).unwrap();
        let database = Database(std::sync::Mutex::new(connection));
        let game = parse_game("lichess", "player", PGN_ONE.to_string()).unwrap();
        let mut batch = vec![game.clone()];
        let mut counts = Counters::default();
        persist_batch(&database, &mut batch, &mut counts).unwrap();
        assert_eq!(counts.imported, 1);
        assert_eq!(counts.duplicates, 0);

        let mut batch = vec![game];
        persist_batch(&database, &mut batch, &mut counts).unwrap();
        assert_eq!(counts.imported, 1);
        assert_eq!(counts.duplicates, 1);

        let connection = database.0.lock().unwrap();
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM imported_games", [], |row| row.get(0)
        ).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn parses_chess_com_archive_urls_without_trusting_the_host_or_path_suffix() {
        assert_eq!(
            parse_chess_com_archive_url("https://api.chess.com/pub/player/player1/games/2026/11"),
            Some(("2026".to_string(), "11".to_string()))
        );
        assert_eq!(
            parse_chess_com_archive_url("https://api.chess.com/pub/player/player1/games/2026/02/"),
            Some(("2026".to_string(), "02".to_string()))
        );
        assert_eq!(parse_chess_com_archive_url("https://api.chess.com/pub/player/player1/games/2026/13"), None);
        assert_eq!(parse_chess_com_archive_url("https://api.chess.com/pub/player/player1/games/26/01"), None);
        assert_eq!(parse_chess_com_archive_url("not-an-archive-url"), None);
    }

    #[test]
    fn reports_chess_com_rate_limit_errors_with_a_retry_hint() {
        let error = check_http_status(StatusCode::TOO_MANY_REQUESTS, "chess.com").unwrap_err();
        assert!(error.contains("HTTP 429"));
        assert!(error.contains("60 secondi"));
    }

    #[test]
    fn validates_usernames_before_building_provider_urls() {
        assert!(validate_username("valid_user-1").is_ok());
        assert!(validate_username("../other").is_err());
        assert!(validate_username("a name").is_err());
    }
}
