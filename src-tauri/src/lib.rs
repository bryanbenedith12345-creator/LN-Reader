pub mod commands;
pub mod db;
pub mod epub;
pub mod error;
pub mod protocol;

use tauri::Manager;
use crate::db::Database;
use crate::protocol::{create_mmap_cache, handle_lnbook_request};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mmap_cache = create_mmap_cache();
    let cache_for_protocol = mmap_cache.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("lnbook", move |ctx, req, responder| {
            let app_handle = ctx.app_handle().clone();
            handle_lnbook_request(&app_handle, &cache_for_protocol, req, responder);
        })
        .setup(move |app| {
            let app_data = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");
            std::fs::create_dir_all(&app_data).expect("Failed to create app data directory");

            let db_path = app_data.join("bunko.db");
            let db = Database::new(&db_path).expect("Failed to initialize SQLite database");

            app.manage(db);
            app.manage(mmap_cache);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_books,
            commands::get_books,
            commands::get_book,
            commands::get_chapters,
            commands::load_chapter,
            commands::save_progress,
            commands::update_book_metadata,
            commands::reset_progress,
            commands::delete_book,
            commands::create_bookmark,
            commands::get_bookmarks,
            commands::delete_bookmark,
            commands::get_setting,
            commands::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
