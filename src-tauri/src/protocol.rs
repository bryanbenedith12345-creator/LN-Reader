use std::fs::File;
use std::io::Cursor;
use std::sync::Arc;
use dashmap::DashMap;
use memmap2::Mmap;
use tauri::http::{header, Response, StatusCode};
use tauri::{AppHandle, Manager, UriSchemeResponder};
use zip::ZipArchive;

use crate::db::Database;

pub type MmapCache = Arc<DashMap<String, Arc<Mmap>>>;

pub fn create_mmap_cache() -> MmapCache {
    Arc::new(DashMap::new())
}

/// Detect MIME type based on file extension
pub fn detect_mime(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".xhtml") || lower.ends_with(".html") {
        "application/xhtml+xml"
    } else if lower.ends_with(".css") {
        "text/css"
    } else if lower.ends_with(".js") {
        "application/javascript"
    } else if lower.ends_with(".woff2") {
        "font/woff2"
    } else if lower.ends_with(".woff") {
        "font/woff"
    } else if lower.ends_with(".ttf") {
        "font/ttf"
    } else if lower.ends_with(".otf") {
        "font/otf"
    } else {
        "application/octet-stream"
    }
}

/// Handles `lnbook://localhost/<book_id>/<internal_zip_path>` requests asynchronously
pub fn handle_lnbook_request(
    app: &AppHandle,
    mmap_cache: &MmapCache,
    request: tauri::http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let uri = request.uri();
    let raw_path = uri.path();

    // Strip leading '/'
    let path = raw_path.trim_start_matches('/');
    let mut segments = path.splitn(2, '/');

    let book_id = match segments.next() {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => {
            let res = Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(b"Missing book ID".to_vec())
                .unwrap();
            responder.respond(res);
            return;
        }
    };

    let internal_path_encoded = match segments.next() {
        Some(p) if !p.is_empty() => p,
        _ => {
            let res = Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(b"Missing resource path".to_vec())
                .unwrap();
            responder.respond(res);
            return;
        }
    };

    // Strict canonical path normalization & directory traversal rejection
    if internal_path_encoded.contains("..") || internal_path_encoded.contains('\0') {
        let res = Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(b"Path traversal rejected".to_vec())
            .unwrap();
        responder.respond(res);
        return;
    }

    let internal_path = urlencoding::decode(internal_path_encoded)
        .unwrap_or(std::borrow::Cow::Borrowed(internal_path_encoded))
        .replace('\\', "/");

    // Serve pre-decoded WebP cover thumbnail from app_data/covers/<book_id>.webp if requested
    if internal_path == "cover.webp" {
        if let Ok(app_data) = app.path().app_data_dir() {
            let cover_path = app_data.join("covers").join(format!("{}.webp", book_id));
            if let Ok(bytes) = std::fs::read(&cover_path) {
                let response = Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "image/webp")
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
                    .body(bytes)
                    .unwrap();
                responder.respond(response);
                return;
            }
        }
    }

    // Retrieve or load memory-mapped EPUB
    let mmap = if let Some(cached) = mmap_cache.get(&book_id) {
        cached.clone()
    } else {
        // Fetch book file path from SQLite
        let db = match app.try_state::<Database>() {
            Some(d) => d,
            None => {
                let res = Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(b"Database state unavailable".to_vec())
                    .unwrap();
                responder.respond(res);
                return;
            }
        };

        let file_path = match db.get_book_by_id(&book_id) {
            Ok(Some(b)) => b.file_path,
            Ok(None) => {
                let res = Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(b"Book not found".to_vec())
                .unwrap();
                responder.respond(res);
                return;
            }
            Err(e) => {
                let res = Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(e.to_string().into_bytes())
                    .unwrap();
                responder.respond(res);
                return;
            }
        };

        let file = match File::open(&file_path) {
            Ok(f) => f,
            Err(e) => {
                let res = Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(format!("Failed to open EPUB: {}", e).into_bytes())
                    .unwrap();
                responder.respond(res);
                return;
            }
        };

        let m = match unsafe { Mmap::map(&file) } {
            Ok(m) => Arc::new(m),
            Err(e) => {
                let res = Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(format!("Failed to mmap EPUB: {}", e).into_bytes())
                    .unwrap();
                responder.respond(res);
                return;
            }
        };

        mmap_cache.insert(book_id.clone(), m.clone());
        m
    };

    // Read asset directly from the mapped zip archive in virtual memory
    let mut cursor = Cursor::new(&mmap[..]);
    let mut archive = match ZipArchive::new(&mut cursor) {
        Ok(a) => a,
        Err(e) => {
            let res = Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(format!("Failed to read zip: {}", e).into_bytes())
                .unwrap();
            responder.respond(res);
            return;
        }
    };

    let mut entry = match archive.by_name(&internal_path) {
        Ok(e) => e,
        Err(_) => {
            let res = Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(format!("Asset '{}' not found in book", internal_path).into_bytes())
                .unwrap();
            responder.respond(res);
            return;
        }
    };

    let mut buffer = Vec::with_capacity(entry.size() as usize);
    if let Err(e) = std::io::Read::read_to_end(&mut entry, &mut buffer) {
        let res = Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(format!("Read error: {}", e).into_bytes())
            .unwrap();
        responder.respond(res);
        return;
    }

    let mime = detect_mime(&internal_path);
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .body(buffer)
        .unwrap();

    responder.respond(response);
}
