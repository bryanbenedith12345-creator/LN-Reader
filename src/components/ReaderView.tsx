import React, { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  BookRecord,
  ChapterRecord,
  BookmarkRecord,
  ReaderSettings,
} from "../types";
import { useChapterCache } from "../hooks/useChapterCache";
import { TypographyPopover } from "./TypographyPopover";
import { NavigationDrawer, DrawerTab } from "./NavigationDrawer";
import { Lightbox } from "./Lightbox";

interface ReaderViewProps {
  book: BookRecord;
  settings: ReaderSettings;
  onUpdateSettings: (updater: (prev: ReaderSettings) => ReaderSettings) => void;
  onBackToLibrary: () => void;
}

export const ReaderView: React.FC<ReaderViewProps> = ({
  book,
  settings,
  onUpdateSettings,
  onBackToLibrary,
}) => {
  const [chapters, setChapters] = useState<ChapterRecord[]>([]);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(book.current_chapter);
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  
  // HUD Visibility
  const [hudVisible, setHudVisible] = useState(true);
  const hudTimerRef = useRef<number | null>(null);

  // Popovers & Drawers
  const [showTypography, setShowTypography] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("toc");

  // Lightbox
  const [activeLightboxImg, setActiveLightboxImg] = useState<string | null>(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [activeParaIndex, setActiveParaIndex] = useState(book.current_para_index || 0);

  // Refs for layout measurement
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Fast LRU Chapter Cache & Debounced SQLite Sync
  const {
    currentChapter,
    loading,
    error,
    fetchChapter,
    recordProgress,
    flushProgress,
  } = useChapterCache(book.id, book.total_chapters || chapters.length || 100);

  // 1. Fetch Chapters list and Bookmarks on load
  useEffect(() => {
    invoke<ChapterRecord[]>("get_chapters", { bookId: book.id })
      .then((chs) => setChapters(chs))
      .catch((e) => console.error("Failed to load chapters:", e));

    invoke<BookmarkRecord[]>("get_bookmarks", { bookId: book.id })
      .then((bms) => setBookmarks(bms))
      .catch((e) => console.error("Failed to load bookmarks:", e));
  }, [book.id]);

  // 2. Fetch active chapter content
  useEffect(() => {
    fetchChapter(currentChapterIndex);
  }, [currentChapterIndex, fetchChapter]);

  // Reset or recalculate pages when chapter content or settings change
  const calculatePagination = useCallback(() => {
    if (settings.layoutMode !== "paginated" || !trackRef.current || !containerRef.current) {
      return;
    }

    const container = containerRef.current;
    const track = trackRef.current;

    // Determine page spread width
    const pageWidth = container.clientWidth;
    const scrollWidth = track.scrollWidth;

    if (pageWidth > 0) {
      const calculatedTotal = Math.max(1, Math.ceil(scrollWidth / pageWidth));
      setTotalPages(calculatedTotal);

      // Paragraph anchor preservation: restore page based on activeParaIndex
      if (activeParaIndex > 0) {
        const targetPara = track.querySelector(`[data-para-idx="${activeParaIndex}"]`) as HTMLElement;
        if (targetPara) {
          const paraOffset = targetPara.offsetLeft;
          const targetPage = Math.min(Math.floor(paraOffset / pageWidth), calculatedTotal - 1);
          setCurrentPage(targetPage);
          return;
        }
      }

      setCurrentPage((prev) => Math.min(prev, calculatedTotal - 1));
    }
  }, [settings.layoutMode, activeParaIndex]);

  useEffect(() => {
    // Let DOM render column layout before measuring
    const timer = setTimeout(() => {
      calculatePagination();
    }, 50);
    return () => clearTimeout(timer);
  }, [currentChapter, settings, calculatePagination]);

  // Window resize observer to preserve paragraph anchor
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      calculatePagination();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [calculatePagination]);

  // HUD timer management
  const showHudBriefly = useCallback(() => {
    setHudVisible(true);
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = window.setTimeout(() => {
      if (!showTypography && !showDrawer) {
        setHudVisible(false);
      }
    }, 1800);
  }, [showTypography, showDrawer]);

  const hideHudImmediately = useCallback(() => {
    if (!showTypography && !showDrawer) {
      setHudVisible(false);
      if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    }
  }, [showTypography, showDrawer]);

  // Track pointer movement to trigger HUD
  const handleMouseMove = () => {
    showHudBriefly();
  };

  // Find visible paragraph in paginated view
  const updateActiveParagraphFromPage = useCallback(
    (page: number) => {
      if (!trackRef.current || !containerRef.current) return;
      const pageWidth = containerRef.current.clientWidth;
      const pageLeft = page * pageWidth;
      const pageRight = pageLeft + pageWidth;

      const paras = trackRef.current.querySelectorAll("p[data-para-idx]");
      for (let i = 0; i < paras.length; i++) {
        const p = paras[i] as HTMLElement;
        if (p.offsetLeft >= pageLeft - 20 && p.offsetLeft < pageRight) {
          const idx = Number(p.getAttribute("data-para-idx") || 0);
          setActiveParaIndex(idx);
          const ratio = totalPages > 1 ? page / (totalPages - 1) : 0;
          recordProgress(currentChapterIndex, idx, ratio);
          break;
        }
      }
    },
    [currentChapterIndex, totalPages, recordProgress]
  );

  // Turn to Next Page or Advance to Next Chapter
  const handleNextPage = useCallback(() => {
    hideHudImmediately();
    if (settings.layoutMode === "paginated") {
      if (currentPage < totalPages - 1) {
        const next = currentPage + 1;
        setCurrentPage(next);
        updateActiveParagraphFromPage(next);
      } else if (currentChapterIndex < chapters.length - 1) {
        // Advance to next chapter page 0
        setCurrentChapterIndex((prev) => prev + 1);
        setCurrentPage(0);
        setActiveParaIndex(0);
      }
    } else if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ top: window.innerHeight * 0.75, behavior: "smooth" });
    }
  }, [
    hideHudImmediately,
    settings.layoutMode,
    currentPage,
    totalPages,
    currentChapterIndex,
    chapters.length,
    updateActiveParagraphFromPage,
  ]);

  // Turn to Prev Page or Jump to Prev Chapter
  const handlePrevPage = useCallback(() => {
    hideHudImmediately();
    if (settings.layoutMode === "paginated") {
      if (currentPage > 0) {
        const prev = currentPage - 1;
        setCurrentPage(prev);
        updateActiveParagraphFromPage(prev);
      } else if (currentChapterIndex > 0) {
        // Jump to last page of prev chapter
        setCurrentChapterIndex((prev) => prev - 1);
        // Will recalculate to last page
      }
    } else if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ top: -window.innerHeight * 0.75, behavior: "smooth" });
    }
  }, [hideHudImmediately, settings.layoutMode, currentPage, currentChapterIndex]);

  // Create bookmark at current paragraph
  const handleAddBookmark = useCallback(async () => {
    let snippet = "Bookmark";
    if (trackRef.current) {
      const activeEl = trackRef.current.querySelector(
        `p[data-para-idx="${activeParaIndex}"]`
      );
      if (activeEl && activeEl.textContent) {
        snippet = activeEl.textContent.trim().slice(0, 100);
      }
    }

    try {
      const bm = await invoke<BookmarkRecord>("create_bookmark", {
        bookId: book.id,
        chapterIndex: currentChapterIndex,
        paraIndex: activeParaIndex,
        scrollRatio: totalPages > 1 ? currentPage / (totalPages - 1) : 0,
        snippet,
      });
      setBookmarks((prev) => [bm, ...prev]);
    } catch (e) {
      console.error("Failed to add bookmark:", e);
    }
  }, [book.id, currentChapterIndex, activeParaIndex, totalPages, currentPage]);

  const handleDeleteBookmark = async (bookmarkId: string) => {
    await invoke("delete_bookmark", { bookmarkId });
    setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId));
  };

  // Lightbox click delegation on images
  const handleContentClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "IMG" || target.classList.contains("ln-illustration")) {
      const src = target.getAttribute("data-img-src") || target.getAttribute("src");
      if (src) {
        setActiveLightboxImg(src);
      }
    }
  };

  // Keyboard navigation controller
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (activeLightboxImg) return; // Lightbox handles its own keys

      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        handleNextPage();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        handlePrevPage();
      } else if (e.key.toLowerCase() === "t") {
        setShowTypography((prev) => !prev);
        setShowDrawer(false);
      } else if (e.key.toLowerCase() === "c") {
        setDrawerTab("toc");
        setShowDrawer((prev) => !prev);
        setShowTypography(false);
      } else if (e.key.toLowerCase() === "b") {
        setDrawerTab("bookmarks");
        setShowDrawer((prev) => !prev);
        setShowTypography(false);
      } else if (e.key.toLowerCase() === "m" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d")) {
        e.preventDefault();
        handleAddBookmark();
      } else if (e.key.toLowerCase() === "f" || e.key === "F11") {
        e.preventDefault();
        const win = getCurrentWindow();
        const isFull = await win.isFullscreen();
        win.setFullscreen(!isFull);
      } else if (e.key === "Escape") {
        if (showTypography) setShowTypography(false);
        else if (showDrawer) setShowDrawer(false);
        else {
          const win = getCurrentWindow();
          const isFull = await win.isFullscreen();
          if (isFull) {
            win.setFullscreen(false);
          } else {
            flushProgress();
            onBackToLibrary();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeLightboxImg,
    handleNextPage,
    handlePrevPage,
    handleAddBookmark,
    showTypography,
    showDrawer,
    flushProgress,
    onBackToLibrary,
  ]);

  // Overall reading progress calculation
  const overallProgress = chapters.length > 0
    ? (((currentChapterIndex + (totalPages > 1 ? currentPage / totalPages : 0)) / chapters.length) * 100).toFixed(1)
    : "0.0";

  return (
    <div
      className="reader-viewport"
      onMouseMove={handleMouseMove}
      onClick={() => {
        if (showTypography) setShowTypography(false);
        if (showDrawer) setShowDrawer(false);
      }}
    >
      {/* Top Auto-Hiding HUD */}
      <div className={`reader-hud-top ${!hudVisible ? "reader-hud-hidden" : ""}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            className="hud-btn"
            onClick={() => {
              flushProgress();
              onBackToLibrary();
            }}
            title="Return to Library (Esc)"
          >
            ← Library
          </button>
          <span style={{ fontSize: "11px", color: "var(--ink-secondary)" }}>|</span>
          <span
            style={{
              fontSize: "12px",
              fontWeight: 600,
              maxWidth: "280px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {book.title}
          </span>
          <span
            style={{
              fontSize: "11px",
              color: "var(--ink-secondary)",
              maxWidth: "200px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {loading ? "Loading..." : (currentChapter?.title || chapters[currentChapterIndex]?.title)}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            className={`hud-btn ${showDrawer && drawerTab === "toc" ? "active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setDrawerTab("toc");
              setShowDrawer(!showDrawer || drawerTab !== "toc");
              setShowTypography(false);
            }}
            title="Table of Contents (C)"
          >
            Contents
          </button>

          <button
            className={`hud-btn ${showDrawer && drawerTab === "bookmarks" ? "active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setDrawerTab("bookmarks");
              setShowDrawer(!showDrawer || drawerTab !== "bookmarks");
              setShowTypography(false);
            }}
            title="Bookmarks (B)"
          >
            Bookmarks
          </button>

          <button
            className="hud-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleAddBookmark();
            }}
            title="Add Bookmark at Current Position (M)"
          >
            + Mark
          </button>

          <button
            className={`hud-btn ${showTypography ? "active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowTypography(!showTypography);
              setShowDrawer(false);
            }}
            title="Typography Settings (T)"
          >
            Aa
          </button>
        </div>
      </div>

      {/* Reader Prose Engine */}
      {error && (
        <div style={{ padding: "16px", color: "var(--accent-bookmark)", textAlign: "center", position: "absolute", top: 48, width: "100%", zIndex: 100 }}>
          Error loading chapter: {error}
        </div>
      )}
      {settings.layoutMode === "paginated" ? (
        <div className="paginated-container" ref={containerRef} onClick={handleContentClick}>
          <div
            className="paginated-track"
            ref={trackRef}
            style={{
              transform: `translate3d(-${currentPage * (containerRef.current?.clientWidth || 0)}px, 0, 0)`,
            }}
          >
            <div
              className="paginated-content prose-content"
              style={{
                columnWidth:
                  settings.columnMode === "dual" && (containerRef.current?.clientWidth || 0) > 900
                    ? `${(containerRef.current?.clientWidth || 1000) / 2 - settings.margins * 1.5}px`
                    : `${containerRef.current?.clientWidth || 800}px`,
                columnCount: settings.columnMode === "dual" ? 2 : 1,
              }}
              dangerouslySetInnerHTML={{
                __html: currentChapter ? currentChapter.content_html : "",
              }}
            />
          </div>
        </div>
      ) : (
        <div
          className="scroll-container"
          ref={scrollContainerRef}
          onClick={handleContentClick}
          onScroll={(e) => {
            const target = e.currentTarget;
            const ratio = target.scrollTop / (target.scrollHeight - target.clientHeight || 1);
            recordProgress(currentChapterIndex, activeParaIndex, ratio);
          }}
        >
          <div
            className="scroll-content prose-content"
            dangerouslySetInnerHTML={{
              __html: currentChapter ? currentChapter.content_html : "",
            }}
          />
        </div>
      )}

      {/* Bottom Auto-Hiding HUD */}
      <div className={`reader-hud-bottom ${!hudVisible ? "reader-hud-hidden" : ""}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            className="hud-btn"
            disabled={currentChapterIndex <= 0}
            onClick={() => {
              if (currentChapterIndex > 0) {
                setCurrentChapterIndex((prev) => prev - 1);
                setCurrentPage(0);
              }
            }}
          >
            ← Prev Ch
          </button>
          <span className="telemetry-mono" style={{ fontSize: "11px", color: "var(--ink-secondary)" }}>
            CH {currentChapterIndex + 1} / {chapters.length || 1}
          </span>
          <button
            className="hud-btn"
            disabled={currentChapterIndex >= chapters.length - 1}
            onClick={() => {
              if (currentChapterIndex < chapters.length - 1) {
                setCurrentChapterIndex((prev) => prev + 1);
                setCurrentPage(0);
              }
            }}
          >
            Next Ch →
          </button>
        </div>

        {/* Chapter Scrubber Slider */}
        <input
          type="range"
          min="0"
          max={chapters.length > 0 ? chapters.length - 1 : 0}
          value={currentChapterIndex}
          onChange={(e) => {
            const idx = Number(e.target.value);
            setCurrentChapterIndex(idx);
            setCurrentPage(0);
          }}
          className="hud-slider"
          title="Scrub chapters"
        />

        {/* Telemetry Page Counters & Progress */}
        <div className="telemetry-mono" style={{ fontSize: "11px", color: "var(--ink-secondary)" }}>
          {settings.layoutMode === "paginated" && (
            <span>
              Page {currentPage + 1} / {totalPages} •{" "}
            </span>
          )}
          <span style={{ color: "var(--accent-bookmark)", fontWeight: 500 }}>
            {overallProgress}%
          </span>
        </div>
      </div>

      {/* Typography Popover */}
      {showTypography && (
        <TypographyPopover
          settings={settings}
          onUpdate={onUpdateSettings}
          onClose={() => setShowTypography(false)}
        />
      )}

      {/* Table of Contents & Bookmarks Docked Drawer */}
      <NavigationDrawer
        isOpen={showDrawer}
        activeTab={drawerTab}
        chapters={chapters}
        currentChapterIndex={currentChapterIndex}
        bookmarks={bookmarks}
        onSelectChapter={(idx) => {
          setCurrentChapterIndex(idx);
          setCurrentPage(0);
          setActiveParaIndex(0);
        }}
        onSelectBookmark={(bm) => {
          setCurrentChapterIndex(Number(bm.chapter_index));
          setActiveParaIndex(Number(bm.para_index));
        }}
        onDeleteBookmark={handleDeleteBookmark}
        onClose={() => setShowDrawer(false)}
        onTabChange={(tab) => setDrawerTab(tab)}
      />

      {/* Illustration Zoom & Pan Lightbox */}
      {activeLightboxImg && (
        <Lightbox
          illustrations={currentChapter?.illustrations || [activeLightboxImg]}
          initialSrc={activeLightboxImg}
          onClose={() => setActiveLightboxImg(null)}
        />
      )}
    </div>
  );
};
