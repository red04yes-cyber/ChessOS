#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backups;
mod db;
mod external_games;

use std::sync::Mutex;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(windows)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            #[cfg(windows)]
            app.handle().plugin(tauri_plugin_process::init())?;
            let database_path = app
                .path()
                .app_data_dir()?
                .join("chess-os.sqlite3");
            let connection = db::open_database(&database_path).map_err(|error| std::io::Error::other(error.to_string()))?;
            app.manage(db::Database(Mutex::new(connection)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backups::create_database_backup,
            backups::list_database_backups,
            backups::verify_database_backup,
            backups::restore_database_backup,
            backups::delete_database_backup,
            db::list_repertoires,
            db::save_repertoire,
            db::delete_repertoire,
            db::list_study_cards,
            db::list_review_logs,
            db::list_training_sessions,
            db::start_training_session,
            db::record_study_review,
            db::finish_training_session,
            db::list_study_goals,
            db::save_study_goal,
            db::list_exam_attempts,
            db::start_exam,
            db::record_exam_answer,
            db::finish_exam,
            db::get_app_setting,
            db::set_app_setting,
            external_games::import_online_games,
            external_games::list_imported_games,
            external_games::search_imported_games,
            external_games::export_imported_games_pgn,
            external_games::list_profile_games,
            external_games::get_imported_game,
            external_games::delete_imported_game
        ])
        .run(tauri::generate_context!())
        .expect("error while running Chess OS");
}
