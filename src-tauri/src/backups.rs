use rusqlite::backup::Backup;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

use crate::db::Database;

const REQUIRED_SCHEMA_VERSION: i64 = 5;
const BACKUP_PREFIX: &str = "chessos-backup-";
const PRE_RESTORE_PREFIX: &str = "chessos-pre-restore-";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    pub name: String,
    pub created_at: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupVerification {
    pub name: String,
    pub schema_version: i64,
    pub integrity_check: String,
    pub foreign_key_check: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub restored_from: String,
    pub safety_backup: BackupRecord,
}

fn now_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn backup_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    Ok(app_data.join("backups"))
}

fn is_safe_backup_name(name: &str) -> bool {
    (name.starts_with(BACKUP_PREFIX) || name.starts_with(PRE_RESTORE_PREFIX))
        && name.ends_with(".sqlite3")
        && name.len() <= 128
        && name.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '.'
        })
        && Path::new(name).file_name().and_then(|value| value.to_str()) == Some(name)
}

fn backup_path(directory: &Path, name: &str) -> Result<PathBuf, String> {
    if !is_safe_backup_name(name) {
        return Err("Nome del backup non valido.".into());
    }
    let path = directory.join(name);
    let metadata = fs::metadata(&path).map_err(|_| "Backup non trovato.".to_string())?;
    if !metadata.is_file() {
        return Err("Il backup selezionato non è un file.".into());
    }
    Ok(path)
}

fn verify_database(connection: &Connection) -> Result<i64, String> {
    let mut quick_check = connection
        .prepare("PRAGMA quick_check")
        .map_err(|error| format!("Controllo SQLite non disponibile: {error}"))?;
    let checks = quick_check
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if checks.len() != 1 || checks[0] != "ok" {
        return Err(format!(
            "Integrità SQLite non valida: {}",
            checks.join("; ")
        ));
    }

    let mut foreign_keys = connection
        .prepare("PRAGMA foreign_key_check")
        .map_err(|error| error.to_string())?;
    let mut violations = foreign_keys.query([]).map_err(|error| error.to_string())?;
    if violations.next().map_err(|error| error.to_string())?.is_some() {
        return Err("Il backup contiene riferimenti tra tabelle non validi.".into());
    }

    let schema_version = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|_| "Il file non contiene lo schema SQLite di ChessOS.".to_string())?;
    if schema_version != REQUIRED_SCHEMA_VERSION {
        return Err(format!(
            "Versione dello schema non supportata ({}; attesa {}).",
            schema_version, REQUIRED_SCHEMA_VERSION
        ));
    }

    let expected_tables = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
             WHERE type = 'table' AND name IN (
                 'schema_migrations', 'repertoires', 'repertoire_positions',
                 'repertoire_moves', 'app_settings', 'study_cards',
                 'training_sessions', 'review_logs', 'study_goals',
                 'exam_attempts', 'exam_answers', 'imported_games'
             )",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    if expected_tables != 12 {
        return Err("Il database non contiene tutte le tabelle richieste da ChessOS.".into());
    }

    let mut columns = connection
        .prepare("PRAGMA table_info(study_cards)")
        .map_err(|error| error.to_string())?;
    let has_fsrs_state = columns
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?
        .iter()
        .any(|column| column == "fsrs_json");
    if !has_fsrs_state {
        return Err("Il database non contiene lo stato FSRS completo.".into());
    }

    Ok(schema_version)
}

fn reserve_backup_path(directory: &Path, purpose: &str) -> Result<(String, PathBuf), String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let prefix = match purpose {
        "backup" => BACKUP_PREFIX,
        "pre-restore" => PRE_RESTORE_PREFIX,
        _ => return Err("Tipo di backup non valido.".into()),
    };
    let timestamp = now_millis();

    for suffix in 0..10_000_u32 {
        let name = format!("{prefix}{timestamp}-{suffix}.sqlite3");
        let path = directory.join(&name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => {
                drop(file);
                return Ok((name, path));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Impossibile creare il backup: {error}")),
        }
    }

    Err("Impossibile assegnare un nome univoco al backup.".into())
}

fn copy_database(source: &Connection, destination: &mut Connection) -> Result<(), String> {
    let backup = Backup::new(source, destination).map_err(|error| error.to_string())?;
    backup
        .run_to_completion(128, Duration::from_millis(10), None)
        .map_err(|error| error.to_string())
}

fn create_snapshot(
    source: &Connection,
    directory: &Path,
    purpose: &str,
) -> Result<BackupRecord, String> {
    verify_database(source)?;
    let (name, path) = reserve_backup_path(directory, purpose)?;

    let result = (|| -> Result<(), String> {
        let mut destination = Connection::open(&path).map_err(|error| error.to_string())?;
        copy_database(source, &mut destination)?;
        verify_database(&destination)?;
        drop(destination);
        OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .and_then(|file| file.sync_all())
            .map_err(|error| error.to_string())?;
        Ok(())
    })();

    if let Err(error) = result {
        let _ = fs::remove_file(&path);
        return Err(error);
    }

    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    let created_at = name
        .strip_prefix(BACKUP_PREFIX)
        .or_else(|| name.strip_prefix(PRE_RESTORE_PREFIX))
        .and_then(|value| value.split('-').next())
        .unwrap_or_default()
        .to_string();

    Ok(BackupRecord {
        name,
        created_at,
        size_bytes: metadata.len(),
    })
}

fn open_and_verify(path: &Path, name: &str) -> Result<BackupVerification, String> {
    let source = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Impossibile aprire il backup: {error}"))?;
    let schema_version = verify_database(&source)?;
    Ok(BackupVerification {
        name: name.to_string(),
        schema_version,
        integrity_check: "ok".into(),
        foreign_key_check: "ok".into(),
    })
}

fn backup_record(path: &Path) -> Result<BackupRecord, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Nome backup non valido.".to_string())?
        .to_string();
    let created_at = name
        .strip_prefix(BACKUP_PREFIX)
        .or_else(|| name.strip_prefix(PRE_RESTORE_PREFIX))
        .and_then(|value| value.split('-').next())
        .map(str::to_string)
        .or_else(|| {
            metadata
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()
                .map(|duration| duration.as_millis().to_string())
        })
        .unwrap_or_default();

    Ok(BackupRecord {
        name,
        created_at,
        size_bytes: metadata.len(),
    })
}

#[tauri::command]
pub fn create_database_backup(
    app: AppHandle,
    database: State<'_, Database>,
) -> Result<BackupRecord, String> {
    let directory = backup_directory(&app)?;
    let connection = database
        .0
        .lock()
        .map_err(|_| "Database non disponibile.".to_string())?;
    create_snapshot(&connection, &directory, "backup")
}

#[tauri::command]
pub fn list_database_backups(app: AppHandle) -> Result<Vec<BackupRecord>, String> {
    let directory = backup_directory(&app)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }

    let mut records = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.file_type().map_err(|error| error.to_string())?.is_file() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !is_safe_backup_name(&name) {
            continue;
        }
        records.push(backup_record(&entry.path())?);
    }
    records.sort_by(|left, right| right.name.cmp(&left.name));
    Ok(records)
}

#[tauri::command]
pub fn verify_database_backup(
    app: AppHandle,
    name: String,
) -> Result<BackupVerification, String> {
    let directory = backup_directory(&app)?;
    let path = backup_path(&directory, &name)?;
    open_and_verify(&path, &name)
}

#[tauri::command]
pub fn restore_database_backup(
    app: AppHandle,
    database: State<'_, Database>,
    name: String,
) -> Result<RestoreResult, String> {
    let directory = backup_directory(&app)?;
    let selected_path = backup_path(&directory, &name)?;
    let selected = Connection::open_with_flags(
        &selected_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|error| format!("Impossibile aprire il backup: {error}"))?;
    verify_database(&selected)?;

    let mut destination = database
        .0
        .lock()
        .map_err(|_| "Database non disponibile.".to_string())?;
    let safety_backup = create_snapshot(&destination, &directory, "pre-restore")?;
    let safety_path = backup_path(&directory, &safety_backup.name)?;

    let restore_result = copy_database(&selected, &mut destination)
        .and_then(|_| verify_database(&destination).map(|_| ()))
        .and_then(|_| {
            destination
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                .map_err(|error| error.to_string())
        });

    if let Err(error) = restore_result {
        let rollback = Connection::open_with_flags(
            &safety_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|rollback_error| rollback_error.to_string())
        .and_then(|safety_source| copy_database(&safety_source, &mut destination))
        .and_then(|_| verify_database(&destination).map(|_| ()));
        return match rollback {
            Ok(()) => Err(format!(
                "Ripristino annullato: {error}. Il database precedente è stato ripristinato; copia conservata: {}",
                safety_backup.name
            )),
            Err(rollback_error) => Err(format!(
                "Ripristino non riuscito ({error}) e recupero automatico non riuscito ({rollback_error}). Conserva la copia: {}",
                safety_backup.name
            )),
        };
    }

    Ok(RestoreResult {
        restored_from: name,
        safety_backup,
    })
}

#[tauri::command]
pub fn delete_database_backup(app: AppHandle, name: String) -> Result<bool, String> {
    let directory = backup_directory(&app)?;
    let path = backup_path(&directory, &name)?;
    fs::remove_file(path).map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn memory_database() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        db::migrate(&mut connection).unwrap();
        connection
    }

    fn temporary_directory(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "chessos-{label}-{}-{}",
            std::process::id(),
            now_millis()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn insert_backup_fixtures(connection: &Connection) {
        connection.execute(
            "INSERT INTO repertoires (id, title, root_fen, pgn, created_at, updated_at)
             VALUES ('repo-1', 'Test', 'fen', '1. e4 *', '1', '1')",
            [],
        ).unwrap();
        connection.execute(
            "INSERT INTO study_cards
                (id, repertoire_id, edge_id, side, state, created_at, updated_at, fsrs_json)
             VALUES ('card-1', 'repo-1', 'edge-1', 'white', 'learning', '1', '2',
                     '{\"stability\":1.25,\"difficulty\":4.5}')",
            [],
        ).unwrap();
        connection.execute(
            "INSERT INTO imported_games
                (id, provider, source_username, source_game_id, pgn, white, black, imported_at)
             VALUES ('game-1', 'lichess', 'player', 'remote-1', '1. d4 *',
                     'White', 'Black', '3')",
            [],
        ).unwrap();
    }

    #[test]
    fn snapshot_preserves_imported_games_and_complete_fsrs_state() {
        let source = memory_database();
        insert_backup_fixtures(&source);
        let directory = temporary_directory("backup-test");

        let record = create_snapshot(&source, &directory, "backup").unwrap();
        let restored = Connection::open(directory.join(&record.name)).unwrap();
        verify_database(&restored).unwrap();

        let pgn: String = restored.query_row(
            "SELECT pgn FROM imported_games WHERE id = 'game-1'",
            [],
            |row| row.get(0),
        ).unwrap();
        let fsrs_json: String = restored.query_row(
            "SELECT fsrs_json FROM study_cards WHERE id = 'card-1'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(pgn, "1. d4 *");
        assert_eq!(fsrs_json, r#"{"stability":1.25,"difficulty":4.5}"#);

        drop(restored);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn restore_replaces_database_only_after_a_valid_snapshot_is_available() {
        let source = memory_database();
        insert_backup_fixtures(&source);
        let directory = temporary_directory("restore-test");
        let record = create_snapshot(&source, &directory, "backup").unwrap();

        let mut destination = memory_database();
        destination.execute(
            "INSERT INTO app_settings (key, value, updated_at)
             VALUES ('before-restore', 'keep-in-safety-copy', '4')",
            [],
        ).unwrap();

        let selected = Connection::open_with_flags(
            directory.join(&record.name),
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        ).unwrap();
        copy_database(&selected, &mut destination).unwrap();
        verify_database(&destination).unwrap();

        let imported_count: i64 = destination.query_row(
            "SELECT COUNT(*) FROM imported_games", [], |row| row.get(0)
        ).unwrap();
        let settings_count: i64 = destination.query_row(
            "SELECT COUNT(*) FROM app_settings", [], |row| row.get(0)
        ).unwrap();
        assert_eq!(imported_count, 1);
        assert_eq!(settings_count, 0);

        drop(selected);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn verification_rejects_a_non_chessos_sqlite_file() {
        let directory = temporary_directory("invalid-test");
        let path = directory.join("chessos-backup-invalid-0.sqlite3");
        Connection::open(&path).unwrap().execute_batch("CREATE TABLE unrelated (id INTEGER);").unwrap();
        let result = open_and_verify(&path, "chessos-backup-invalid-0.sqlite3");
        assert!(result.is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn backup_names_cannot_escape_the_backup_directory() {
        assert!(!is_safe_backup_name("../chessos-backup-123-0.sqlite3"));
        assert!(!is_safe_backup_name("chessos-backup-123-0.sqlite3/other"));
        assert!(is_safe_backup_name("chessos-backup-123-0.sqlite3"));
    }
}
