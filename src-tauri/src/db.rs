use rusqlite::{params, Connection, OptionalExtension, Transaction};
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

pub fn open_database(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection.busy_timeout(std::time::Duration::from_secs(5)).map_err(|error| error.to_string())?;
    connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;").map_err(|error| error.to_string())?;
    migrate(&mut connection).map_err(|error| error.to_string())?;
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
        let node_order: std::collections::HashMap<&str, usize> = input.tree.nodes
            .iter().enumerate().map(|(index, node)| (node.id.as_str(), index)).collect();
        for edge in &input.tree.edges {
            let nags = serde_json::to_string(&edge.nags).map_err(|error| error.to_string())?;
            let order = *node_order.get(edge.from.as_str()).unwrap_or(&0);
            statement.execute(params![
                input.id, edge.id, edge.from, edge.to, edge.uci, edge.san, nags, edge.comment, order
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
        "SELECT edge_id, from_position_id, to_position_id, uci, san, nags_json, comment
         FROM repertoire_moves WHERE repertoire_id = ?1 ORDER BY sort_order, edge_id"
    ).map_err(|error| error.to_string())?;
    let edges = edges_statement.query_map(params![id], |row| {
        let nags_json: String = row.get(5)?;
        let nags = serde_json::from_str(&nags_json).unwrap_or_default();
        Ok(MoveEdge {
            id: row.get(0)?, from: row.get(1)?, to: row.get(2)?,
            uci: row.get(3)?, san: row.get(4)?, nags, comment: row.get(6)?
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
                    PositionNode { id: root_id.clone(), key: "initial".into(), fen: root_fen },
                    PositionNode { id: child_id.clone(), key: "after-e4".into(), fen: after_e4 },
                ],
                edges: vec![MoveEdge {
                    id: "root|e2e4".into(), from: root_id, to: child_id,
                    uci: "e2e4".into(), san: "e4".into(), nags: vec![], comment: "".into(),
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
        assert_eq!(rows[0].sans, vec!["e4"]);
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
