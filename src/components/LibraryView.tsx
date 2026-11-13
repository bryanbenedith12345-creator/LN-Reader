import React, { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { BookRecord, SortOption } from "../types";

interface LibraryViewProps {
  onOpenBook: (book: BookRecord) => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({ onOpenBook }) => {
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("last_read");
  const [isImporting, setIsImporting] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    book: BookRecord;
    x: number;
    y: number;
  } | null>(null);
  const [editingBook, setEditingBook] = useState<BookRecord | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load books from SQLite on mount
  const refreshBooks = async () => {
    try {
      const records = await invoke<BookRecord[]>("get_books");
      setBooks(records);
    } catch (err) {
      console.error("[BunkoReader] Failed to load library:", err);
    }
  };

  useEffect(() => {
    refreshBooks();
  }, []);

  // Listen to Tauri native drag-and-drop
  useEffect(() => {
    const webview = getCurrentWebviewWindow();
    const unlistenPromise = webview.listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
      if (event.payload.paths && event.payload.paths.length > 0) {
        setIsImporting(true);
        try {
          await invoke("import_books", { paths: event.payload.paths });
          await refreshBooks();
        } catch (e) {
          console.error("[BunkoReader] Drag-drop import error:", e);
        } finally {
          setIsImporting(false);
        }
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Keyboard shortcut listeners (Cmd/Ctrl + F for search, Cmd/Ctrl + O for open file)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handlePickFiles();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenu) setContextMenu(null);
    };
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, [contextMenu]);

  // Open native file dialog for importing EPUBs
  const handlePickFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Light Novel EPUBs", extensions: ["epub"] }],
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        if (paths.length > 0) {
          setIsImporting(true);
          await invoke("import_books", { paths });
          await refreshBooks();
        }
      }
    } catch (err) {
      console.error("[BunkoReader] File open dialog error:", err);
    } finally {
      setIsImporting(false);
    }
  };

  // Instant filtering (<5ms)
  const filteredAndSortedBooks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let result = books.filter((b) => {
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        (b.series && b.series.toLowerCase().includes(q))
      );
    });

    result.sort((a, b) => {
      switch (sortOption) {
        case "last_read":
          return b.last_read_at - a.last_read_at;
        case "title":
          return a.title.localeCompare(b.title);
        case "author":
          return a.author.localeCompare(b.author);
        case "progress": {
          const progA = a.total_chapters > 0 ? a.current_chapter / a.total_chapters : 0;
          const progB = b.total_chapters > 0 ? b.current_chapter / b.total_chapters : 0;
          return progB - progA;
        }
        case "date_added":
          return b.created_at - a.created_at;
        default:
          return 0;
      }
    });

    return result;
  }, [books, searchQuery, sortOption]);

  const handleContextMenu = (e: React.MouseEvent, book: BookRecord) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      book,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleResetProgress = async (bookId: string) => {
    await invoke("reset_progress", { bookId });
    setContextMenu(null);
    refreshBooks();
  };

  const handleDeleteBook = async (bookId: string) => {
    await invoke("delete_book", { bookId });
    setContextMenu(null);
    refreshBooks();
  };

  const handleSaveMetadata = async () => {
    if (!editingBook) return;
    await invoke("update_book_metadata", {
      bookId: editingBook.id,
      title: editingBook.title,
      author: editingBook.author,
      series: editingBook.series,
    });
    setEditingBook(null);
    refreshBooks();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 36px)", position: "relative" }}>
      {/* Sub-header Filter & Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 24px",
          backgroundColor: "var(--bg-surface)",
          borderBottom: "1px solid var(--border-hairline)",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ position: "relative" }}>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Filter library (Ctrl+F)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
              style={{ width: "240px" }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: "11px", color: "var(--ink-secondary)", textTransform: "uppercase" }}>
              Sort:
            </span>
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
              className="search-input"
              style={{ padding: "0 6px", height: "28px", cursor: "pointer" }}
            >
              <option value="last_read">Last Read</option>
              <option value="title">Title (A-Z)</option>
              <option value="author">Author</option>
              <option value="progress">Progress</option>
              <option value="date_added">Date Added</option>
            </select>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="telemetry-mono" style={{ fontSize: "11px", color: "var(--ink-secondary)" }}>
            {filteredAndSortedBooks.length} VOLUMES
          </span>

          <button
            className="hud-btn active"
            onClick={handlePickFiles}
            disabled={isImporting}
            title="Import EPUB (Ctrl+O)"
          >
            {isImporting ? "Importing..." : "+ Import EPUB"}
          </button>
        </div>
      </div>

      {/* Book Grid */}
      <div className="bunkobon-grid">
        {filteredAndSortedBooks.map((book) => {
          const progressPercent =
            book.total_chapters > 0
              ? Math.round((book.current_chapter / book.total_chapters) * 100)
              : 0;

          return (
            <div
              key={book.id}
              className="bunkobon-card"
              onClick={() => onOpenBook(book)}
              onContextMenu={(e) => handleContextMenu(e, book)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpenBook(book);
              }}
            >
              <div className="cover-wrapper">
                {book.cover_path ? (
                  <img
                    src={`lnbook://localhost/${book.id}/cover.webp`}
                    alt={book.title}
                    className="cover-image"
                    loading="lazy"
                    onError={(e) => {
                      // Fallback if custom protocol needs internal file path
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="cover-fallback">
                    <span className="cover-fallback-title">{book.title}</span>
                  </div>
                )}
                {/* Physical Book Spine Crease & Inset Border */}
                <div className="spine-crease-overlay" />
              </div>

              <div className="book-meta">
                <span className="book-title" title={book.title}>
                  {book.title}
                </span>
                <span className="book-author" title={book.author}>
                  {book.author}
                </span>
                <div className="book-stats">
                  <span className="progress-pill">{progressPercent}%</span>
                  <span>
                    Ch {book.current_chapter + 1}/{book.total_chapters || 1}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {filteredAndSortedBooks.length === 0 && !isImporting && (
          <div
            style={{
              gridColumn: "1 / -1",
              textAlign: "center",
              padding: "80px 20px",
              color: "var(--ink-secondary)",
            }}
          >
            <p style={{ fontSize: "14px", marginBottom: "8px" }}>No Light Novels found.</p>
            <p style={{ fontSize: "12px" }}>
              Drag and drop <code className="telemetry-mono">.epub</code> files here or press{" "}
              <code className="telemetry-mono">[Ctrl + O]</code>.
            </p>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--border-hairline)",
            borderRadius: "var(--radius-control)",
            boxShadow: "0 4px 12px var(--spine-shadow)",
            zIndex: 1500,
            width: "160px",
            padding: "4px 0",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="drawer-item"
            style={{ padding: "6px 12px", fontSize: "12px" }}
            onClick={() => {
              onOpenBook(contextMenu.book);
              setContextMenu(null);
            }}
          >
            Read Book
          </div>
          <div
            className="drawer-item"
            style={{ padding: "6px 12px", fontSize: "12px" }}
            onClick={() => {
              setEditingBook(contextMenu.book);
              setContextMenu(null);
            }}
          >
            Edit Metadata...
          </div>
          <div
            className="drawer-item"
            style={{ padding: "6px 12px", fontSize: "12px" }}
            onClick={() => handleResetProgress(contextMenu.book.id)}
          >
            Reset Progress
          </div>
          <div
            style={{ height: 1, backgroundColor: "var(--border-hairline)", margin: "4px 0" }}
          />
          <div
            className="drawer-item"
            style={{ padding: "6px 12px", fontSize: "12px", color: "var(--accent-bookmark)" }}
            onClick={() => handleDeleteBook(contextMenu.book.id)}
          >
            Delete from Library
          </div>
        </div>
      )}

      {/* Metadata Edit Modal */}
      {editingBook && (
        <div
          className="lightbox-backdrop"
          onClick={() => setEditingBook(null)}
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border-hairline)",
              borderRadius: "var(--radius-popover)",
              padding: "20px",
              width: "360px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink-primary)" }}>
              Edit Metadata
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: "11px", color: "var(--ink-secondary)" }}>Title</label>
              <input
                type="text"
                className="search-input"
                value={editingBook.title}
                onChange={(e) => setEditingBook({ ...editingBook, title: e.target.value })}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: "11px", color: "var(--ink-secondary)" }}>Author</label>
              <input
                type="text"
                className="search-input"
                value={editingBook.author}
                onChange={(e) => setEditingBook({ ...editingBook, author: e.target.value })}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: "11px", color: "var(--ink-secondary)" }}>Series</label>
              <input
                type="text"
                className="search-input"
                value={editingBook.series || ""}
                onChange={(e) => setEditingBook({ ...editingBook, series: e.target.value || null })}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button className="hud-btn" onClick={() => setEditingBook(null)}>
                Cancel
              </button>
              <button className="hud-btn active" onClick={handleSaveMetadata}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
