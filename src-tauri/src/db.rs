use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use std::sync::Mutex;

pub struct Database(pub Mutex<Connection>);

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
        std::fs::create_dir_all(parent)?;
    }
    let mut connection = Connection::open(path)?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    migrate(&mut connection)?;
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
    let version_after_v2: i64 = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    if version_after_v2 < 3 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            "ALTER TABLE study_cards ADD COLUMN fsrs_json TEXT NOT NULL DEFAULT '{}';
             CREATE INDEX idx_study_cards_due_side ON study_cards(side, due_at);"
        )?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?1)",
            params![now_timestamp()],
        )?;
        transaction.commit()?;
    }
    let version_after_v3: i64 = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    if version_after_v3 < 4 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            "CREATE TABLE study_goals (
                period TEXT PRIMARY KEY NOT NULL CHECK (period IN ('daily', 'weekly')),
                target_reviews INTEGER NOT NULL CHECK (target_reviews BETWEEN 1 AND 10000),
                target_minutes INTEGER NOT NULL CHECK (target_minutes BETWEEN 1 AND 10000),
                target_accuracy INTEGER NOT NULL CHECK (target_accuracy BETWEEN 1 AND 100),
                updated_at TEXT NOT NULL
            );
            CREATE TABLE exam_attempts (
                id TEXT PRIMARY KEY NOT NULL,
                repertoire_id TEXT NOT NULL,
                repertoire_title TEXT NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                total_questions INTEGER NOT NULL CHECK (total_questions BETWEEN 1 AND 500),
                correct_count INTEGER NOT NULL DEFAULT 0,
                pass_threshold INTEGER NOT NULL DEFAULT 70 CHECK (pass_threshold BETWEEN 1 AND 100),
                passed INTEGER NOT NULL DEFAULT 0 CHECK (passed IN (0, 1)),
                side TEXT NOT NULL CHECK (side IN ('white', 'black', 'both')),
                status TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'completed', 'aborted')),
                FOREIGN KEY (repertoire_id) REFERENCES repertoires(id) ON DELETE CASCADE
            );
            CREATE TABLE exam_answers (
                id TEXT PRIMARY KEY NOT NULL,
                attempt_id TEXT NOT NULL,
                question_index INTEGER NOT NULL CHECK (question_index >= 0),
                edge_id TEXT NOT NULL,
                position_fen TEXT NOT NULL,
                expected_uci TEXT NOT NULL,
                selected_uci TEXT NOT NULL,
                correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
                answered_at TEXT NOT NULL,
                UNIQUE (attempt_id, question_index),
                FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_exam_attempts_started ON exam_attempts(started_at DESC);
            CREATE INDEX idx_exam_attempts_repertoire ON exam_attempts(repertoire_id, started_at DESC);
            CREATE INDEX idx_exam_answers_attempt ON exam_answers(attempt_id, question_index);"
        )?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?1)",
            params![now_timestamp()],
        )?;
        transaction.commit()?;
    }
    let version_after_v4: i64 = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    if version_after_v4 < 5 {
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            "CREATE TABLE imported_games (
                id TEXT PRIMARY KEY NOT NULL,
                provider TEXT NOT NULL CHECK (provider IN ('chess_com', 'lichess')),
                source_username TEXT NOT NULL,
                source_game_id TEXT NOT NULL,
                pgn TEXT NOT NULL,
                white TEXT NOT NULL,
                black TEXT NOT NULL,
                played_at TEXT NOT NULL DEFAULT '',
                result TEXT NOT NULL DEFAULT '*',
                time_control TEXT NOT NULL DEFAULT '',
                opening TEXT NOT NULL DEFAULT '',
                source_url TEXT NOT NULL DEFAULT '',
                imported_at TEXT NOT NULL,
                UNIQUE (provider, source_game_id)
            );
            CREATE INDEX idx_imported_games_date
                ON imported_games(played_at DESC, imported_at DESC);
            CREATE INDEX idx_imported_games_provider_user
                ON imported_games(provider, source_username);"
        )?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?1)",
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

fn validate_input(input: &SaveRepertoireInput) -> Result<(), String> {
    if input.id.trim().is_empty() || input.id.len() > 160 {
        return Err("ID repertorio non valido.".into());
    }
    if input.title.trim().is_empty() || input.title.len() > 200 {
        return Err("Titolo repertorio non valido.".into());
    }
    if input.pgn.len() > 5_000_000 {
        return Err("PGN troppo grande.".into());
    }
    if input.tree.nodes.is_empty() || input.tree.nodes.len() > 100_000 {
        return Err("Albero delle posizioni vuoto o troppo grande.".into());
    }
    if input.tree.edges.len() > 500_000 {
        return Err("Albero delle mosse troppo grande.".into());
    }

    let mut ids = std::collections::HashSet::new();
    for node in &input.tree.nodes {
        if node.id.is_empty() || node.fen.is_empty() || !ids.insert(node.id.as_str()) {
            return Err("Nodo dell'albero non valido o duplicato.".into());
        }
    }
    if !ids.contains(input.tree.root_id.as_str()) {
        return Err("Nodo radice non trovato.".into());
    }
    let root = input.tree.nodes.iter().find(|node| node.id == input.tree.root_id);
    if root.map(|node| node.fen.as_str()) != Some(input.tree.root_fen.as_str()) {
        return Err("La FEN del nodo radice non coincide con la FEN iniziale.".into());
    }
    let mut edge_ids = std::collections::HashSet::new();
    for edge in &input.tree.edges {
        if edge.id.is_empty()
            || edge.uci.len() < 4
            || edge.uci.len() > 5
            || !ids.contains(edge.from.as_str())
            || !ids.contains(edge.to.as_str())
            || !edge_ids.insert(edge.id.as_str())
        {
            return Err("Arco dell'albero non valido o duplicato.".into());
        }
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

    transaction.execute(
        "DELETE FROM study_cards
         WHERE repertoire_id = ?1
           AND edge_id NOT IN (
             SELECT edge_id FROM repertoire_moves WHERE repertoire_id = ?1
           )",
        params![input.id],
    ).map_err(|error| error.to_string())?;

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
    save_with_connection(&mut connection, input)
}

#[tauri::command]
pub fn delete_repertoire(database: State<'_, Database>, id: String) -> Result<bool, String> {
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    let deleted = connection.execute("DELETE FROM repertoires WHERE id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    Ok(deleted > 0)
}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyCardRecord {
    pub id: String,
    pub repertoire_id: String,
    pub repertoire_title: String,
    pub edge_id: String,
    pub side: String,
    pub fen: String,
    pub uci: String,
    pub san: String,
    pub due_at: String,
    pub stability: f64,
    pub difficulty: f64,
    pub reps: i64,
    pub lapses: i64,
    pub state: String,
    pub fsrs_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyCardInput {
    pub id: String,
    pub repertoire_id: String,
    pub edge_id: String,
    pub side: String,
    pub due_at: String,
    pub stability: f64,
    pub difficulty: f64,
    pub reps: i64,
    pub lapses: i64,
    pub state: String,
    pub fsrs_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyReviewLogInput {
    pub id: String,
    pub card_id: String,
    pub session_id: Option<String>,
    pub rating: i64,
    pub reviewed_at: String,
    pub elapsed_ms: Option<i64>,
    pub scheduled_days: f64,
    pub state_json: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyReviewLogRecord {
    pub id: String,
    pub card_id: String,
    pub session_id: Option<String>,
    pub rating: i64,
    pub reviewed_at: String,
    pub elapsed_ms: Option<i64>,
    pub scheduled_days: f64,
    pub state_json: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordStudyReviewInput {
    pub card: StudyCardInput,
    pub review_log: StudyReviewLogInput,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingSessionInput {
    pub id: String,
    pub started_at: String,
    pub side: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishTrainingSessionInput {
    pub id: String,
    pub finished_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingSessionRecord {
    pub id: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub side: String,
    pub cards_reviewed: i64,
    pub correct_count: i64,
    pub again_count: i64,
}

#[tauri::command]
pub fn list_study_cards(database: State<'_, Database>) -> Result<Vec<StudyCardRecord>, String> {
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    let mut statement = connection.prepare(
        "SELECT c.id, c.repertoire_id, r.title, c.edge_id, c.side,
                p.fen, m.uci, m.san, c.due_at, c.stability, c.difficulty,
                c.reps, c.lapses, c.state, c.fsrs_json, c.created_at, c.updated_at
         FROM study_cards c
         JOIN repertoires r ON r.id = c.repertoire_id
         JOIN repertoire_moves m
           ON m.repertoire_id = c.repertoire_id AND m.edge_id = c.edge_id
         JOIN repertoire_positions p
           ON p.repertoire_id = m.repertoire_id AND p.position_id = m.from_position_id
         ORDER BY c.due_at ASC, c.updated_at DESC"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map([], |row| Ok(StudyCardRecord {
        id: row.get(0)?,
        repertoire_id: row.get(1)?,
        repertoire_title: row.get(2)?,
        edge_id: row.get(3)?,
        side: row.get(4)?,
        fen: row.get(5)?,
        uci: row.get(6)?,
        san: row.get(7)?,
        due_at: row.get(8)?,
        stability: row.get(9)?,
        difficulty: row.get(10)?,
        reps: row.get(11)?,
        lapses: row.get(12)?,
        state: row.get(13)?,
        fsrs_json: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
    })).map_err(|error| error.to_string())?;
    let records = rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(records)
}

#[tauri::command]
pub fn list_review_logs(database: State<'_, Database>) -> Result<Vec<StudyReviewLogRecord>, String> {
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    let mut statement = connection.prepare(
        "SELECT id, card_id, session_id, rating, reviewed_at, elapsed_ms, scheduled_days, state_json
         FROM review_logs ORDER BY reviewed_at DESC LIMIT 10000"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map([], |row| Ok(StudyReviewLogRecord {
        id: row.get(0)?,
        card_id: row.get(1)?,
        session_id: row.get(2)?,
        rating: row.get(3)?,
        reviewed_at: row.get(4)?,
        elapsed_ms: row.get(5)?,
        scheduled_days: row.get(6)?,
        state_json: row.get(7)?,
    })).map_err(|error| error.to_string())?;
    let records = rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(records)
}

fn list_training_sessions_with_connection(
    connection: &Connection,
) -> Result<Vec<TrainingSessionRecord>, String> {
    let mut statement = connection.prepare(
        "SELECT id, started_at, finished_at, side, cards_reviewed, correct_count, again_count
         FROM training_sessions ORDER BY started_at DESC LIMIT 100"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map([], |row| Ok(TrainingSessionRecord {
        id: row.get(0)?,
        started_at: row.get(1)?,
        finished_at: row.get(2)?,
        side: row.get(3)?,
        cards_reviewed: row.get(4)?,
        correct_count: row.get(5)?,
        again_count: row.get(6)?,
    })).map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_training_sessions(database: State<'_, Database>) -> Result<Vec<TrainingSessionRecord>, String> {
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    list_training_sessions_with_connection(&connection)
}

#[tauri::command]
pub fn start_training_session(
    database: State<'_, Database>,
    input: TrainingSessionInput,
) -> Result<bool, String> {
    if input.id.trim().is_empty() || !["white", "black", "both"].contains(&input.side.as_str()) {
        return Err("Sessione di ripasso non valida.".into());
    }
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    connection.execute(
        "INSERT INTO training_sessions (id, started_at, side) VALUES (?1, ?2, ?3)",
        params![input.id, input.started_at, input.side],
    ).map_err(|error| error.to_string())?;
    Ok(true)
}

fn record_study_review_with_connection(
    connection: &mut Connection,
    input: RecordStudyReviewInput,
) -> Result<bool, String> {
    let card = input.card;
    let log = input.review_log;
    if card.id.trim().is_empty()
        || card.repertoire_id.trim().is_empty()
        || card.edge_id.trim().is_empty()
        || !["white", "black"].contains(&card.side.as_str())
        || log.card_id != card.id
        || !(1..=4).contains(&log.rating)
        || !card.stability.is_finite()
        || !card.difficulty.is_finite()
        || !log.scheduled_days.is_finite()
    {
        return Err("Dati del ripasso non validi.".into());
    }

    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    transaction.execute(
        "INSERT INTO study_cards
            (id, repertoire_id, edge_id, side, due_at, stability, difficulty,
             reps, lapses, state, created_at, updated_at, fsrs_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(id) DO UPDATE SET
            repertoire_id = excluded.repertoire_id,
            edge_id = excluded.edge_id,
            side = excluded.side,
            due_at = excluded.due_at,
            stability = excluded.stability,
            difficulty = excluded.difficulty,
            reps = excluded.reps,
            lapses = excluded.lapses,
            state = excluded.state,
            updated_at = excluded.updated_at,
            fsrs_json = excluded.fsrs_json",
        params![
            card.id, card.repertoire_id, card.edge_id, card.side, card.due_at,
            card.stability, card.difficulty, card.reps, card.lapses, card.state,
            card.created_at, card.updated_at, card.fsrs_json
        ],
    ).map_err(|error| error.to_string())?;

    transaction.execute(
        "INSERT INTO review_logs
            (id, card_id, session_id, rating, reviewed_at, elapsed_ms, scheduled_days, state_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            log.id, log.card_id, log.session_id, log.rating, log.reviewed_at,
            log.elapsed_ms, log.scheduled_days, log.state_json
        ],
    ).map_err(|error| error.to_string())?;

    if let Some(session_id) = log.session_id.as_deref() {
        let recalled = serde_json::from_str::<serde_json::Value>(&log.state_json)
            .ok()
            .and_then(|metadata| metadata.get("recalled").and_then(serde_json::Value::as_bool))
            .unwrap_or(log.rating > 1);
        let updated = transaction.execute(
            "UPDATE training_sessions
             SET cards_reviewed = cards_reviewed + 1,
                 correct_count = correct_count + ?1,
                 again_count = again_count + ?2
             WHERE id = ?3",
            params![if recalled { 1 } else { 0 }, if log.rating == 1 { 1 } else { 0 }, session_id],
        ).map_err(|error| error.to_string())?;
        if updated != 1 {
            return Err("La sessione di ripasso non esiste più.".into());
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn record_study_review(
    database: State<'_, Database>,
    input: RecordStudyReviewInput,
) -> Result<bool, String> {
    let mut connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    record_study_review_with_connection(&mut connection, input)
}

#[tauri::command]
pub fn finish_training_session(
    database: State<'_, Database>,
    input: FinishTrainingSessionInput,
) -> Result<bool, String> {
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    let updated = connection.execute(
        "UPDATE training_sessions SET finished_at = COALESCE(finished_at, ?1) WHERE id = ?2",
        params![input.finished_at, input.id],
    ).map_err(|error| error.to_string())?;
    if updated != 1 {
        return Err("La sessione di ripasso non esiste.".into());
    }
    Ok(true)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyGoalRecord {
    pub period: String,
    pub target_reviews: i64,
    pub target_minutes: i64,
    pub target_accuracy: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveStudyGoalInput {
    pub period: String,
    pub target_reviews: i64,
    pub target_minutes: i64,
    pub target_accuracy: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExamAttemptRecord {
    pub id: String,
    pub repertoire_id: String,
    pub repertoire_title: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub total_questions: i64,
    pub correct_count: i64,
    pub pass_threshold: i64,
    pub passed: bool,
    pub side: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartExamInput {
    pub id: String,
    pub repertoire_id: String,
    pub repertoire_title: String,
    pub started_at: String,
    pub total_questions: i64,
    pub pass_threshold: i64,
    pub side: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordExamAnswerInput {
    pub id: String,
    pub attempt_id: String,
    pub question_index: i64,
    pub edge_id: String,
    pub position_fen: String,
    pub expected_uci: String,
    pub selected_uci: String,
    pub answered_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishExamInput {
    pub id: String,
    pub finished_at: String,
    pub aborted: bool,
}

fn save_study_goal_with_connection(
    connection: &mut Connection,
    input: SaveStudyGoalInput,
) -> Result<StudyGoalRecord, String> {
    if !["daily", "weekly"].contains(&input.period.as_str())
        || !(1..=10000).contains(&input.target_reviews)
        || !(1..=10000).contains(&input.target_minutes)
        || !(1..=100).contains(&input.target_accuracy)
    {
        return Err("Obiettivo di studio non valido.".into());
    }
    let updated_at = now_timestamp();
    connection.execute(
        "INSERT INTO study_goals
            (period, target_reviews, target_minutes, target_accuracy, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(period) DO UPDATE SET
            target_reviews = excluded.target_reviews,
            target_minutes = excluded.target_minutes,
            target_accuracy = excluded.target_accuracy,
            updated_at = excluded.updated_at",
        params![
            input.period, input.target_reviews, input.target_minutes,
            input.target_accuracy, updated_at
        ],
    ).map_err(|error| error.to_string())?;
    Ok(StudyGoalRecord {
        period: input.period,
        target_reviews: input.target_reviews,
        target_minutes: input.target_minutes,
        target_accuracy: input.target_accuracy,
        updated_at,
    })
}

#[tauri::command]
pub fn list_study_goals(database: State<'_, Database>) -> Result<Vec<StudyGoalRecord>, String> {
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    let mut statement = connection.prepare(
        "SELECT period, target_reviews, target_minutes, target_accuracy, updated_at
         FROM study_goals ORDER BY CASE period WHEN 'daily' THEN 0 ELSE 1 END"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map([], |row| Ok(StudyGoalRecord {
        period: row.get(0)?,
        target_reviews: row.get(1)?,
        target_minutes: row.get(2)?,
        target_accuracy: row.get(3)?,
        updated_at: row.get(4)?,
    })).map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_study_goal(
    database: State<'_, Database>,
    input: SaveStudyGoalInput,
) -> Result<StudyGoalRecord, String> {
    let mut connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    save_study_goal_with_connection(&mut connection, input)
}

fn start_exam_with_connection(
    connection: &mut Connection,
    input: StartExamInput,
) -> Result<bool, String> {
    if input.id.trim().is_empty()
        || input.repertoire_id.trim().is_empty()
        || input.repertoire_title.trim().is_empty()
        || !(1..=500).contains(&input.total_questions)
        || !(1..=100).contains(&input.pass_threshold)
        || !["white", "black", "both"].contains(&input.side.as_str())
    {
        return Err("Configurazione esame non valida.".into());
    }
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM repertoires WHERE id = ?1)",
        params![input.repertoire_id],
        |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    if !exists {
        return Err("Il repertorio selezionato non esiste più.".into());
    }
    connection.execute(
        "INSERT INTO exam_attempts
            (id, repertoire_id, repertoire_title, started_at, total_questions,
             pass_threshold, side, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'in_progress')",
        params![
            input.id, input.repertoire_id, input.repertoire_title, input.started_at,
            input.total_questions, input.pass_threshold, input.side
        ],
    ).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn start_exam(
    database: State<'_, Database>,
    input: StartExamInput,
) -> Result<bool, String> {
    let mut connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    start_exam_with_connection(&mut connection, input)
}

fn record_exam_answer_with_connection(
    connection: &mut Connection,
    input: RecordExamAnswerInput,
) -> Result<bool, String> {
    if input.id.trim().is_empty()
        || input.attempt_id.trim().is_empty()
        || input.question_index < 0
        || input.edge_id.trim().is_empty()
        || input.position_fen.trim().is_empty()
        || input.expected_uci.trim().is_empty()
        || input.selected_uci.trim().is_empty()
    {
        return Err("Risposta d'esame non valida.".into());
    }
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    let attempt: Option<(i64, String, String)> = transaction.query_row(
        "SELECT total_questions, status, repertoire_id FROM exam_attempts WHERE id = ?1",
        params![input.attempt_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional().map_err(|error| error.to_string())?;
    let Some((total_questions, status, repertoire_id)) = attempt else {
        return Err("Sessione d'esame non trovata.".into());
    };
    if status != "in_progress" || input.question_index >= total_questions {
        return Err("La sessione d'esame non accetta altre risposte.".into());
    }
    let previous_answers: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM exam_answers WHERE attempt_id = ?1",
        params![input.attempt_id],
        |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    if previous_answers != input.question_index {
        return Err("Le risposte dell'esame devono essere registrate in ordine.".into());
    }
    let expected_position: Option<String> = transaction.query_row(
        "SELECT p.fen
         FROM repertoire_moves m
         JOIN repertoire_positions p
           ON p.repertoire_id = m.repertoire_id
          AND p.position_id = m.from_position_id
         WHERE m.repertoire_id = ?1 AND m.edge_id = ?2 AND m.uci = ?3",
        params![repertoire_id, input.edge_id, input.expected_uci],
        |row| row.get(0),
    ).optional().map_err(|error| error.to_string())?;
    if expected_position.as_deref() != Some(input.position_fen.as_str()) {
        return Err("La domanda non corrisponde al repertorio selezionato.".into());
    }
    let correct = input.expected_uci == input.selected_uci;
    transaction.execute(
        "INSERT INTO exam_answers
            (id, attempt_id, question_index, edge_id, position_fen,
             expected_uci, selected_uci, correct, answered_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            input.id, input.attempt_id, input.question_index, input.edge_id,
            input.position_fen, input.expected_uci, input.selected_uci,
            if correct { 1 } else { 0 }, input.answered_at
        ],
    ).map_err(|error| error.to_string())?;
    let updated = transaction.execute(
        "UPDATE exam_attempts SET correct_count = correct_count + ?1
         WHERE id = ?2 AND status = 'in_progress'",
        params![if correct { 1 } else { 0 }, input.attempt_id],
    ).map_err(|error| error.to_string())?;
    if updated != 1 {
        return Err("La sessione d'esame non è più attiva.".into());
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(correct)
}

#[tauri::command]
pub fn record_exam_answer(
    database: State<'_, Database>,
    input: RecordExamAnswerInput,
) -> Result<bool, String> {
    let mut connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    record_exam_answer_with_connection(&mut connection, input)
}

fn finish_exam_with_connection(
    connection: &mut Connection,
    input: FinishExamInput,
) -> Result<bool, String> {
    if input.id.trim().is_empty() || input.finished_at.trim().is_empty() {
        return Err("Chiusura esame non valida.".into());
    }
    let status = if input.aborted { "aborted" } else { "completed" };
    if !input.aborted {
        let counts: Option<(i64, i64)> = connection.query_row(
            "SELECT a.total_questions,
                    (SELECT COUNT(*) FROM exam_answers WHERE attempt_id = a.id)
             FROM exam_attempts a
             WHERE a.id = ?1 AND a.status = 'in_progress'",
            params![input.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|error| error.to_string())?;
        let Some((total_questions, answers_recorded)) = counts else {
            return Ok(false);
        };
        if answers_recorded != total_questions {
            return Err("Non è possibile concludere un esame con domande senza risposta.".into());
        }
    }
    let updated = connection.execute(
        "UPDATE exam_attempts
         SET finished_at = ?1,
             status = ?2,
             passed = CASE
                 WHEN ?2 = 'completed'
                  AND correct_count * 100 >= total_questions * pass_threshold THEN 1
                 ELSE 0
             END
         WHERE id = ?3 AND status = 'in_progress'",
        params![input.finished_at, status, input.id],
    ).map_err(|error| error.to_string())?;
    Ok(updated == 1)
}

#[tauri::command]
pub fn finish_exam(
    database: State<'_, Database>,
    input: FinishExamInput,
) -> Result<bool, String> {
    let mut connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    finish_exam_with_connection(&mut connection, input)
}

#[tauri::command]
pub fn list_exam_attempts(database: State<'_, Database>) -> Result<Vec<ExamAttemptRecord>, String> {
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    let mut statement = connection.prepare(
        "SELECT id, repertoire_id, repertoire_title, started_at, finished_at,
                total_questions, correct_count, pass_threshold, passed, side, status
         FROM exam_attempts ORDER BY started_at DESC LIMIT 50"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map([], |row| Ok(ExamAttemptRecord {
        id: row.get(0)?,
        repertoire_id: row.get(1)?,
        repertoire_title: row.get(2)?,
        started_at: row.get(3)?,
        finished_at: row.get(4)?,
        total_questions: row.get(5)?,
        correct_count: row.get(6)?,
        pass_threshold: row.get(7)?,
        passed: row.get::<_, i64>(8)? != 0,
        side: row.get(9)?,
        status: row.get(10)?,
    })).map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
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
    fn migrations_are_versioned_and_idempotent() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(&mut connection).unwrap();
        migrate(&mut connection).unwrap();
        let version: i64 = connection.query_row(
            "SELECT MAX(version) FROM schema_migrations", [], |row| row.get(0)
        ).unwrap();
        assert_eq!(version, 5);
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

    fn sample_review(session_id: Option<&str>, log_id: &str) -> RecordStudyReviewInput {
        RecordStudyReviewInput {
            card: StudyCardInput {
                id: "open-game::root|e2e4".into(),
                repertoire_id: "open-game".into(),
                edge_id: "root|e2e4".into(),
                side: "white".into(),
                due_at: "2026-11-03T12:10:00.000Z".into(),
                stability: 0.5,
                difficulty: 5.0,
                reps: 1,
                lapses: 0,
                state: "learning".into(),
                fsrs_json: r#"{"reps":1,"state":1}"#.into(),
                created_at: "2026-11-03T12:00:00.000Z".into(),
                updated_at: "2026-11-03T12:00:00.000Z".into(),
            },
            review_log: StudyReviewLogInput {
                id: log_id.into(),
                card_id: "open-game::root|e2e4".into(),
                session_id: session_id.map(str::to_string),
                rating: 3,
                reviewed_at: "2026-11-03T12:00:00.000Z".into(),
                elapsed_ms: Some(4200),
                scheduled_days: 0.01,
                state_json: r#"{"recalled":true}"#.into(),
            },
        }
    }

    #[test]
    fn study_review_persists_card_log_and_session_counters_together() {
        let mut connection = memory_db();
        save_with_connection(&mut connection, fixture()).unwrap();
        connection.execute(
            "INSERT INTO training_sessions (id, started_at, side) VALUES ('session-1', '2026-11-03T11:59:00.000Z', 'white')",
            [],
        ).unwrap();

        record_study_review_with_connection(
            &mut connection,
            sample_review(Some("session-1"), "review-1"),
        ).unwrap();

        let card_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM study_cards WHERE id = 'open-game::root|e2e4'",
            [],
            |row| row.get(0),
        ).unwrap();
        let log_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM review_logs WHERE id = 'review-1'",
            [],
            |row| row.get(0),
        ).unwrap();
        let counters: (i64, i64, i64) = connection.query_row(
            "SELECT cards_reviewed, correct_count, again_count FROM training_sessions WHERE id = 'session-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();

        assert_eq!(card_count, 1);
        assert_eq!(log_count, 1);
        assert_eq!(counters, (1, 1, 0));
    }

    #[test]
    fn failed_review_log_rolls_back_the_card_write() {
        let mut connection = memory_db();
        save_with_connection(&mut connection, fixture()).unwrap();

        let result = record_study_review_with_connection(
            &mut connection,
            sample_review(Some("missing-session"), "review-orphan"),
        );
        assert!(result.is_err());

        let card_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM study_cards",
            [],
            |row| row.get(0),
        ).unwrap();
        let log_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM review_logs",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(card_count, 0);
        assert_eq!(log_count, 0);
    }

    #[test]
    fn list_training_sessions_returns_saved_review_statistics() {
        let mut connection = memory_db();
        connection.execute(
            "INSERT INTO training_sessions (id, started_at, finished_at, side, cards_reviewed, correct_count, again_count)
             VALUES ('session-history', '2026-11-02T10:00:00.000Z', '2026-11-02T10:05:00.000Z', 'black', 8, 6, 2)",
            [],
        ).unwrap();
        let sessions = list_training_sessions_with_connection(&connection).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "session-history");
        assert_eq!(sessions[0].side, "black");
        assert_eq!(sessions[0].finished_at.as_deref(), Some("2026-11-02T10:05:00.000Z"));
        assert_eq!(
            (sessions[0].cards_reviewed, sessions[0].correct_count, sessions[0].again_count),
            (8, 6, 2),
        );
    }

    #[test]
    fn exam_answer_rejects_a_question_not_in_the_selected_repertoire() {
        let mut connection = memory_db();
        save_with_connection(&mut connection, fixture()).unwrap();
        start_exam_with_connection(&mut connection, StartExamInput {
            id: "exam-secure".into(),
            repertoire_id: "open-game".into(),
            repertoire_title: "Open Game".into(),
            started_at: "2026-11-03T10:00:00Z".into(),
            total_questions: 1,
            pass_threshold: 70,
            side: "white".into(),
        }).unwrap();

        let tampered = record_exam_answer_with_connection(&mut connection, RecordExamAnswerInput {
            id: "answer-tampered".into(),
            attempt_id: "exam-secure".into(),
            question_index: 0,
            edge_id: "root|e2e4".into(),
            position_fen: "8/8/8/8/8/8/8/8 w - - 0 1".into(),
            expected_uci: "e2e4".into(),
            selected_uci: "e2e4".into(),
            answered_at: "2026-11-03T10:01:00Z".into(),
        });
        assert!(tampered.is_err());
        let answers: i64 = connection.query_row(
            "SELECT COUNT(*) FROM exam_answers WHERE attempt_id = 'exam-secure'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(answers, 0);

        let skipped = record_exam_answer_with_connection(&mut connection, RecordExamAnswerInput {
            id: "answer-skipped".into(),
            attempt_id: "exam-secure".into(),
            question_index: 1,
            edge_id: "root|e2e4".into(),
            position_fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".into(),
            expected_uci: "e2e4".into(),
            selected_uci: "e2e4".into(),
            answered_at: "2026-11-03T10:02:00Z".into(),
        });
        assert!(skipped.is_err());
    }

    #[test]
    fn goals_and_exam_attempts_persist_and_score() {
        let mut connection = memory_db();
        save_with_connection(&mut connection, fixture()).unwrap();

        let goal = save_study_goal_with_connection(&mut connection, SaveStudyGoalInput {
            period: "daily".into(),
            target_reviews: 25,
            target_minutes: 30,
            target_accuracy: 85,
        }).unwrap();
        assert_eq!(goal.target_reviews, 25);

        start_exam_with_connection(&mut connection, StartExamInput {
            id: "exam-1".into(),
            repertoire_id: "open-game".into(),
            repertoire_title: "Open Game".into(),
            started_at: "2026-11-03T10:00:00Z".into(),
            total_questions: 1,
            pass_threshold: 70,
            side: "white".into(),
        }).unwrap();

        record_exam_answer_with_connection(&mut connection, RecordExamAnswerInput {
            id: "answer-1".into(),
            attempt_id: "exam-1".into(),
            question_index: 0,
            edge_id: "root|e2e4".into(),
            position_fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".into(),
            expected_uci: "e2e4".into(),
            selected_uci: "e2e4".into(),
            answered_at: "2026-11-03T10:01:00Z".into(),
        }).unwrap();

        finish_exam_with_connection(&mut connection, FinishExamInput {
            id: "exam-1".into(),
            finished_at: "2026-11-03T10:02:00Z".into(),
            aborted: false,
        }).unwrap();

        let (correct, passed, status): (i64, i64, String) = connection.query_row(
            "SELECT correct_count, passed, status FROM exam_attempts WHERE id = 'exam-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!(correct, 1);
        assert_eq!(passed, 1);
        assert_eq!(status, "completed");

        let duplicate = record_exam_answer_with_connection(&mut connection, RecordExamAnswerInput {
            id: "answer-duplicate".into(),
            attempt_id: "exam-1".into(),
            question_index: 0,
            edge_id: "root|e2e4".into(),
            position_fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".into(),
            expected_uci: "e2e4".into(),
            selected_uci: "e2e4".into(),
            answered_at: "2026-11-03T10:03:00Z".into(),
        });
        assert!(duplicate.is_err());
    }

    #[test]
    fn completed_exam_requires_all_questions_to_be_answered() {
        let mut connection = memory_db();
        save_with_connection(&mut connection, fixture()).unwrap();
        start_exam_with_connection(&mut connection, StartExamInput {
            id: "exam-incomplete".into(),
            repertoire_id: "open-game".into(),
            repertoire_title: "Open Game".into(),
            started_at: "2026-11-03T10:00:00Z".into(),
            total_questions: 2,
            pass_threshold: 70,
            side: "white".into(),
        }).unwrap();
        assert!(finish_exam_with_connection(&mut connection, FinishExamInput {
            id: "exam-incomplete".into(),
            finished_at: "2026-11-03T10:01:00Z".into(),
            aborted: false,
        }).is_err());
        let status: String = connection.query_row(
            "SELECT status FROM exam_attempts WHERE id = 'exam-incomplete'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(status, "in_progress");
        assert!(finish_exam_with_connection(&mut connection, FinishExamInput {
            id: "exam-incomplete".into(),
            finished_at: "2026-11-03T10:02:00Z".into(),
            aborted: true,
        }).unwrap());
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
