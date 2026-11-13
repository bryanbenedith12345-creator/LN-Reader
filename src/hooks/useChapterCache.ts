import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ProcessedChapter } from "../types";

const MAX_CACHE_SIZE = 5;

export function useChapterCache(bookId: string, totalChapters: number) {
  const [currentChapter, setCurrentChapter] = useState<ProcessedChapter | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // In-memory LRU cache: chapter_index -> ProcessedChapter
  const cacheRef = useRef<Map<number, ProcessedChapter>>(new Map());

  // Debounce ref for saving progress to SQLite
  const pendingProgressRef = useRef<{
    chapterIndex: number;
    paraIndex: number;
    scrollRatio: number;
  } | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);

  // Flush pending progress immediately
  const flushProgress = useCallback(() => {
    if (pendingProgressRef.current && bookId) {
      const { chapterIndex, paraIndex, scrollRatio } = pendingProgressRef.current;
      invoke("save_progress", {
        bookId,
        chapterIndex,
        paraIndex,
        scrollRatio,
      }).catch((err) => {
        console.error("[BunkoReader] Failed to flush progress to DB:", err);
      });
      pendingProgressRef.current = null;
    }
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
  }, [bookId]);

  // Queue progress update with 500ms trailing debounce
  const recordProgress = useCallback(
    (chapterIndex: number, paraIndex: number, scrollRatio: number) => {
      pendingProgressRef.current = { chapterIndex, paraIndex, scrollRatio };

      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = window.setTimeout(() => {
        flushProgress();
      }, 500);
    },
    [flushProgress]
  );

  // Prefetch a chapter in the background
  const prefetchChapter = useCallback(
    async (idx: number) => {
      if (idx < 0 || idx >= totalChapters) return;
      if (cacheRef.current.has(idx)) return;

      try {
        const chapter = await invoke<ProcessedChapter>("load_chapter", {
          bookId,
          chapterIndex: idx,
        });

        // Maintain LRU size <= 5
        if (cacheRef.current.size >= MAX_CACHE_SIZE) {
          const oldestKey = cacheRef.current.keys().next().value;
          if (oldestKey !== undefined) {
            cacheRef.current.delete(oldestKey);
          }
        }

        cacheRef.current.set(idx, chapter);
      } catch (e) {
        // Silent background prefetch fail
      }
    },
    [bookId, totalChapters]
  );

  // Main loader: 0ms if in cache, otherwise fast Tauri IPC
  const fetchChapter = useCallback(
    async (idx: number) => {
      if (idx < 0 || idx >= totalChapters) return;

      // Hit from RAM cache
      if (cacheRef.current.has(idx)) {
        const cached = cacheRef.current.get(idx)!;
        // Re-insert to refresh LRU order
        cacheRef.current.delete(idx);
        cacheRef.current.set(idx, cached);
        setCurrentChapter(cached);
        setError(null);
        setLoading(false);

        // Silent prefetch adjacent chapters
        prefetchChapter(idx + 1);
        prefetchChapter(idx - 1);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const chapter = await invoke<ProcessedChapter>("load_chapter", {
          bookId,
          chapterIndex: idx,
        });

        if (cacheRef.current.size >= MAX_CACHE_SIZE) {
          const oldestKey = cacheRef.current.keys().next().value;
          if (oldestKey !== undefined) {
            cacheRef.current.delete(oldestKey);
          }
        }
        cacheRef.current.set(idx, chapter);

        setCurrentChapter(chapter);

        // Silent prefetch adjacent chapters
        prefetchChapter(idx + 1);
        prefetchChapter(idx - 1);
      } catch (err: unknown) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [bookId, totalChapters, prefetchChapter]
  );

  // Attach unload/visibility change listeners to guarantee zero data loss
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushProgress();
      }
    };

    const handleBeforeUnload = () => {
      flushProgress();
    };

    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      flushProgress();
    };
  }, [flushProgress]);

  // Clear cache if book changes
  useEffect(() => {
    cacheRef.current.clear();
  }, [bookId]);

  return {
    currentChapter,
    loading,
    error,
    fetchChapter,
    recordProgress,
    flushProgress,
  };
}
