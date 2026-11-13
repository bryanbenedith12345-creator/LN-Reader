use std::collections::HashMap;
use std::fs::File;
use std::io::Cursor;
use std::path::Path;
use image::imageops::FilterType;
use memmap2::Mmap;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zip::ZipArchive;

use crate::db::{BookRecord, ChapterRecord};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestItem {
    pub id: String,
    pub href: String,
    pub media_type: String,
    pub properties: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TocEntry {
    pub title: String,
    pub href: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedEpub {
    pub id: String,
    pub title: String,
    pub author: String,
    pub series: Option<String>,
    pub opf_dir: String,
    pub cover_href: Option<String>,
    pub spine_hrefs: Vec<(String, String)>, // (id, href)
    pub toc: Vec<TocEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessedChapter {
    pub chapter_index: usize,
    pub title: String,
    pub content_html: String,
    pub word_count: usize,
    pub illustrations: Vec<String>,
}

/// Normalizes relative zip paths, resolving `.` and `..` segments securely.
pub fn resolve_zip_path(base_dir: &str, relative_path: &str) -> Result<String, AppError> {
    // Strip URL fragment if present for internal lookup
    let path_no_frag = relative_path.split('#').next().unwrap_or(relative_path);
    // URL-decode if needed
    let decoded = urlencoding::decode(path_no_frag).unwrap_or(std::borrow::Cow::Borrowed(path_no_frag));
    let clean_rel = decoded.trim().replace('\\', "/");

    let combined = if base_dir.is_empty() || clean_rel.starts_with('/') {
        clean_rel.trim_start_matches('/').to_string()
    } else {
        format!("{}/{}", base_dir.trim_end_matches('/'), clean_rel)
    };

    let mut parts: Vec<&str> = Vec::new();
    for seg in combined.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            if parts.is_empty() {
                return Err(AppError::PathTraversal(relative_path.to_string()));
            }
            parts.pop();
        } else {
            parts.push(seg);
        }
    }

    Ok(parts.join("/"))
}

/// Helper to get directory part of a zip path
pub fn get_zip_dir(path: &str) -> String {
    if let Some(idx) = path.rfind('/') {
        path[..idx].to_string()
    } else {
        String::new()
    }
}

pub struct EpubEngine;

impl EpubEngine {
    /// Ingest and parse an EPUB with zero-copy memory mapping
    pub fn parse_epub(file_path: &Path, covers_dir: &Path) -> AppResult<(BookRecord, Vec<ChapterRecord>)> {
        let file = File::open(file_path)?;
        let mmap = unsafe { Mmap::map(&file)? };
        let mut cursor = Cursor::new(&mmap[..]);
        let mut archive = ZipArchive::new(&mut cursor)?;

        // 1. Locate rootfile from META-INF/container.xml
        let opf_path = Self::find_opf_path(&mut archive)?;
        let opf_dir = get_zip_dir(&opf_path);

        // 2. Read OPF file contents
        let opf_content = {
            let mut opf_entry = archive.by_name(&opf_path)?;
            let mut buf = String::new();
            std::io::Read::read_to_string(&mut opf_entry, &mut buf)?;
            buf
        };

        // 3. Fast streaming parse of OPF
        let parsed = Self::parse_opf(&opf_content, &opf_dir)?;

        // 4. Generate stable Book ID using SHA-256 of file path + size
        let book_id = {
            let mut hasher = Sha256::new();
            hasher.update(file_path.to_string_lossy().as_bytes());
            hasher.update(&mmap.len().to_le_bytes());
            let hash = hasher.finalize();
            format!("{:x}", hash)[..16].to_string()
        };

        // 5. Extract and generate Lanczos3 WebP thumbnail
        let cover_file_name = format!("{}.webp", book_id);
        let cover_target_path = covers_dir.join(&cover_file_name);
        let cover_saved = if let Some(ref cover_href) = parsed.cover_href {
            let cover_zip_path = resolve_zip_path(&opf_dir, cover_href).unwrap_or_else(|_| cover_href.clone());
            Self::extract_and_resize_cover(&mut archive, &cover_zip_path, &cover_target_path).is_ok()
        } else {
            false
        };

        let cover_path_str = if cover_saved {
            Some(cover_target_path.to_string_lossy().to_string())
        } else {
            None
        };

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        // 6. Build chapter records
        let mut chapters: Vec<ChapterRecord> = Vec::with_capacity(parsed.spine_hrefs.len());
        let mut total_words: i64 = 0;

        for (idx, (_idref, href)) in parsed.spine_hrefs.iter().enumerate() {
            // Find chapter title from TOC if available
            let title = parsed
                .toc
                .iter()
                .find(|t| {
                    let toc_target = t.href.split('#').next().unwrap_or(&t.href);
                    let spine_target = href.split('#').next().unwrap_or(href);
                    toc_target == spine_target || spine_target.ends_with(toc_target)
                })
                .map(|t| t.title.clone())
                .unwrap_or_else(|| format!("Chapter {}", idx + 1));

            // Estimate word count quickly by reading entry
            let full_zip_path = resolve_zip_path(&opf_dir, href).unwrap_or_else(|_| href.clone());
            let approx_words = if let Ok(mut ch_entry) = archive.by_name(&full_zip_path) {
                let mut content = String::new();
                if std::io::Read::read_to_string(&mut ch_entry, &mut content).is_ok() {
                    content.split_whitespace().count() as i64
                } else {
                    0
                }
            } else {
                0
            };

            total_words += approx_words;

            chapters.push(ChapterRecord {
                id: format!("{}:{}", book_id, idx),
                book_id: book_id.clone(),
                chapter_index: idx as i64,
                title,
                href: full_zip_path,
                word_count: approx_words,
            });
        }

        let total_chapters = chapters.len() as i64;

        let book = BookRecord {
            id: book_id,
            title: parsed.title,
            author: parsed.author,
            series: parsed.series,
            file_path: file_path.to_string_lossy().to_string(),
            cover_path: cover_path_str,
            total_chapters,
            current_chapter: 0,
            current_para_index: 0,
            scroll_ratio: 0.0,
            total_words,
            created_at: now,
            last_read_at: now,
        };

        Ok((book, chapters))
    }

    /// Read container.xml to locate the OPF package file
    fn find_opf_path(archive: &mut ZipArchive<&mut Cursor<&[u8]>>) -> AppResult<String> {
        let mut container_file = match archive.by_name("META-INF/container.xml") {
            Ok(f) => f,
            Err(_) => return Err(AppError::MissingContainer),
        };

        let mut content = String::new();
        std::io::Read::read_to_string(&mut container_file, &mut content)?;

        let mut reader = Reader::from_str(&content);
        reader.config_mut().trim_text(true);

        let mut buf = Vec::new();
        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Empty(ref e)) | Ok(Event::Start(ref e)) => {
                    if e.local_name().as_ref() == b"rootfile" {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"full-path" {
                                if let Ok(v) = std::str::from_utf8(&attr.value) {
                                    return Ok(v.to_string());
                                }
                            }
                        }
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(AppError::Xml(e)),
                _ => {}
            }
            buf.clear();
        }

        Err(AppError::MissingOpf)
    }

    /// Streaming parse of OPF with zero heavy DOM overhead
    fn parse_opf(opf_xml: &str, opf_dir: &str) -> AppResult<ParsedEpub> {
        let mut reader = Reader::from_str(opf_xml);
        reader.config_mut().trim_text(true);

        let mut title = String::from("Untitled Light Novel");
        let mut author = String::from("Unknown Author");
        let mut series: Option<String> = None;
        let mut cover_item_id: Option<String> = None;
        let mut manifest: HashMap<String, ManifestItem> = HashMap::new();
        let mut spine_ids: Vec<String> = Vec::new();
        let mut toc_ncx_id: Option<String> = None;
        let mut nav_href: Option<String> = None;

        let mut current_tag = Vec::new();
        let mut buf = Vec::new();

        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Start(ref e)) => {
                    let name = e.local_name().as_ref().to_vec();
                    current_tag = name.clone();

                    if name == b"spine" {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"toc" {
                                toc_ncx_id = std::str::from_utf8(&attr.value).ok().map(|s| s.to_string());
                            }
                        }
                    }
                }
                Ok(Event::Empty(ref e)) => {
                    let name = e.local_name().as_ref().to_vec();
                    if name == b"item" {
                        let mut id = String::new();
                        let mut href = String::new();
                        let mut media_type = String::new();
                        let mut properties: Option<String> = None;

                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"id" => id = String::from_utf8_lossy(&attr.value).to_string(),
                                b"href" => href = String::from_utf8_lossy(&attr.value).to_string(),
                                b"media-type" => media_type = String::from_utf8_lossy(&attr.value).to_string(),
                                b"properties" => properties = Some(String::from_utf8_lossy(&attr.value).to_string()),
                                _ => {}
                            }
                        }

                        if let Some(ref p) = properties {
                            if p.contains("cover-image") {
                                cover_item_id = Some(id.clone());
                            }
                            if p.contains("nav") {
                                nav_href = Some(href.clone());
                            }
                        }

                        manifest.insert(
                            id.clone(),
                            ManifestItem {
                                id,
                                href,
                                media_type,
                                properties,
                            },
                        );
                    } else if name == b"itemref" {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"idref" {
                                spine_ids.push(String::from_utf8_lossy(&attr.value).to_string());
                            }
                        }
                    } else if name == b"meta" {
                        let mut name_val = String::new();
                        let mut content_val = String::new();
                        let mut prop_val = String::new();

                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"name" => name_val = String::from_utf8_lossy(&attr.value).to_string(),
                                b"content" => content_val = String::from_utf8_lossy(&attr.value).to_string(),
                                b"property" => prop_val = String::from_utf8_lossy(&attr.value).to_string(),
                                _ => {}
                            }
                        }

                        if name_val == "cover" && !content_val.is_empty() {
                            cover_item_id = Some(content_val.clone());
                        }
                        if name_val == "calibre:series" || prop_val == "belongs-to-collection" {
                            if !content_val.is_empty() {
                                series = Some(content_val);
                            }
                        }
                    }
                }
                Ok(Event::Text(ref e)) => {
                    if current_tag == b"title" {
                        let text = e.unescape().unwrap_or_default().to_string();
                        if !text.trim().is_empty() {
                            title = text.trim().to_string();
                        }
                    } else if current_tag == b"creator" {
                        let text = e.unescape().unwrap_or_default().to_string();
                        if !text.trim().is_empty() {
                            author = text.trim().to_string();
                        }
                    }
                }
                Ok(Event::End(_)) => {
                    current_tag.clear();
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(AppError::Xml(e)),
                _ => {}
            }
            buf.clear();
        }

        if spine_ids.is_empty() {
            return Err(AppError::EmptySpine);
        }

        // Resolve cover href
        let cover_href = cover_item_id
            .as_ref()
            .and_then(|cid| manifest.get(cid))
            .map(|item| item.href.clone())
            .or_else(|| {
                // Fallback: look for item with 'cover' in ID and image media-type
                manifest.values().find(|it| {
                    (it.id.to_lowercase().contains("cover") || it.href.to_lowercase().contains("cover"))
                        && it.media_type.starts_with("image/")
                }).map(|it| it.href.clone())
            });

        // Resolve spine hrefs
        let spine_hrefs: Vec<(String, String)> = spine_ids
            .into_iter()
            .filter_map(|id| {
                manifest.get(&id).map(|item| (id.clone(), item.href.clone()))
            })
            .collect();

        // Parse TOC: check EPUB 3 Nav first, then NCX
        let mut toc: Vec<TocEntry> = Vec::new();
        if let Some(nhref) = nav_href {
            let full_nav = resolve_zip_path(opf_dir, &nhref).unwrap_or(nhref);
            // Will be populated if available
            toc.push(TocEntry {
                title: "Table of Contents".to_string(),
                href: full_nav,
            });
        } else if let Some(ncx_id) = toc_ncx_id {
            if let Some(ncx_item) = manifest.get(&ncx_id) {
                let full_ncx = resolve_zip_path(opf_dir, &ncx_item.href).unwrap_or_else(|_| ncx_item.href.clone());
                toc.push(TocEntry {
                    title: "Table of Contents".to_string(),
                    href: full_ncx,
                });
            }
        }

        Ok(ParsedEpub {
            id: String::new(),
            title,
            author,
            series,
            opf_dir: opf_dir.to_string(),
            cover_href,
            spine_hrefs,
            toc,
        })
    }

    /// Decodes raw cover image and resizes it to 360x540 WebP using Lanczos3
    fn extract_and_resize_cover(
        archive: &mut ZipArchive<&mut Cursor<&[u8]>>,
        cover_zip_path: &str,
        dest_path: &Path,
    ) -> AppResult<()> {
        let mut entry = match archive.by_name(cover_zip_path) {
            Ok(e) => e,
            Err(_) => return Err(AppError::Custom(format!("Cover image '{}' not in archive", cover_zip_path))),
        };

        let mut raw_bytes = Vec::with_capacity(entry.size() as usize);
        std::io::Read::read_to_end(&mut entry, &mut raw_bytes)?;

        let img = image::load_from_memory(&raw_bytes)?;
        // High-quality Lanczos3 resize to 2:3 bunkobon standard 360x540
        let resized = img.resize_exact(360, 540, FilterType::Lanczos3);

        if let Some(parent) = dest_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Save as WebP / image format
        resized.save(dest_path)?;
        Ok(())
    }

    /// Processes a chapter file: sanitizes XHTML, rewrites illustration URLs to `lnbook://`, and tags paragraphs.
    pub fn process_chapter(
        mmap: &Mmap,
        book_id: &str,
        chapter_index: usize,
        chapter_title: &str,
        chapter_zip_path: &str,
    ) -> AppResult<ProcessedChapter> {
        let mut cursor = Cursor::new(&mmap[..]);
        let mut archive = ZipArchive::new(&mut cursor)?;

        let mut entry = match archive.by_name(chapter_zip_path) {
            Ok(e) => e,
            Err(_) => return Err(AppError::ChapterNotFound(chapter_index, chapter_zip_path.to_string())),
        };

        let mut raw_str = String::with_capacity(entry.size() as usize);
        std::io::Read::read_to_string(&mut entry, &mut raw_str)?;

        let chapter_dir = get_zip_dir(chapter_zip_path);

        // Sanitize with Ammonia whitelisting LN semantic tags: ruby, rt, rp, section, aside, etc.
        let mut cleaner = ammonia::Builder::new();
        cleaner
            .tags([
                "html", "body", "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "div",
                "em", "strong", "b", "i", "u", "s", "sub", "sup", "blockquote", "pre", "code",
                "hr", "br", "ruby", "rt", "rp", "rb", "img", "svg", "image", "section",
                "aside", "header", "footer", "nav", "figure", "figcaption", "table", "tbody", "tr", "td", "th"
            ].into_iter().collect())
            .tag_attributes([
                ("img", ["src", "alt", "title", "width", "height", "class", "loading"].into_iter().collect()),
                ("image", ["href", "xlink:href", "width", "height"].into_iter().collect()),
                ("svg", ["viewBox", "width", "height", "class"].into_iter().collect()),
                ("*", ["id", "class", "style", "epub:type", "data-para-idx", "data-img-src"].into_iter().collect()),
            ].into_iter().collect())
            .add_generic_attributes(["id", "class", "style"]);

        let sanitized = cleaner.clean(&raw_str).to_string();

        // Rewrite relative image sources to custom protocol `lnbook://localhost/<book_id>/<zip_path>`
        // and collect list of illustrations
        let mut illustrations = Vec::new();
        let mut processed_html = String::with_capacity(sanitized.len() + 1024);

        let mut cursor_idx = 0;
        let bytes = sanitized.as_bytes();
        let len = bytes.len();

        let mut para_counter = 0;

        while cursor_idx < len {
            // Check for `<p` or `<p `
            if cursor_idx + 2 < len && &sanitized[cursor_idx..cursor_idx + 2] == "<p" &&
               (sanitized.as_bytes()[cursor_idx + 2] == b' ' || sanitized.as_bytes()[cursor_idx + 2] == b'>') {
                processed_html.push_str(&format!("<p data-para-idx=\"{}\"", para_counter));
                para_counter += 1;
                cursor_idx += 2;
                continue;
            }

            // Check for `<img`
            if cursor_idx + 4 < len && &sanitized[cursor_idx..cursor_idx + 4] == "<img" {
                // Find closing `>`
                if let Some(close_pos) = sanitized[cursor_idx..].find('>') {
                    let full_img_tag = &sanitized[cursor_idx..cursor_idx + close_pos + 1];
                    let rewritten = Self::rewrite_img_tag(full_img_tag, book_id, &chapter_dir, &mut illustrations);
                    processed_html.push_str(&rewritten);
                    cursor_idx += close_pos + 1;
                    continue;
                }
            }

            // Append character
            if let Some(ch) = sanitized[cursor_idx..].chars().next() {
                processed_html.push(ch);
                cursor_idx += ch.len_utf8();
            } else {
                break;
            }
        }

        let word_count = processed_html.split_whitespace().count();

        Ok(ProcessedChapter {
            chapter_index,
            title: chapter_title.to_string(),
            content_html: processed_html,
            word_count,
            illustrations,
        })
    }

    fn rewrite_img_tag(
        tag: &str,
        book_id: &str,
        chapter_dir: &str,
        illustrations: &mut Vec<String>,
    ) -> String {
        // Look for src="..."
        let src_pattern = "src=\"";
        if let Some(start_idx) = tag.find(src_pattern) {
            let val_start = start_idx + src_pattern.len();
            if let Some(end_idx) = tag[val_start..].find('"') {
                let original_src = &tag[val_start..val_start + end_idx];
                if let Ok(resolved_path) = resolve_zip_path(chapter_dir, original_src) {
                    let protocol_url = format!("lnbook://localhost/{}/{}", book_id, resolved_path);
                    illustrations.push(protocol_url.clone());

                    let mut new_tag = String::with_capacity(tag.len() + 128);
                    new_tag.push_str(&tag[..start_idx]);
                    new_tag.push_str(&format!(
                        "src=\"{}\" class=\"ln-illustration\" data-img-src=\"{}\" loading=\"lazy\"",
                        protocol_url, protocol_url
                    ));
                    new_tag.push_str(&tag[val_start + end_idx + 1..]);
                    return new_tag;
                }
            }
        }
        tag.to_string()
    }
}
