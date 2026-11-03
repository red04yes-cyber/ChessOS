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
pub struct RestoreReviewDataInput {
    #[serde(default)]
    pub cards: Vec<StudyCardInput>,
    #[serde(default)]
    pub logs: Vec<StudyReviewLogInput>,
    #[serde(default)]
    pub sessions: Vec<TrainingSessionRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishTrainingSessionInput {
    pub id: String,
    pub finished_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[tauri::command]
pub fn get_app_setting(database: State<'_, Database>, key: String) -> Result<Option<String>, String> {
    if key.trim().is_empty() || key.len() > 200 {
        return Err("Chiave impostazione non valida.".into());
    }
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    connection.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    ).optional().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_app_setting(database: State<'_, Database>, key: String, value: String) -> Result<bool, String> {
    if key.trim().is_empty() || key.len() > 200 || value.len() > 20_000_000 {
        return Err("Impostazione non valida o troppo grande.".into());
    }
    let connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    connection.execute(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, now_timestamp()],
    ).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn restore_review_data(
    database: State<'_, Database>,
    input: RestoreReviewDataInput,
) -> Result<bool, String> {
    if input.cards.len() > 100_000 || input.logs.len() > 500_000 || input.sessions.len() > 100_000 {
        return Err("Il backup supera il numero massimo di record di ripasso.".into());
    }
    for card in &input.cards {
        if card.id.trim().is_empty() || card.repertoire_id.trim().is_empty()
            || card.edge_id.trim().is_empty() || !["white", "black"].contains(&card.side.as_str())
            || !card.stability.is_finite() || !card.difficulty.is_finite()
        {
            return Err("Il backup contiene una flashcard FSRS non valida.".into());
        }
    }
    for log in &input.logs {
        if log.id.trim().is_empty() || log.card_id.trim().is_empty()
            || !(1..=4).contains(&log.rating) || !log.scheduled_days.is_finite()
        {
            return Err("Il backup contiene un log FSRS non valido.".into());
        }
    }
    for session in &input.sessions {
        if session.id.trim().is_empty() || !["white", "black", "both"].contains(&session.side.as_str()) {
            return Err("Il backup contiene una sessione non valida.".into());
        }
    }

    let mut connection = database.0.lock().map_err(|_| "Database non disponibile.".to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;

    {
        let mut statement = transaction.prepare(
            "INSERT INTO training_sessions
             (id, started_at, finished_at, side, cards_reviewed, correct_count, again_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               started_at=excluded.started_at, finished_at=excluded.finished_at,
               side=excluded.side, cards_reviewed=excluded.cards_reviewed,
               correct_count=excluded.correct_count, again_count=excluded.again_count"
        ).map_err(|error| error.to_string())?;
        for session in &input.sessions {
            statement.execute(params![
                session.id, session.started_at, session.finished_at, session.side,
                session.cards_reviewed, session.correct_count, session.again_count
            ]).map_err(|error| error.to_string())?;
        }
    }
    {
        let mut statement = transaction.prepare(
            "INSERT INTO study_cards
             (id, repertoire_id, edge_id, side, due_at, stability, difficulty, reps,
              lapses, state, created_at, updated_at, fsrs_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET
               repertoire_id=excluded.repertoire_id, edge_id=excluded.edge_id,
               side=excluded.side, due_at=excluded.due_at, stability=excluded.stability,
               difficulty=excluded.difficulty, reps=excluded.reps, lapses=excluded.lapses,
               state=excluded.state, updated_at=excluded.updated_at, fsrs_json=excluded.fsrs_json"
        ).map_err(|error| error.to_string())?;
        for card in &input.cards {
            statement.execute(params![
                card.id, card.repertoire_id, card.edge_id, card.side, card.due_at,
                card.stability, card.difficulty, card.reps, card.lapses, card.state,
                card.created_at, card.updated_at, card.fsrs_json
            ]).map_err(|error| error.to_string())?;
        }
    }
    {
        let mut statement = transaction.prepare(
            "INSERT INTO review_logs
             (id, card_id, session_id, rating, reviewed_at, elapsed_ms, scheduled_days, state_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               card_id=excluded.card_id, session_id=excluded.session_id, rating=excluded.rating,
               reviewed_at=excluded.reviewed_at, elapsed_ms=excluded.elapsed_ms,
               scheduled_days=excluded.scheduled_days, state_json=excluded.state_json"
        ).map_err(|error| error.to_string())?;
        for log in &input.logs {
            statement.execute(params![
                log.id, log.card_id, log.session_id, log.rating, log.reviewed_at,
                log.elapsed_ms, log.scheduled_days, log.state_json
            ]).map_err(|error| error.to_string())?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(true)
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
        assert_eq!(version, 3);
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
