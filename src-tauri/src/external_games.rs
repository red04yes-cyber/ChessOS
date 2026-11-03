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
pub struct ImportedGamePage {
    pub games: Vec<ImportedGameSummary>,
    pub total: i64,
    pub offset: i64,
    pub limit: i64,
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
pub struct OpponentGameRecord {
    #[serde(flatten)]
    pub summary: ImportedGameSummary,
    pub white_elo: Option<String>,
    pub black_elo: Option<String>,
    pub eco: Option<String>,
    pub white_first_move: Option<String>,
    pub black_first_move: Option<String>,
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
            let source_provider = game.provider.clone();
            let source_username = game.source_username.clone();
            let source_game_id = game.source_game_id.clone();
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
            transaction.execute(
                "INSERT OR IGNORE INTO imported_game_sources(provider, source_username, source_game_id)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![source_provider, source_username, source_game_id],
            ).map_err(|error| error.to_string())?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

fn archive_was_imported(database: &Database, username: &str, archive_key: &str) -> Result<bool, String> {
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM imported_game_archives
         WHERE provider = 'chess_com' AND source_username = ?1 COLLATE NOCASE AND archive_key = ?2)",
        rusqlite::params![username, archive_key],
        |row| row.get(0),
    ).map_err(|error| error.to_string())
}

fn mark_archive_imported(database: &Database, username: &str, archive_key: &str) -> Result<(), String> {
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    connection.execute(
        "INSERT INTO imported_game_archives(provider, source_username, archive_key, imported_at)
         VALUES ('chess_com', ?1, ?2, ?3)
         ON CONFLICT(provider, source_username, archive_key) DO UPDATE SET imported_at = excluded.imported_at",
        rusqlite::params![username, archive_key, now_timestamp()],
    ).map_err(|error| error.to_string())?;
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

fn first_two_san_moves(pgn: &str) -> (Option<String>, Option<String>) {
    let body = pgn.find("\r\n\r\n").map(|index| &pgn[index + 4..])
        .or_else(|| pgn.find("\n\n").map(|index| &pgn[index + 2..]))
        .unwrap_or("");
    let mut clean = String::with_capacity(body.len());
    let (mut comment_depth, mut variation_depth, mut line_comment) = (0usize, 0usize, false);
    for ch in body.chars() {
        if line_comment { if ch == '\n' { line_comment = false; clean.push(' '); } continue; }
        if comment_depth > 0 { if ch == '{' { comment_depth += 1; } else if ch == '}' { comment_depth -= 1; } continue; }
        if ch == ';' { line_comment = true; continue; }
        if ch == '{' { comment_depth = 1; continue; }
        if ch == '(' { variation_depth += 1; continue; }
        if ch == ')' { variation_depth = variation_depth.saturating_sub(1); continue; }
        if variation_depth == 0 { clean.push(ch); }
    }
    let mut moves = Vec::with_capacity(2);
    for raw in clean.split_whitespace() {
        if matches!(raw, "1-0" | "0-1" | "1/2-1/2" | "*") { break; }
        let token = raw.rsplit_once('.').map(|(_, san)| san).unwrap_or(raw);
        let san = token.trim_matches(|ch: char| matches!(ch, '!' | '?' | '+' | '#' | '\r' | '\n'));
        if san.is_empty() || san.starts_with('$') || san == ")" { continue; }
        moves.push(san.to_string());
        if moves.len() == 2 { break; }
    }
    (moves.first().cloned(), moves.get(1).cloned())
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
    let parsed = reqwest::Url::parse(url).ok()?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("api.chess.com")
        || parsed.port().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return None;
    }

    let path = parsed.path().trim_end_matches('/');
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() != 7
        || parts[0] != ""
        || parts[1] != "pub"
        || parts[2] != "player"
        || parts[3].is_empty()
        || parts[4] != "games"
        || !parts[3].chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return None;
    }

    let year = parts[5];
    let month = parts[6];
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

fn bounded_archive_size(current: usize, chunk_len: usize) -> Option<usize> {
    let next = current.checked_add(chunk_len)?;
    (next <= MAX_ARCHIVE_BYTES).then_some(next)
}

fn pending_game_exceeds_limit(buffer: &[u8]) -> bool {
    buffer.len() > MAX_GAME_PGN_BYTES
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
            Err("Account Lichess privato oppure token rifiutato. Verifica lo username o usa un token personale di sola lettura.".into())
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
    if provider == "lichess" && token.len() > 2048 {
        return Err("Il token Lichess supera la lunghezza consentita.".into());
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

        // Chess.com lists archives from oldest to newest. Check the newest one
        // on every import so games from the current month are refreshed, and
        // skip completed older archives to make interrupted/recurring imports fast.
        let newest_first: Vec<&Value> = archive_urls.iter().rev().collect();
        for (archive_index, archive) in newest_first.iter().enumerate() {
            let Some(archive_url) = archive.as_str() else {
                counts.skipped += 1;
                continue;
            };
            let Some((year, month)) = parse_chess_com_archive_url(archive_url) else {
                counts.skipped += 1;
                continue;
            };
            let archive_key = format!("{}/{}", year, month);
            if archive_index > 0 && archive_was_imported(database.inner(), &username, &archive_key)? {
                emit_progress(&app, &provider, &username, &counts, "archive_cached");
                continue;
            }
            let pgn_url = format!(
                "https://api.chess.com/pub/player/{}/games/{}/{}/pgn",
                username, year, month
            );
            let response = client.get(&pgn_url)
                .header("Accept", "application/x-chess-pgn")
                .send().await
                .map_err(|error| format!("Download interrotto dopo {} partite elaborate: {}", counts.processed, error))?;
            check_http_status(response.status(), "chess.com")?;

            // Stream each monthly archive instead of buffering the complete PGN
            // response. Persist complete games in bounded batches as chunks arrive.
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

                archive_bytes = match bounded_archive_size(archive_bytes, chunk.len()) {
                    Some(size) => size,
                    None => {
                        let complete = take_complete_games(&mut buffer, false);
                        process_games(database.inner(), &app, &provider, &username, complete, &mut batch, &mut counts)?;
                        let _ = persist_batch(database.inner(), &mut batch, &mut counts);
                        emit_progress(&app, &provider, &username, &counts, "interrupted");
                        return Err(format!(
                            "L'archivio {}/{} supera il limite di sicurezza di 128 MiB. Le partite già elaborate sono state salvate.",
                            year, month
                        ));
                    }
                };

                buffer.extend_from_slice(&chunk);
                let complete = take_complete_games(&mut buffer, false);
                process_games(database.inner(), &app, &provider, &username, complete, &mut batch, &mut counts)?;
                if pending_game_exceeds_limit(&buffer) {
                    let _ = persist_batch(database.inner(), &mut batch, &mut counts);
                    emit_progress(&app, &provider, &username, &counts, "interrupted");
                    return Err(format!(
                        "Una partita PGN dell'archivio {}/{} supera il limite di 5 MiB. Le partite già elaborate sono state salvate.",
                        year, month
                    ));
                }
                if counts.processed > 0 && counts.processed % 100 == 0 {
                    emit_progress(&app, &provider, &username, &counts, "download");
                }
            }

            let remaining = take_complete_games(&mut buffer, true);
            process_games(database.inner(), &app, &provider, &username, remaining, &mut batch, &mut counts)?;
            persist_batch(database.inner(), &mut batch, &mut counts)?;
            mark_archive_imported(database.inner(), &username, &archive_key)?;
            emit_progress(&app, &provider, &username, &counts, "download");
        }
    } else {
        let url = format!(
            "https://lichess.org/api/games/user/{}?finished=true&sort=dateAsc&opening=true",
            username
        );
        let mut request = client.get(&url).header("Accept", "application/x-chess-pgn");
        if !token.is_empty() {
            request = request.bearer_auth(&token);
        }
        let response = request.send().await
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
            if pending_game_exceeds_limit(&buffer) {
                let _ = persist_batch(database.inner(), &mut batch, &mut counts);
                emit_progress(&app, &provider, &username, &counts, "interrupted");
                return Err(
                    "Una partita PGN Lichess supera il limite di 5 MiB. Le partite già elaborate sono state salvate.".into()
                );
            }
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
        "SELECT imported_games.id, imported_games.provider, imported_games.source_username,
                imported_games.source_game_id, imported_games.white, imported_games.black,
                imported_games.played_at, imported_games.result, imported_games.time_control,
                imported_games.opening, imported_games.source_url
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
pub fn search_imported_games(
    database: State<'_, Database>,
    query: Option<String>,
    provider: Option<String>,
    username: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<ImportedGamePage, String> {
    let query = query.unwrap_or_default().trim().to_string();
    let provider = provider.unwrap_or_default();
    if !provider.is_empty() && provider != "chess_com" && provider != "lichess" {
        return Err("Piattaforma non valida.".into());
    }
    let username = username.unwrap_or_default().trim().to_string();
    if !username.is_empty() {
        validate_username(&username)?;
    }
    let pattern = format!("%{}%", query);
    let limit = limit.unwrap_or(50).clamp(1, 100);
    let offset = offset.unwrap_or(0).max(0);
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    let total: i64 = connection.query_row(
        "SELECT COUNT(*) FROM imported_games
         WHERE (?1 = '' OR provider = ?1)
           AND (?2 = '' OR source_username = ?2 COLLATE NOCASE)
           AND (?3 = '' OR white LIKE ?4 OR black LIKE ?4 OR played_at LIKE ?4
                OR opening LIKE ?4 OR source_username LIKE ?4 OR result LIKE ?4)",
        rusqlite::params![provider, username, query, pattern],
        |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    let mut statement = connection.prepare(
        "SELECT id, provider, source_username, source_game_id, white, black, played_at,
                result, time_control, opening, source_url
         FROM imported_games
         WHERE (?1 = '' OR provider = ?1)
           AND (?2 = '' OR source_username = ?2 COLLATE NOCASE)
           AND (?3 = '' OR white LIKE ?4 OR black LIKE ?4 OR played_at LIKE ?4
                OR opening LIKE ?4 OR source_username LIKE ?4 OR result LIKE ?4)
         ORDER BY played_at DESC, imported_at DESC
         LIMIT ?5 OFFSET ?6"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map(
        rusqlite::params![provider, username, query, pattern, limit, offset],
        |row| Ok(ImportedGameSummary {
            id: row.get(0)?, provider: row.get(1)?, source_username: row.get(2)?,
            source_game_id: row.get(3)?, white: row.get(4)?, black: row.get(5)?,
            played_at: row.get(6)?, result: row.get(7)?, time_control: row.get(8)?,
            opening: row.get(9)?, source_url: row.get(10)?,
        }),
    ).map_err(|error| error.to_string())?;
    let games = rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(ImportedGamePage { games, total, offset, limit })
}

#[tauri::command]
pub fn export_imported_games_pgn(
    database: State<'_, Database>,
    query: Option<String>,
    provider: Option<String>,
    username: Option<String>,
) -> Result<String, String> {
    let query = query.unwrap_or_default().trim().to_string();
    let provider = provider.unwrap_or_default();
    if !provider.is_empty() && provider != "chess_com" && provider != "lichess" {
        return Err("Piattaforma non valida.".into());
    }
    let username = username.unwrap_or_default().trim().to_string();
    if !username.is_empty() {
        validate_username(&username)?;
    }
    let pattern = format!("%{}%", query);
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    let mut statement = connection.prepare(
        "SELECT pgn FROM imported_games
         WHERE (?1 = '' OR provider = ?1)
           AND (?2 = '' OR source_username = ?2 COLLATE NOCASE)
           AND (?3 = '' OR white LIKE ?4 OR black LIKE ?4 OR played_at LIKE ?4
                OR opening LIKE ?4 OR source_username LIKE ?4 OR result LIKE ?4)
         ORDER BY played_at ASC, imported_at ASC"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map(rusqlite::params![provider, username, query, pattern], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let pgns = rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    if pgns.is_empty() {
        return Err("Nessuna partita corrisponde ai filtri dell'archivio.".into());
    }
    Ok(pgns.join("\n\n"))
}

/// Returns every locally stored game imported from a Chess.com profile.
/// PGNs are intentionally omitted so large archives stay cheap to transfer to the UI.
#[tauri::command]
pub fn list_profile_games(
    database: State<'_, Database>,
    provider: String,
    username: String,
) -> Result<Vec<OpponentGameRecord>, String> {
    if provider != "chess_com" {
        return Err("I report profilo sono disponibili per Chess.com.".into());
    }
    let username = validate_username(&username)?;
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    let mut statement = connection.prepare(
        "SELECT imported_games.id, imported_games.provider, imported_games.source_username,
                imported_games.source_game_id, imported_games.white, imported_games.black,
                imported_games.played_at, imported_games.result, imported_games.time_control,
                imported_games.opening, imported_games.source_url, imported_games.pgn
         FROM imported_games
         INNER JOIN imported_game_sources USING (provider, source_game_id)
         WHERE imported_games.provider = ?1 AND imported_game_sources.source_username = ?2 COLLATE NOCASE
         ORDER BY played_at DESC, imported_at DESC"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map([provider, username], |row| {
        let pgn: String = row.get(11)?;
        let headers = parse_headers(&pgn);
        let (white_first_move, black_first_move) = first_two_san_moves(&pgn);
        Ok(OpponentGameRecord {
            summary: ImportedGameSummary {
                id: row.get(0)?, provider: row.get(1)?, source_username: row.get(2)?,
                source_game_id: row.get(3)?, white: row.get(4)?, black: row.get(5)?,
                played_at: row.get(6)?, result: row.get(7)?, time_control: row.get(8)?,
                opening: row.get(9)?, source_url: row.get(10)?,
            },
            white_elo: headers.get("WhiteElo").cloned(),
            black_elo: headers.get("BlackElo").cloned(),
            eco: headers.get("ECO").cloned(),
            white_first_move,
            black_first_move,
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

        let mut same_game_from_another_profile = parse_game("lichess", "second_player", PGN_ONE.to_string()).unwrap();
        same_game_from_another_profile.source_username = "second_player".into();
        let mut batch = vec![same_game_from_another_profile];
        persist_batch(&database, &mut batch, &mut counts).unwrap();
        assert_eq!(counts.imported, 1);
        assert_eq!(counts.duplicates, 2);

        let connection = database.0.lock().unwrap();
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM imported_games", [], |row| row.get(0)
        ).unwrap();
        assert_eq!(count, 1);
        let profile_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM imported_game_sources", [], |row| row.get(0)
        ).unwrap();
        assert_eq!(profile_count, 2);
    }

    #[test]
    fn accepts_only_the_official_chess_com_archive_url_shape() {
        assert_eq!(
            parse_chess_com_archive_url("https://api.chess.com/pub/player/player1/games/2026/11"),
            Some(("2026".to_string(), "11".to_string()))
        );
        assert_eq!(
            parse_chess_com_archive_url("https://api.chess.com/pub/player/player1/games/2026/02/"),
            Some(("2026".to_string(), "02".to_string()))
        );
        assert_eq!(parse_chess_com_archive_url("https://api.chess.com.evil/pub/player/player1/games/2026/11"), None);
        assert_eq!(parse_chess_com_archive_url("http://api.chess.com/pub/player/player1/games/2026/11"), None);
        assert_eq!(parse_chess_com_archive_url("https://api.chess.com/pub/player/player1/games/2026/13"), None);
        assert_eq!(parse_chess_com_archive_url("https://api.chess.com/pub/player/player1/games/26/01"), None);
        assert_eq!(parse_chess_com_archive_url("https://api.chess.com/pub/player/player1/games/2026/11?next=1"), None);
        assert_eq!(parse_chess_com_archive_url("not-an-archive-url"), None);
    }

    #[test]
    fn enforces_archive_size_limits_without_integer_overflow() {
        assert_eq!(bounded_archive_size(0, 1024), Some(1024));
        assert_eq!(bounded_archive_size(MAX_ARCHIVE_BYTES - 1, 1), Some(MAX_ARCHIVE_BYTES));
        assert_eq!(bounded_archive_size(MAX_ARCHIVE_BYTES, 1), None);
        assert_eq!(bounded_archive_size(usize::MAX, 1), None);
    }

    #[test]
    fn bounds_the_incomplete_game_buffer_for_both_providers() {
        assert!(!pending_game_exceeds_limit(&[]));
        assert!(!pending_game_exceeds_limit(&vec![b'x'; MAX_GAME_PGN_BYTES]));
        assert!(pending_game_exceeds_limit(&vec![b'x'; MAX_GAME_PGN_BYTES + 1]));
    }

    #[test]
    fn reports_chess_com_rate_limit_errors_with_a_retry_hint() {
        let error = check_http_status(StatusCode::TOO_MANY_REQUESTS, "chess.com").unwrap_err();
        assert!(error.contains("429"));
        assert!(error.contains("60 secondi"));
    }

    #[test]
    fn validates_usernames_before_building_provider_urls() {
        assert!(validate_username("valid_user-1").is_ok());
        assert!(validate_username("../other").is_err());
        assert!(validate_username("a name").is_err());
    }
}
