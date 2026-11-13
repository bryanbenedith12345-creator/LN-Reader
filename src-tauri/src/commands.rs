use std::fs::File;
use std::path::PathBuf;
use std::sync::Arc;
use memmap2::Mmap;
use rayon::prelude::*;
use tauri::{AppHandle, Manager, State};

use crate::db::{BookmarkRecord, BookRecord, ChapterRecord, Database};
use crate::epub::{EpubEngine, ProcessedChapter};
use crate::error::{AppError, AppResult};
use crate::protocol::MmapCache;

#[tauri::command]
pub async fn import_books(
    paths: Vec<String>,
    app: AppHandle,
    db: State<'_, Database>,
    cache: State<'_, MmapCache>,
) -> Result<Vec<BookRecord>, AppError> {
    // 1. Resolve application data folder for covers
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Custom(format!("Cannot resolve app data dir: {}", e)))?;
    let covers_dir = app_data_dir.join("covers");
    std::fs::create_dir_all(&covers_dir)?;

    // 2. Expand any folders to collect all .epub file paths
    let mut epub_paths: Vec<PathBuf> = Vec::new();
    for p_str in paths {
        let p = PathBuf::from(p_str);
        if p.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&p) {
                for entry in entries.flatten() {
                    let ep = entry.path();
                    if ep.is_file() && ep.extension().and_then(|s| s.to_str()) == Some("epub") {
                        epub_paths.push(ep);
                    }
                }
            }
        } else if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("epub") {
            epub_paths.push(p);
        }
    }

    if epub_paths.is_empty() {
        return Ok(Vec::new());
    }

    // 3. Parallel Batch Import via Rayon across all available CPU cores
    let parsed_results: Vec<AppResult<(BookRecord, Vec<ChapterRecord>)>> = epub_paths
        .par_iter()
        .map(|path| EpubEngine::parse_epub(path, &covers_dir))
        .collect();

    let mut imported_books: Vec<BookRecord> = Vec::new();

    // 4. Ingest into SQLite database
    for res in parsed_results {
        match res {
            Ok((book, chapters)) => {
                db.insert_book_with_chapters(&book, &chapters)?;

                // Pre-warm the Mmap cache for instant opening
                if let Ok(file) = File::open(&book.file_path) {
                    if let Ok(mmap) = unsafe { Mmap::map(&file) } {
                        cache.insert(book.id.clone(), Arc::new(mmap));
                    }
                }

                imported_books.push(book);
            }
            Err(err) => {
                eprintln!("[BunkoReader] Failed to import EPUB: {}", err);
            }
        }
    }

    Ok(imported_books)
}

#[tauri::command]
pub fn get_books(db: State<'_, Database>) -> Result<Vec<BookRecord>, AppError> {
    db.get_all_books()
}

#[tauri::command]
pub fn get_book(book_id: String, db: State<'_, Database>) -> Result<Option<BookRecord>, AppError> {
    db.get_book_by_id(&book_id)
}

#[tauri::command]
pub fn get_chapters(book_id: String, db: State<'_, Database>) -> Result<Vec<ChapterRecord>, AppError> {
    db.get_chapters_for_book(&book_id)
}

#[tauri::command]
pub fn load_chapter(
    book_id: String,
    chapter_index: usize,
    db: State<'_, Database>,
    cache: State<'_, MmapCache>,
) -> Result<ProcessedChapter, AppError> {
    // 1. Get or mmap file
    let mmap = if let Some(m) = cache.get(&book_id) {
        m.clone()
    } else {
        let book = db
            .get_book_by_id(&book_id)?
            .ok_or_else(|| AppError::BookNotFound(book_id.clone()))?;

        let file = File::open(&book.file_path)?;
        let m = Arc::new(unsafe { Mmap::map(&file)? });
        cache.insert(book_id.clone(), m.clone());
        m
    };

    // 2. Retrieve chapter details
    let chapter = db
        .get_chapter_by_index(&book_id, chapter_index)?
        .ok_or_else(|| AppError::ChapterNotFound(chapter_index, book_id.clone()))?;

    // 3. Process XHTML in Rust: Ammonia sanitization + lnbook:// URI rewriting
    EpubEngine::process_chapter(&mmap, &book_id, chapter_index, &chapter.title, &chapter.href)
}

#[tauri::command]
pub fn save_progress(
    book_id: String,
    chapter_index: usize,
    para_index: usize,
    scroll_ratio: f64,
    db: State<'_, Database>,
) -> Result<(), AppError> {
    db.update_reading_progress(&book_id, chapter_index, para_index, scroll_ratio)
}

#[tauri::command]
pub fn update_book_metadata(
    book_id: String,
    title: String,
    author: String,
    series: Option<String>,
    db: State<'_, Database>,
) -> Result<(), AppError> {
    db.update_book_metadata(&book_id, &title, &author, series.as_deref())
}

#[tauri::command]
pub fn reset_progress(book_id: String, db: State<'_, Database>) -> Result<(), AppError> {
    db.reset_reading_progress(&book_id)
}

#[tauri::command]
pub fn delete_book(
    book_id: String,
    db: State<'_, Database>,
    cache: State<'_, MmapCache>,
) -> Result<(), AppError> {
    cache.remove(&book_id);
    db.delete_book(&book_id)
}

#[tauri::command]
pub fn create_bookmark(
    book_id: String,
    chapter_index: usize,
    para_index: usize,
    scroll_ratio: f64,
    snippet: String,
    db: State<'_, Database>,
) -> Result<BookmarkRecord, AppError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let bookmark = BookmarkRecord {
        id: uuid::Uuid::new_v4().to_string(),
        book_id,
        chapter_index: chapter_index as i64,
        para_index: para_index as i64,
        scroll_ratio,
        snippet,
        created_at: now,
    };

    db.create_bookmark(&bookmark)?;
    Ok(bookmark)
}

#[tauri::command]
pub fn get_bookmarks(book_id: String, db: State<'_, Database>) -> Result<Vec<BookmarkRecord>, AppError> {
    db.get_bookmarks_for_book(&book_id)
}

#[tauri::command]
pub fn delete_bookmark(bookmark_id: String, db: State<'_, Database>) -> Result<(), AppError> {
    db.delete_bookmark(&bookmark_id)
}

#[tauri::command]
pub fn get_setting(key: String, db: State<'_, Database>) -> Result<Option<String>, AppError> {
    db.get_setting(&key)
}

#[tauri::command]
pub fn set_setting(key: String, value: String, db: State<'_, Database>) -> Result<(), AppError> {
    db.set_setting(&key, &value)
}
