#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod external_games;

use std::sync::Mutex;
use tauri::Manager;

fn main() {
    let builder = tauri::Builder::default();
    #[cfg(feature = "app-updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .setup(|app| {
            let database_path = app
                .path()
                .app_data_dir()?
                .join("chess-os.sqlite3");
            let connection = db::open_database(&database_path).map_err(|error| std::io::Error::other(error.to_string()))?;
            app.manage(db::Database(Mutex::new(connection)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            external_games::import_online_games,
            external_games::list_imported_games,
            external_games::get_imported_game,
            external_games::delete_imported_game
        ])
        .run(tauri::generate_context!())
        .expect("error while running Chess OS");
}
