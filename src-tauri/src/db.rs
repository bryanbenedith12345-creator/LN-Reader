use std::path::Path;
use std::sync::Arc;
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookRecord {
    pub id: String,
    pub title: String,
    pub author: String,
    pub series: Option<String>,
    pub file_path: String,
    pub cover_path: Option<String>,
    pub total_chapters: i64,
    pub current_chapter: i64,
    pub current_para_index: i64,
    pub scroll_ratio: f64,
    pub total_words: i64,
    pub created_at: i64,
    pub last_read_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterRecord {
    pub id: String,
    pub book_id: String,
    pub chapter_index: i64,
    pub title: String,
    pub href: String,
    pub word_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarkRecord {
    pub id: String,
    pub book_id: String,
    pub chapter_index: i64,
    pub para_index: i64,
    pub scroll_ratio: f64,
    pub snippet: String,
    pub created_at: i64,
}

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(path: &Path) -> AppResult<Self> {
        let conn = Connection::open(path)?;

        // Extreme performance PRAGMAs for sub-millisecond query latency
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA temp_store = MEMORY;
             PRAGMA mmap_size = 268435456;
             PRAGMA foreign_keys = ON;",
        )?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };

        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS books (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                series TEXT,
                file_path TEXT NOT NULL,
                cover_path TEXT,
                total_chapters INTEGER NOT NULL DEFAULT 0,
                current_chapter INTEGER NOT NULL DEFAULT 0,
                current_para_index INTEGER NOT NULL DEFAULT 0,
                scroll_ratio REAL NOT NULL DEFAULT 0.0,
                total_words INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                last_read_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chapters (
                id TEXT PRIMARY KEY NOT NULL,
                book_id TEXT NOT NULL,
                chapter_index INTEGER NOT NULL,
                title TEXT NOT NULL,
                href TEXT NOT NULL,
                word_count INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS bookmarks (
                id TEXT PRIMARY KEY NOT NULL,
                book_id TEXT NOT NULL,
                chapter_index INTEGER NOT NULL,
                para_index INTEGER NOT NULL,
                scroll_ratio REAL NOT NULL,
                snippet TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_books_last_read ON books(last_read_at DESC);
            CREATE INDEX IF NOT EXISTS idx_chapters_book_idx ON chapters(book_id, chapter_index ASC);
            CREATE INDEX IF NOT EXISTS idx_bookmarks_book_chap ON bookmarks(book_id, chapter_index ASC);
            ",
        )?;
        Ok(())
    }

    pub fn insert_book_with_chapters(&self, book: &BookRecord, chapters: &[ChapterRecord]) -> AppResult<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;

        tx.execute(
            "INSERT INTO books (
                id, title, author, series, file_path, cover_path, total_chapters,
                current_chapter, current_para_index, scroll_ratio, total_words, created_at, last_read_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                author = excluded.author,
                series = excluded.series,
                file_path = excluded.file_path,
                cover_path = excluded.cover_path,
                total_chapters = excluded.total_chapters,
                total_words = excluded.total_words;",
            params![
                book.id,
                book.title,
                book.author,
                book.series,
                book.file_path,
                book.cover_path,
                book.total_chapters,
                book.current_chapter,
                book.current_para_index,
                book.scroll_ratio,
                book.total_words,
                book.created_at,
                book.last_read_at,
            ],
        )?;

        // Clear existing chapters in case of re-import
        tx.execute("DELETE FROM chapters WHERE book_id = ?1;", params![book.id])?;

        {
            let mut stmt = tx.prepare(
                "INSERT INTO chapters (id, book_id, chapter_index, title, href, word_count)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6);",
            )?;

            for ch in chapters {
                stmt.execute(params![
                    ch.id,
                    ch.book_id,
                    ch.chapter_index,
                    ch.title,
                    ch.href,
                    ch.word_count,
                ])?;
            }
        }

        tx.commit()?;
        Ok(())
    }

    pub fn get_all_books(&self) -> AppResult<Vec<BookRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, title, author, series, file_path, cover_path, total_chapters,
                    current_chapter, current_para_index, scroll_ratio, total_words, created_at, last_read_at
             FROM books
             ORDER BY last_read_at DESC;",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(BookRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                author: row.get(2)?,
                series: row.get(3)?,
                file_path: row.get(4)?,
                cover_path: row.get(5)?,
                total_chapters: row.get(6)?,
                current_chapter: row.get(7)?,
                current_para_index: row.get(8)?,
                scroll_ratio: row.get(9)?,
                total_words: row.get(10)?,
                created_at: row.get(11)?,
                last_read_at: row.get(12)?,
            })
        })?;

        let mut books = Vec::new();
        for b in rows {
            books.push(b?);
        }
        Ok(books)
    }

    pub fn get_book_by_id(&self, book_id: &str) -> AppResult<Option<BookRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, title, author, series, file_path, cover_path, total_chapters,
                    current_chapter, current_para_index, scroll_ratio, total_words, created_at, last_read_at
             FROM books
             WHERE id = ?1;",
        )?;

        let book = stmt
            .query_row(params![book_id], |row| {
                Ok(BookRecord {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    author: row.get(2)?,
                    series: row.get(3)?,
                    file_path: row.get(4)?,
                    cover_path: row.get(5)?,
                    total_chapters: row.get(6)?,
                    current_chapter: row.get(7)?,
                    current_para_index: row.get(8)?,
                    scroll_ratio: row.get(9)?,
                    total_words: row.get(10)?,
                    created_at: row.get(11)?,
                    last_read_at: row.get(12)?,
                })
            })
            .optional()?;

        Ok(book)
    }

    pub fn get_chapters_for_book(&self, book_id: &str) -> AppResult<Vec<ChapterRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, book_id, chapter_index, title, href, word_count
             FROM chapters
             WHERE book_id = ?1
             ORDER BY chapter_index ASC;",
        )?;

        let rows = stmt.query_map(params![book_id], |row| {
            Ok(ChapterRecord {
                id: row.get(0)?,
                book_id: row.get(1)?,
                chapter_index: row.get(2)?,
                title: row.get(3)?,
                href: row.get(4)?,
                word_count: row.get(5)?,
            })
        })?;

        let mut chapters = Vec::new();
        for ch in rows {
            chapters.push(ch?);
        }
        Ok(chapters)
    }

    pub fn get_chapter_by_index(&self, book_id: &str, chapter_index: usize) -> AppResult<Option<ChapterRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, book_id, chapter_index, title, href, word_count
             FROM chapters
             WHERE book_id = ?1 AND chapter_index = ?2;",
        )?;

        let chapter = stmt
            .query_row(params![book_id, chapter_index as i64], |row| {
                Ok(ChapterRecord {
                    id: row.get(0)?,
                    book_id: row.get(1)?,
                    chapter_index: row.get(2)?,
                    title: row.get(3)?,
                    href: row.get(4)?,
                    word_count: row.get(5)?,
                })
            })
            .optional()?;

        Ok(chapter)
    }

    pub fn update_reading_progress(
        &self,
        book_id: &str,
        chapter_index: usize,
        para_index: usize,
        scroll_ratio: f64,
    ) -> AppResult<()> {
        let conn = self.conn.lock();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        conn.execute(
            "UPDATE books
             SET current_chapter = ?1,
                 current_para_index = ?2,
                 scroll_ratio = ?3,
                 last_read_at = ?4
             WHERE id = ?5;",
            params![
                chapter_index as i64,
                para_index as i64,
                scroll_ratio,
                now,
                book_id
            ],
        )?;

        Ok(())
    }

    pub fn update_book_metadata(&self, book_id: &str, title: &str, author: &str, series: Option<&str>) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE books SET title = ?1, author = ?2, series = ?3 WHERE id = ?4;",
            params![title, author, series, book_id],
        )?;
        Ok(())
    }

    pub fn reset_reading_progress(&self, book_id: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE books SET current_chapter = 0, current_para_index = 0, scroll_ratio = 0.0 WHERE id = ?1;",
            params![book_id],
        )?;
        Ok(())
    }

    pub fn delete_book(&self, book_id: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM books WHERE id = ?1;", params![book_id])?;
        Ok(())
    }

    pub fn create_bookmark(&self, bookmark: &BookmarkRecord) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO bookmarks (id, book_id, chapter_index, para_index, scroll_ratio, snippet, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7);",
            params![
                bookmark.id,
                bookmark.book_id,
                bookmark.chapter_index,
                bookmark.para_index,
                bookmark.scroll_ratio,
                bookmark.snippet,
                bookmark.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn get_bookmarks_for_book(&self, book_id: &str) -> AppResult<Vec<BookmarkRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, book_id, chapter_index, para_index, scroll_ratio, snippet, created_at
             FROM bookmarks
             WHERE book_id = ?1
             ORDER BY chapter_index ASC, para_index ASC;",
        )?;

        let rows = stmt.query_map(params![book_id], |row| {
            Ok(BookmarkRecord {
                id: row.get(0)?,
                book_id: row.get(1)?,
                chapter_index: row.get(2)?,
                para_index: row.get(3)?,
                scroll_ratio: row.get(4)?,
                snippet: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;

        let mut bookmarks = Vec::new();
        for b in rows {
            bookmarks.push(b?);
        }
        Ok(bookmarks)
    }

    pub fn delete_bookmark(&self, bookmark_id: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM bookmarks WHERE id = ?1;", params![bookmark_id])?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> AppResult<Option<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1;")?;
        let res = stmt.query_row(params![key], |r| r.get(0)).optional()?;
        Ok(res)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
            params![key, value],
        )?;
        Ok(())
    }
}
