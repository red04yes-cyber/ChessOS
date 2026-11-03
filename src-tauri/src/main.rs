#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod stockfish;

use std::sync::Mutex;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let database_path = app
                .path()
                .app_data_dir()?
                .join("chess-os.sqlite3");
            let connection = db::open_database(&database_path)
                .map_err(std::io::Error::other)?;
            app.manage(db::Database(Mutex::new(connection)));
            app.manage(stockfish::StockfishState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::list_repertoires,
            db::save_repertoire,
            db::delete_repertoire,
            stockfish::stockfish_start,
            stockfish::stockfish_analyze,
            stockfish::stockfish_stop_analysis,
            stockfish::stockfish_shutdown
        ])
        .run(tauri::generate_context!())
        .expect("error while running Chess OS");
}
