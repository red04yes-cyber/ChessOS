use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rusqlite::backup::Backup;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use std::sync::Mutex;

pub struct Database(pub Mutex<Connection>, pub PathBuf);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionNode {
    pub id: String,
    pub key: String,
    pub fen: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub uci: String,
    pub san: String,
    #[serde(default)]
    pub order: i64,
    #[serde(default)]
    pub nags: Vec<String>,
    #[serde(default)]
    pub comment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepertoireTreeData {
    pub root_id: String,
    pub root_fen: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub nodes: Vec<PositionNode>,
    #[serde(default)]
    pub edges: Vec<MoveEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRepertoireInput {
    pub id: String,
    pub title: String,
    pub pgn: String,
    #[serde(default)]
    pub sans: Vec<String>,
    pub tree: RepertoireTreeData,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepertoireRecord {
    pub id: String,
    pub title: String,
    pub pgn: String,
    pub sans: Vec<String>,
    pub edge_count: usize,
    pub node_count: usize,
    pub created_at: String,
    pub updated_at: String,
    pub tree: RepertoireTreeData,
}

pub fn open_database(path: &Path) -> Result<Connection, Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    if !path.exists() {
        let has_sidecar = ["-wal", "-shm"].iter().any(|suffix| {
            PathBuf::from(format!("{}{}", path.to_string_lossy(), suffix)).exists()
        });
        let has_automatic_backups = !automatic_backup_candidates(&backup_directory(path)).is_empty();
        if has_sidecar || has_automatic_backups {
            let quarantined = quarantine_corrupt_database(path)
                .map_err(std::io::Error::other)?;
            return recover_from_automatic_backup(path, &quarantined)
                .map_err(|error| std::io::Error::other(error).into());
        }
    }

    if path.exists() && fs::metadata(path).map(|metadata| metadata.len() > 0).unwrap_or(true) {
        let existing = (|| -> Result<Connection, String> {
            let mut connection = Connection::open(path).map_err(|error| error.to_string())?;
            connection.busy_timeout(Duration::from_secs(5)).map_err(|error| error.to_string())?;
            validate_database_file(&connection)?;
            connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
                .map_err(|error| error.to_string())?;
            migrate(&mut connection).map_err(|error| error.to_string())?;
            validate_database_file(&connection)?;
            Ok(connection)
        })();

        match existing {
            Ok(connection) => {
                let _ = create_automatic_backup(&connection, path);
                return Ok(connection);
            }
            Err(reason) if !is_database_corruption_reason(&reason) => {
                return Err(std::io::Error::other(reason).into());
            }
            Err(_) => {
                let quarantined = quarantine_corrupt_database(path)
                    .map_err(std::io::Error::other)?;
                return recover_from_automatic_backup(path, &quarantined)
                    .map_err(|error| std::io::Error::other(error).into());
            }
        }
    }

    let mut connection = Connection::open(path)?;
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    migrate(&mut connection)?;
    validate_database_file(&connection).map_err(std::io::Error::other)?;
    let _ = create_automatic_backup(&connection, path);
    Ok(connection)
}

pub fn migrate(connection: &mut Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY NOT NULL,
            applied_at TEXT NOT NULL
        );"
    )?;

    let current_version: i64 = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;

    if current_version < 1 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            "CREATE TABLE repertoires (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                root_fen TEXT NOT NULL,
                pgn TEXT NOT NULL,
                sans_json TEXT NOT NULL DEFAULT '[]',
                headers_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE repertoire_positions (
                repertoire_id TEXT NOT NULL,
                position_id TEXT NOT NULL,
                position_key TEXT NOT NULL,
                fen TEXT NOT NULL,
                PRIMARY KEY (repertoire_id, position_id),
                FOREIGN KEY (repertoire_id) REFERENCES repertoires(id) ON DELETE CASCADE
            );

            CREATE TABLE repertoire_moves (
                repertoire_id TEXT NOT NULL,
                edge_id TEXT NOT NULL,
                from_position_id TEXT NOT NULL,
                to_position_id TEXT NOT NULL,
                uci TEXT NOT NULL,
                san TEXT NOT NULL,
                nags_json TEXT NOT NULL DEFAULT '[]',
                comment TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (repertoire_id, edge_id),
                FOREIGN KEY (repertoire_id, from_position_id)
                    REFERENCES repertoire_positions(repertoire_id, position_id) ON DELETE CASCADE,
                FOREIGN KEY (repertoire_id, to_position_id)
                    REFERENCES repertoire_positions(repertoire_id, position_id) ON DELETE CASCADE
            );

            CREATE TABLE app_settings (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE study_cards (
                id TEXT PRIMARY KEY NOT NULL,
                repertoire_id TEXT NOT NULL,
                edge_id TEXT NOT NULL,
                side TEXT NOT NULL CHECK (side IN ('white', 'black', 'both')),
                due_at TEXT,
                stability REAL,
                difficulty REAL,
                reps INTEGER NOT NULL DEFAULT 0,
                lapses INTEGER NOT NULL DEFAULT 0,
                state TEXT NOT NULL DEFAULT 'new',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (repertoire_id) REFERENCES repertoires(id) ON DELETE CASCADE
            );

            CREATE TABLE training_sessions (
                id TEXT PRIMARY KEY NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                side TEXT NOT NULL DEFAULT 'both',
                cards_reviewed INTEGER NOT NULL DEFAULT 0,
                correct_count INTEGER NOT NULL DEFAULT 0,
                again_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE review_logs (
                id TEXT PRIMARY KEY NOT NULL,
                card_id TEXT NOT NULL,
                session_id TEXT,
                rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
                reviewed_at TEXT NOT NULL,
                elapsed_ms INTEGER,
                scheduled_days REAL,
                state_json TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY (card_id) REFERENCES study_cards(id) ON DELETE CASCADE,
                FOREIGN KEY (session_id) REFERENCES training_sessions(id) ON DELETE SET NULL
            );"
        )?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?1)",
            params![now_timestamp()],
        )?;
        transaction.commit()?;
    }

    let latest_version: i64 = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    if latest_version < 2 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            "CREATE INDEX idx_repertoires_updated ON repertoires(updated_at DESC);
             CREATE INDEX idx_positions_key ON repertoire_positions(repertoire_id, position_key);
             CREATE INDEX idx_moves_parent ON repertoire_moves(repertoire_id, from_position_id, sort_order);
             CREATE INDEX idx_cards_due ON study_cards(due_at);
             CREATE INDEX idx_review_logs_card_date ON review_logs(card_id, reviewed_at DESC);"
        )?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?1)",
            params![now_timestamp()],
        )?;
        transaction.commit()?;
    }
    Ok(())
}

fn now_timestamp() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    millis.to_string()
}

fn is_valid_fen(fen: &str) -> bool {
    let fields: Vec<&str> = fen.split_whitespace().collect();
    if fields.len() != 6 || (fields[1] != "w" && fields[1] != "b") {
        return false;
    }

    let ranks: Vec<&str> = fields[0].split('/').collect();
    if ranks.len() != 8 {
        return false;
    }

    let mut white_kings = 0usize;
    let mut black_kings = 0usize;
    for (rank_index, rank) in ranks.iter().enumerate() {
        let mut squares = 0usize;
        let mut previous_was_digit = false;
        for piece in rank.chars() {
            match piece {
                '1'..='8' => {
                    if previous_was_digit {
                        return false;
                    }
                    squares += piece.to_digit(10).unwrap_or(0) as usize;
                    previous_was_digit = true;
                }
                'p' | 'n' | 'b' | 'r' | 'q' | 'k'
                | 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' => {
                    if matches!(piece, 'p' | 'P') && (rank_index == 0 || rank_index == 7) {
                        return false;
                    }
                    match piece {
                        'k' => black_kings += 1,
                        'K' => white_kings += 1,
                        _ => {}
                    }
                    squares += 1;
                    previous_was_digit = false;
                }
                _ => return false,
            }
            if squares > 8 {
                return false;
            }
        }
        if squares != 8 {
            return false;
        }
    }
    if white_kings != 1 || black_kings != 1 {
        return false;
    }

    if fields[2] != "-" {
        let mut seen = std::collections::HashSet::new();
        if !fields[2].chars().all(|right| {
            matches!(right, 'K' | 'Q' | 'k' | 'q') && seen.insert(right)
        }) {
            return false;
        }
    }

    if fields[3] != "-" {
        let expected_rank = if fields[1] == "w" { b'6' } else { b'3' };
        if fields[3].len() != 2
            || !(b'a'..=b'h').contains(&fields[3].as_bytes()[0])
            || fields[3].as_bytes()[1] != expected_rank
        {
            return false;
        }
    }

    fields[4].parse::<u32>().is_ok()
        && fields[5].parse::<u32>().is_ok_and(|fullmove| fullmove > 0)
}

fn validate_input(input: &SaveRepertoireInput) -> Result<(), String> {
    const MAX_PGN_BYTES: usize = 5_000_000;
    const MAX_PAYLOAD_BYTES: usize = 25_000_000;
    const MAX_NODES: usize = 100_000;
    const MAX_EDGES: usize = 100_000;

    if input.id.trim().is_empty() || input.id.len() > 160 {
        return Err("ID repertorio non valido.".into());
    }
    if input.title.trim().is_empty() || input.title.len() > 200 {
        return Err("Titolo repertorio non valido.".into());
    }
    if input.pgn.len() > MAX_PGN_BYTES {
        return Err("PGN troppo grande.".into());
    }
    if input.created_at.as_ref().is_some_and(|value| value.len() > 64)
        || input.updated_at.as_ref().is_some_and(|value| value.len() > 64)
    {
        return Err("Timestamp repertorio non valido.".into());
    }
    if input.sans.len() > MAX_EDGES || input.sans.iter().any(|san| san.is_empty() || san.len() > 32) {
        return Err("Elenco delle mosse non valido o troppo grande.".into());
    }
    if input.tree.nodes.is_empty() || input.tree.nodes.len() > MAX_NODES {
        return Err("Albero delle posizioni vuoto o troppo grande.".into());
    }
    if input.tree.edges.len() > MAX_EDGES {
        return Err("Albero delle mosse troppo grande.".into());
    }
    if input.tree.root_fen.is_empty() || input.tree.root_fen.len() > 256
        || input.tree.headers.len() > 64
        || input.tree.headers.iter().any(|(key, value)| key.is_empty() || key.len() > 128 || value.len() > 4096)
    {
        return Err("Metadati dell'albero non validi o troppo grandi.".into());
    }

    let mut payload_bytes = input.id.len()
        .saturating_add(input.title.len())
        .saturating_add(input.pgn.len())
        .saturating_add(input.tree.root_id.len())
        .saturating_add(input.tree.root_fen.len());
    let mut ids = std::collections::HashSet::new();
    let mut root_matches = false;
    for node in &input.tree.nodes {
        let fen_fields: Vec<&str> = node.fen.split_whitespace().collect();
        let expected_key = fen_fields.iter().take(4).copied().collect::<Vec<_>>().join(" ");
        if node.id.is_empty() || node.id.len() > 160
            || node.key.is_empty() || node.key.len() > 256
            || node.fen.is_empty() || node.fen.len() > 256
            || !is_valid_fen(&node.fen) || node.key != expected_key
            || !ids.insert(node.id.as_str())
        {
            return Err("Nodo dell'albero non valido o duplicato.".into());
        }
        root_matches |= node.id == input.tree.root_id && node.fen == input.tree.root_fen;
        payload_bytes = payload_bytes
            .saturating_add(node.id.len())
            .saturating_add(node.key.len())
            .saturating_add(node.fen.len());
    }
    if !root_matches {
        return Err("Nodo radice non valido o non coerente con la posizione iniziale.".into());
    }

    let mut edge_ids = std::collections::HashSet::new();
    let mut edge_orders: std::collections::HashMap<&str, std::collections::HashSet<i64>> =
        std::collections::HashMap::new();
    for edge in &input.tree.edges {
        let uci = edge.uci.as_bytes();
        let valid_uci = (uci.len() == 4 || uci.len() == 5)
            && (b'a'..=b'h').contains(&uci[0])
            && (b'1'..=b'8').contains(&uci[1])
            && (b'a'..=b'h').contains(&uci[2])
            && (b'1'..=b'8').contains(&uci[3])
            && (uci.len() == 4 || b"qrbn".contains(&uci[4]));
        if edge.id.is_empty() || edge.id.len() > 320
            || !valid_uci || edge.san.is_empty() || edge.san.len() > 32
            || edge.comment.len() > 4096
            || edge.nags.len() > 32
            || edge.nags.iter().any(|nag| nag.is_empty() || nag.len() > 16)
            || !ids.contains(edge.from.as_str())
            || !ids.contains(edge.to.as_str())
            || edge.id != format!("{}|{}", edge.from, edge.uci)
            || !edge_ids.insert(edge.id.as_str())
            || edge.order < 0
            || !edge_orders.entry(edge.from.as_str()).or_default().insert(edge.order)
        {
            return Err("Arco dell'albero non valido o duplicato.".into());
        }
        payload_bytes = payload_bytes
            .saturating_add(edge.id.len())
            .saturating_add(edge.from.len())
            .saturating_add(edge.to.len())
            .saturating_add(edge.uci.len())
            .saturating_add(edge.san.len())
            .saturating_add(edge.comment.len())
            .saturating_add(edge.nags.iter().map(String::len).sum::<usize>());
    }
    for (key, value) in &input.tree.headers {
        payload_bytes = payload_bytes.saturating_add(key.len()).saturating_add(value.len());
    }
    for san in &input.sans {
        payload_bytes = payload_bytes.saturating_add(san.len());
    }
    for timestamp in [&input.created_at, &input.updated_at].into_iter().flatten() {
        payload_bytes = payload_bytes.saturating_add(timestamp.len());
    }
    if payload_bytes > MAX_PAYLOAD_BYTES {
        return Err("Dati del repertorio troppo voluminosi.".into());
    }
    Ok(())
}

fn save_with_connection(connection: &mut Connection, input: SaveRepertoireInput) -> Result<RepertoireRecord, String> {
    validate_input(&input)?;
    let created_at = input.created_at.unwrap_or_else(now_timestamp);
    let updated_at = input.updated_at.unwrap_or_else(now_timestamp);
    let sans_json = serde_json::to_string(&input.sans).map_err(|error| error.to_string())?;
    let headers_json = serde_json::to_string(&input.tree.headers).map_err(|error| error.to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;

    transaction.execute(
        "INSERT INTO repertoires
            (id, title, root_fen, pgn, sans_json, headers_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            root_fen = excluded.root_fen,
            pgn = excluded.pgn,
            sans_json = excluded.sans_json,
            headers_json = excluded.headers_json,
            updated_at = excluded.updated_at",
        params![
            input.id,
            input.title.trim(),
            input.tree.root_fen,
            input.pgn,
            sans_json,
            headers_json,
            created_at,
            updated_at
        ],
    ).map_err(|error| error.to_string())?;

    transaction.execute(
        "DELETE FROM repertoire_positions WHERE repertoire_id = ?1",
        params![input.id],
    ).map_err(|error| error.to_string())?;

    {
        let mut statement = transaction.prepare(
            "INSERT INTO repertoire_positions (repertoire_id, position_id, position_key, fen)
             VALUES (?1, ?2, ?3, ?4)"
        ).map_err(|error| error.to_string())?;
        for node in &input.tree.nodes {
            statement.execute(params![input.id, node.id, node.key, node.fen])
                .map_err(|error| error.to_string())?;
        }
    }

    {
        let mut statement = transaction.prepare(
            "INSERT INTO repertoire_moves
                (repertoire_id, edge_id, from_position_id, to_position_id, uci, san, nags_json, comment, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
        ).map_err(|error| error.to_string())?;
        for edge in &input.tree.edges {
            let nags = serde_json::to_string(&edge.nags).map_err(|error| error.to_string())?;
            statement.execute(params![
                input.id, edge.id, edge.from, edge.to, edge.uci, edge.san, nags, edge.comment, edge.order
            ]).map_err(|error| error.to_string())?;
        }
    }

    transaction.commit().map_err(|error| error.to_string())?;
    load_one(connection, &input.id)?.ok_or_else(|| "Il repertorio salvato non è stato trovato.".into())
}

fn load_one(connection: &Connection, id: &str) -> Result<Option<RepertoireRecord>, String> {
    let base: Option<(String, String, String, String, String, String, String)> = connection.query_row(
        "SELECT title, root_fen, pgn, sans_json, headers_json, created_at, updated_at
         FROM repertoires WHERE id = ?1",
        params![id],
        |row| Ok((
            row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
            row.get(4)?, row.get(5)?, row.get(6)?
        )),
    ).optional().map_err(|error| error.to_string())?;

    let Some((title, root_fen, pgn, sans_json, headers_json, created_at, updated_at)) = base else {
        return Ok(None);
    };

    let mut nodes_statement = connection.prepare(
        "SELECT position_id, position_key, fen FROM repertoire_positions
         WHERE repertoire_id = ?1 ORDER BY position_id"
    ).map_err(|error| error.to_string())?;
    let nodes = nodes_statement.query_map(params![id], |row| {
        Ok(PositionNode { id: row.get(0)?, key: row.get(1)?, fen: row.get(2)? })
    }).map_err(|error| error.to_string())?
      .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    drop(nodes_statement);

    let mut edges_statement = connection.prepare(
        "SELECT edge_id, from_position_id, to_position_id, uci, san, nags_json, comment, sort_order
         FROM repertoire_moves WHERE repertoire_id = ?1 ORDER BY sort_order, edge_id"
    ).map_err(|error| error.to_string())?;
    let edges = edges_statement.query_map(params![id], |row| {
        let nags_json: String = row.get(5)?;
        let nags = serde_json::from_str(&nags_json).unwrap_or_default();
        Ok(MoveEdge {
            id: row.get(0)?, from: row.get(1)?, to: row.get(2)?,
            uci: row.get(3)?, san: row.get(4)?, nags, comment: row.get(6)?, order: row.get(7)?
        })
    }).map_err(|error| error.to_string())?
      .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;

    let sans = serde_json::from_str(&sans_json).unwrap_or_default();
    let headers = serde_json::from_str(&headers_json).unwrap_or_default();
    let root_id = nodes.iter().find(|node| node.fen == root_fen).map(|node| node.id.clone())
        .ok_or_else(|| "Nodo radice assente dal database.".to_string())?;
    let tree = RepertoireTreeData { root_id, root_fen, headers, nodes, edges };
    let edge_count = tree.edges.len();
    let node_count = tree.nodes.len();

    Ok(Some(RepertoireRecord {
        id: id.to_string(), title, pgn, sans, edge_count, node_count,
        created_at, updated_at, tree,
    }))
}

fn list_with_connection(connection: &Connection) -> Result<Vec<RepertoireRecord>, String> {
    let mut statement = connection.prepare(
        "SELECT id FROM repertoires ORDER BY updated_at DESC, title COLLATE NOCASE"
    ).map_err(|error| error.to_string())?;
    let ids = statement.query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    drop(statement);

    ids.iter().map(|id| load_one(connection, id)?.ok_or_else(|| "Repertorio non trovato.".into())).collect()
}

#[tauri::command]
pub fn list_repertoires(database: State<'_, Database>) -> Result<Vec<RepertoireRecord>, String> {
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    list_with_connection(&connection)
}

#[tauri::command]
pub fn save_repertoire(
    database: State<'_, Database>,
    input: SaveRepertoireInput,
) -> Result<RepertoireRecord, String> {
    let mut connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    let saved = save_with_connection(&mut connection, input)?;
    if let Err(error) = create_automatic_backup(&connection, &database.1) {
        eprintln!("Backup automatico non riuscito dopo il salvataggio del repertorio: {error}");
    }
    Ok(saved)
}

#[tauri::command]
pub fn delete_repertoire(database: State<'_, Database>, id: String) -> Result<bool, String> {
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    let deleted = connection.execute("DELETE FROM repertoires WHERE id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    if deleted > 0 {
        if let Err(error) = create_automatic_backup(&connection, &database.1) {
            eprintln!("Backup automatico non riuscito dopo l'eliminazione del repertorio: {error}");
        }
    }
    Ok(deleted > 0)
}



const MAX_DATABASE_BACKUP_BYTES: usize = 64 * 1024 * 1024;
const MAX_AUTOMATIC_BACKUPS: usize = 5;
const SUPPORTED_SCHEMA_VERSION: i64 = 2;

fn backup_suffix() -> String {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos().to_string()
}

fn backup_directory(database_path: &Path) -> PathBuf {
    database_path.parent().unwrap_or_else(|| Path::new(".")).join("backups")
}

fn is_database_corruption_reason(reason: &str) -> bool {
    reason.starts_with("SQLite ha rilevato un'incoerenza")
        || reason.starts_with("Il database contiene riferimenti")
        || reason.starts_with("Tabella richiesta assente")
        || reason.starts_with("Lo schema SQLite contiene tabelle")
        || reason.starts_with("Il backup contiene trigger o viste")
        || reason.starts_with("Il backup contiene un repertorio non valido")
        || reason.contains("file is not a database")
        || reason.contains("database disk image is malformed")
        || reason.contains("no such table: schema_migrations")
        || reason.contains("no such column")
        || reason.contains("malformed")
}

fn check_database_integrity(connection: &Connection) -> Result<(), String> {
    let quick_check: String = connection.query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|error| format!("Controllo integrità SQLite non riuscito: {error}"))?;
    if quick_check != "ok" {
        return Err(format!("SQLite ha rilevato un'incoerenza: {quick_check}"));
    }
    let mut statement = connection.prepare("PRAGMA foreign_key_check").map_err(|error| error.to_string())?;
    let mut rows = statement.query([]).map_err(|error| error.to_string())?;
    if rows.next().map_err(|error| error.to_string())?.is_some() {
        return Err("Il database contiene riferimenti tra tabelle non validi.".into());
    }
    Ok(())
}

fn validate_database_file(connection: &Connection) -> Result<(), String> {
    check_database_integrity(connection)?;
    let version: i64 = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |row| row.get(0)
    ).map_err(|error| format!("Versione dello schema SQLite non leggibile: {error}"))?;
    if !(1..=SUPPORTED_SCHEMA_VERSION).contains(&version) {
        return Err(format!("Versione dello schema SQLite non supportata: {version}."));
    }
    for table in [
        "schema_migrations",
        "repertoires",
        "repertoire_positions",
        "repertoire_moves",
        "app_settings",
        "study_cards",
        "training_sessions",
        "review_logs",
    ] {
        let exists: Option<String> = connection.query_row(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table], |row| row.get(0)
        ).optional().map_err(|error| error.to_string())?;
        if exists.is_none() {
            return Err(format!("Tabella richiesta assente nel backup: {table}."));
        }
    }

    let repertoire_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM repertoires", [], |row| row.get(0)
    ).map_err(|error| error.to_string())?;
    if !(0..=5_000).contains(&repertoire_count) {
        return Err("Il backup contiene un numero di repertori non supportato.".into());
    }

    let table_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    if table_count != 8 {
        return Err("Lo schema SQLite contiene tabelle non riconosciute o mancanti.".into());
    }

    let executable_objects: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master
         WHERE type IN ('trigger', 'view') AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    if executable_objects != 0 {
        return Err("Il backup contiene trigger o viste non riconosciuti.".into());
    }

    let records = list_with_connection(connection)?;
    let mut validated_bytes = 0usize;
    for record in records {
        let input = SaveRepertoireInput {
            id: record.id,
            title: record.title,
            pgn: record.pgn,
            sans: record.sans,
            tree: record.tree,
            created_at: Some(record.created_at),
            updated_at: Some(record.updated_at),
        };
        validate_input(&input)
            .map_err(|error| format!("Il backup contiene un repertorio non valido: {error}"))?;
        validated_bytes = validated_bytes
            .saturating_add(input.pgn.len())
            .saturating_add(input.tree.nodes.iter().map(|node| node.fen.len() + node.key.len() + node.id.len()).sum::<usize>())
            .saturating_add(input.tree.edges.iter().map(|edge| edge.id.len() + edge.uci.len() + edge.san.len() + edge.comment.len()).sum::<usize>());
        if validated_bytes > 256 * 1024 * 1024 {
            return Err("Il contenuto del backup supera il limite di verifica di 256 MiB.".into());
        }
    }
    Ok(())
}

fn copy_database(source: &Connection, destination: &mut Connection) -> Result<(), String> {
    {
        let mut backup = Backup::new(source, destination).map_err(|error| error.to_string())?;
        backup.run_to_completion(128, Duration::from_millis(20), None)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn backup_connection_to_path(source: &Connection, path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let placeholder = OpenOptions::new().write(true).create_new(true).open(path)
        .map_err(|error| error.to_string())?;
    drop(placeholder);

    let result = (|| {
        let mut destination = Connection::open(path).map_err(|error| error.to_string())?;
        destination.busy_timeout(Duration::from_secs(5)).map_err(|error| error.to_string())?;
        copy_database(source, &mut destination)?;
        destination.execute_batch("PRAGMA journal_mode = DELETE;").map_err(|error| error.to_string())?;
        validate_database_file(&destination)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}

fn prune_automatic_backups(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else { return; };
    let mut backups: Vec<(SystemTime, PathBuf)> = entries.filter_map(Result::ok).filter_map(|entry| {
        let path = entry.path();
        let name = path.file_name()?.to_str()?;
        if !name.starts_with("chess-os-auto-") || path.extension()?.to_str()? != "sqlite3" {
            return None;
        }
        Some((entry.metadata().ok()?.modified().ok()?, path))
    }).collect();
    backups.sort_by_key(|(modified, _)| *modified);
    let excess = backups.len().saturating_sub(MAX_AUTOMATIC_BACKUPS);
    for (_, path) in backups.into_iter().take(excess) {
        let _ = fs::remove_file(path);
    }
}

fn create_automatic_backup(connection: &Connection, database_path: &Path) -> Result<PathBuf, String> {
    let directory = backup_directory(database_path);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(format!("chess-os-auto-{}.sqlite3", backup_suffix()));
    backup_connection_to_path(connection, &path)?;
    prune_automatic_backups(&directory);
    Ok(path)
}

fn automatic_backup_candidates(directory: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(directory) else { return Vec::new(); };
    let mut backups: Vec<(SystemTime, PathBuf)> = entries.filter_map(Result::ok).filter_map(|entry| {
        let path = entry.path();
        let name = path.file_name()?.to_str()?;
        if !name.starts_with("chess-os-auto-") || path.extension()?.to_str()? != "sqlite3" {
            return None;
        }
        Some((entry.metadata().ok()?.modified().ok()?, path))
    }).collect();
    backups.sort_by(|a, b| b.0.cmp(&a.0));
    backups.into_iter().map(|(_, path)| path).collect()
}

fn quarantine_corrupt_database(path: &Path) -> Result<PathBuf, String> {
    let quarantined = path.with_file_name(format!(
        "{}.corrupt-{}",
        path.file_name().and_then(|name| name.to_str()).unwrap_or("chess-os.sqlite3"),
        backup_suffix()
    ));
    if path.exists() {
        fs::rename(path, &quarantined).map_err(|error| error.to_string())?;
    }
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{}", path.to_string_lossy(), suffix));
        if sidecar.exists() {
            let sidecar_quarantine = PathBuf::from(format!("{}{}", quarantined.to_string_lossy(), suffix));
            fs::rename(&sidecar, &sidecar_quarantine)
                .map_err(|error| format!("Impossibile conservare il sidecar SQLite {}: {error}", sidecar.display()))?;
        }
    }
    Ok(quarantined)
}

fn recover_from_automatic_backup(path: &Path, quarantined: &Path) -> Result<Connection, String> {
    for candidate_path in automatic_backup_candidates(&backup_directory(path)) {
        let candidate = match Connection::open(&candidate_path) {
            Ok(connection) => connection,
            Err(_) => continue,
        };
        if validate_database_file(&candidate).is_err() {
            continue;
        }
        if fs::copy(&candidate_path, path).is_err() {
            continue;
        }
        drop(candidate);

        let restored: Result<Connection, String> = (|| {
            let mut connection = Connection::open(path).map_err(|error| error.to_string())?;
            connection.busy_timeout(Duration::from_secs(5)).map_err(|error| error.to_string())?;
            connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
                .map_err(|error| error.to_string())?;
            migrate(&mut connection).map_err(|error| error.to_string())?;
            validate_database_file(&connection)?;
            Ok(connection)
        })();
        if let Ok(connection) = restored {
            let _ = create_automatic_backup(&connection, path);
            return Ok(connection);
        }
        let _ = fs::remove_file(path);
    }
    Err(format!(
        "File del database danneggiato (quando presente) e sidecar conservati vicino a {}. Nessun backup automatico integro è disponibile: importa un backup manuale per recuperare i dati.",
        quarantined.display()
    ))
}

fn export_backup_base64(connection: &Connection) -> Result<String, String> {
    validate_database_file(connection)?;
    let path = std::env::temp_dir().join(format!(
        "chess-os-export-{}-{}.sqlite3", std::process::id(), backup_suffix()
    ));
    backup_connection_to_path(connection, &path)?;
    let bytes = fs::read(&path).map_err(|error| error.to_string());
    let _ = fs::remove_file(&path);
    let bytes = bytes?;
    if bytes.len() > MAX_DATABASE_BACKUP_BYTES {
        return Err("Il database supera il limite di esportazione di 64 MiB.".into());
    }
    Ok(BASE64.encode(bytes))
}

#[tauri::command]
pub fn create_database_backup(database: State<'_, Database>) -> Result<String, String> {
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    export_backup_base64(&connection)
}

#[tauri::command]
pub fn restore_database(
    app: AppHandle,
    database: State<'_, Database>,
    backup_base64: String,
) -> Result<bool, String> {
    if backup_base64.len() > (MAX_DATABASE_BACKUP_BYTES * 4 / 3 + 16) {
        return Err("Il file di backup supera il limite di 64 MiB.".into());
    }
    let bytes = BASE64.decode(backup_base64.as_bytes())
        .map_err(|_| "Il file selezionato non è un backup valido.".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_DATABASE_BACKUP_BYTES {
        return Err("Dimensione del backup non valida (limite 64 MiB).".into());
    }

    let imported_path = std::env::temp_dir().join(format!(
        "chess-os-import-{}-{}.sqlite3", std::process::id(), backup_suffix()
    ));
    let write_result = (|| {
        let mut staged = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&imported_path)
            .map_err(|error| error.to_string())?;
        staged.write_all(&bytes).map_err(|error| error.to_string())?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&imported_path);
        return Err(error);
    }

    let result = (|| {
        let imported = Connection::open(&imported_path).map_err(|error| error.to_string())?;
        validate_database_file(&imported)?;

        let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
        let directory = app_data_dir.join("backups");
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let safety_path = directory.join(format!("chess-os-before-restore-{}.sqlite3", backup_suffix()));

        let mut current = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
        backup_connection_to_path(&current, &safety_path)
            .map_err(|error| format!("Non riesco a creare il backup di sicurezza prima del ripristino: {error}"))?;

        let restore_result: Result<(), String> = (|| {
            copy_database(&imported, &mut current)?;
            current.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
                .map_err(|error| error.to_string())?;
            migrate(&mut current).map_err(|error| error.to_string())?;
            validate_database_file(&current)?;
            Ok(())
        })();

        if let Err(error) = restore_result {
            let rollback_result = (|| {
                let rollback = Connection::open(&safety_path).map_err(|error| error.to_string())?;
                copy_database(&rollback, &mut current)?;
                current.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
                    .map_err(|error| error.to_string())?;
                Ok(())
            })();
            return Err(match rollback_result {
                Ok(()) => format!("Ripristino non riuscito: {error}. Il database precedente è stato ripristinato."),
                Err(rollback_error) => format!("Ripristino non riuscito: {error}. Anche il rollback automatico è fallito: {rollback_error}. Il backup di sicurezza è conservato in {}.", safety_path.display()),
            });
        }

        let database_path = app_data_dir.join("chess-os.sqlite3");
        let _ = create_automatic_backup(&current, &database_path);
        Ok(true)
    })();

    let _ = fs::remove_file(&imported_path);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrate(&mut connection).unwrap();
        connection
    }

    fn fixture() -> SaveRepertoireInput {
        let root_fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".to_string();
        let after_e4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1".to_string();
        let root_id = "root".to_string();
        let child_id = "after-e4".to_string();
        SaveRepertoireInput {
            id: "open-game".into(),
            title: "Open Game".into(),
            pgn: "1. e4 *".into(),
            sans: vec!["e4".into()],
            tree: RepertoireTreeData {
                root_id: root_id.clone(),
                root_fen: root_fen.clone(),
                headers: BTreeMap::new(),
                nodes: vec![
                    PositionNode {
                        id: root_id.clone(),
                        key: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -".into(),
                        fen: root_fen,
                    },
                    PositionNode {
                        id: child_id.clone(),
                        key: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -".into(),
                        fen: after_e4,
                    },
                ],
                edges: vec![MoveEdge {
                    id: "root|e2e4".into(), from: root_id, to: child_id,
                    uci: "e2e4".into(), san: "e4".into(), order: 0, nags: vec![], comment: "".into(),
                }],
            },
            created_at: Some("100".into()),
            updated_at: Some("101".into()),
        }
    }

    #[test]
    fn rejects_oversized_and_inconsistent_repertoire_data() {
        let mut input = fixture();
        input.tree.edges[0].comment = "x".repeat(4097);
        assert!(validate_input(&input).is_err());

        let mut input = fixture();
        input.tree.root_fen = "x".repeat(257);
        assert!(validate_input(&input).is_err());

        let mut input = fixture();
        input.tree.nodes[1].key = "wrong-position-key".into();
        assert!(validate_input(&input).is_err());

        let mut input = fixture();
        input.tree.nodes[1].fen = "invalid w KQkq - 0 1".into();
        input.tree.nodes[1].key = "invalid w KQkq -".into();
        assert!(validate_input(&input).is_err());

        let mut input = fixture();
        input.tree.nodes[1].fen = "4k3/8/8/8/8/8/8/4KK2 b - - 0 1".into();
        input.tree.nodes[1].key = "4k3/8/8/8/8/8/8/4KK2 b -".into();
        assert!(validate_input(&input).is_err());

        let mut input = fixture();
        input.tree.nodes[1].fen = "4k3/8/8/8/8/8/8/4K3 b - e6 0 1".into();
        input.tree.nodes[1].key = "4k3/8/8/8/8/8/8/4K3 b - e6".into();
        assert!(validate_input(&input).is_err());
    }

    fn unique_test_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "chess-os-{label}-{}-{}.sqlite3",
            std::process::id(),
            backup_suffix()
        ))
    }

    #[test]
    fn online_backup_round_trips_the_complete_database() {
        let mut source = memory_db();
        save_with_connection(&mut source, fixture()).unwrap();
        let backup_path = unique_test_path("backup-roundtrip");
        backup_connection_to_path(&source, &backup_path).unwrap();
        let backup = Connection::open(&backup_path).unwrap();
        validate_database_file(&backup).unwrap();
        let repertoires = list_with_connection(&backup).unwrap();
        assert_eq!(repertoires.len(), 1);
        assert_eq!(repertoires[0].title, "Open Game");
        drop(backup);
        let _ = fs::remove_file(backup_path);
    }

    #[test]
    fn repertoire_mutation_produces_a_verified_automatic_backup() {
        let directory = std::env::temp_dir().join(format!(
            "chess-os-auto-snapshot-{}-{}",
            std::process::id(),
            backup_suffix()
        ));
        fs::create_dir_all(&directory).unwrap();
        let database_path = directory.join("chess-os.sqlite3");
        let mut connection = Connection::open(&database_path).unwrap();
        connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;").unwrap();
        migrate(&mut connection).unwrap();
        save_with_connection(&mut connection, fixture()).unwrap();

        let snapshot = create_automatic_backup(&connection, &database_path).unwrap();
        let copied = Connection::open(&snapshot).unwrap();
        validate_database_file(&copied).unwrap();
        assert_eq!(list_with_connection(&copied).unwrap().len(), 1);

        drop(copied);
        drop(connection);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn startup_recovers_from_the_latest_verified_automatic_backup() {
        let directory = std::env::temp_dir().join(format!(
            "chess-os-recovery-{}-{}",
            std::process::id(),
            backup_suffix()
        ));
        fs::create_dir_all(&directory).unwrap();
        let database_path = directory.join("chess-os.sqlite3");

        let mut connection = Connection::open(&database_path).unwrap();
        connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;").unwrap();
        migrate(&mut connection).unwrap();
        save_with_connection(&mut connection, fixture()).unwrap();
        create_automatic_backup(&connection, &database_path).unwrap();
        drop(connection);

        fs::write(&database_path, b"not a SQLite database").unwrap();
        let recovered = open_database(&database_path).unwrap();
        let repertoires = list_with_connection(&recovered).unwrap();
        assert_eq!(repertoires.len(), 1);
        assert_eq!(repertoires[0].title, "Open Game");
        let preserved = fs::read_dir(&directory).unwrap().filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"));
        assert!(preserved);
        drop(recovered);
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn startup_preserves_corruption_when_no_automatic_backup_exists() {
        let directory = std::env::temp_dir().join(format!(
            "chess-os-no-backup-{}-{}",
            std::process::id(),
            backup_suffix()
        ));
        fs::create_dir_all(&directory).unwrap();
        let database_path = directory.join("chess-os.sqlite3");
        fs::write(&database_path, b"not a SQLite database").unwrap();
        fs::write(format!("{}-wal", database_path.to_string_lossy()), b"orphan wal").unwrap();

        assert!(open_database(&database_path).is_err());
        assert!(!database_path.exists());
        let preserved_names: Vec<String> = fs::read_dir(&directory).unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(preserved_names.iter().any(|name| name.contains(".corrupt-")));
        assert!(preserved_names.iter().any(|name| name.contains(".corrupt-") && name.ends_with("-wal")));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn startup_recovers_when_the_live_database_file_is_missing() {
        let directory = std::env::temp_dir().join(format!(
            "chess-os-missing-db-{}-{}",
            std::process::id(),
            backup_suffix()
        ));
        fs::create_dir_all(&directory).unwrap();
        let database_path = directory.join("chess-os.sqlite3");

        let mut connection = Connection::open(&database_path).unwrap();
        connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;").unwrap();
        migrate(&mut connection).unwrap();
        save_with_connection(&mut connection, fixture()).unwrap();
        create_automatic_backup(&connection, &database_path).unwrap();
        drop(connection);
        fs::remove_file(&database_path).unwrap();

        let recovered = open_database(&database_path).unwrap();
        assert_eq!(list_with_connection(&recovered).unwrap().len(), 1);
        drop(recovered);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn database_validation_rejects_unrecognized_triggers() {
        let mut connection = memory_db();
        connection.execute_batch(
            "CREATE TRIGGER unexpected_repertoire_trigger
             AFTER INSERT ON repertoires
             BEGIN SELECT 1; END;"
        ).unwrap();
        assert!(validate_database_file(&connection).is_err());
    }

    #[test]
    fn invalid_backup_is_rejected_without_touching_the_live_database() {
        let mut live = memory_db();
        save_with_connection(&mut live, fixture()).unwrap();
        let invalid_path = unique_test_path("invalid-backup");
        fs::write(&invalid_path, b"definitely not sqlite").unwrap();
        let invalid = Connection::open(&invalid_path).unwrap();
        assert!(validate_database_file(&invalid).is_err());
        assert_eq!(list_with_connection(&live).unwrap().len(), 1);
        drop(invalid);
        let _ = fs::remove_file(invalid_path);
    }

    #[test]
    fn migrations_are_versioned_and_idempotent() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        migrate(&mut connection).unwrap();
        let version: i64 = connection.query_row(
            "SELECT MAX(version) FROM schema_migrations", [], |row| row.get(0)
        ).unwrap();
        assert_eq!(version, 2);
    }

    #[test]
    fn saves_and_reads_repertoire_tree_transactionally() {
        let mut connection = memory_db();
        save_with_connection(&mut connection, fixture()).unwrap();
        let rows = list_with_connection(&connection).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Open Game");
        assert_eq!(rows[0].tree.edges.len(), 1);
        assert_eq!(rows[0].tree.edges[0].uci, "e2e4");
        assert_eq!(rows[0].sans, vec!["e4".to_string()]);
    }

    #[test]
    fn updates_existing_repertoire_without_duplicate_rows() {
        let mut connection = memory_db();
        let mut first = fixture();
        save_with_connection(&mut connection, first.clone()).unwrap();
        first.title = "Open Game updated".into();
        first.updated_at = Some("102".into());
        save_with_connection(&mut connection, first).unwrap();
        let rows = list_with_connection(&connection).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Open Game updated");
    }

    #[test]
    fn deleting_repertoire_cascades_to_positions_and_moves() {
        let mut connection = memory_db();
        save_with_connection(&mut connection, fixture()).unwrap();
        connection.execute("DELETE FROM repertoires WHERE id = 'open-game'", []).unwrap();
        let positions: i64 = connection.query_row("SELECT COUNT(*) FROM repertoire_positions", [], |r| r.get(0)).unwrap();
        let moves: i64 = connection.query_row("SELECT COUNT(*) FROM repertoire_moves", [], |r| r.get(0)).unwrap();
        assert_eq!(positions, 0);
        assert_eq!(moves, 0);
    }
}
