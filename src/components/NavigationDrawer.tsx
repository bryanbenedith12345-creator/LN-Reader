import React from "react";
import { BookmarkRecord, ChapterRecord } from "../types";

export type DrawerTab = "toc" | "bookmarks";

interface NavigationDrawerProps {
  isOpen: boolean;
  activeTab: DrawerTab;
  chapters: ChapterRecord[];
  currentChapterIndex: number;
  bookmarks: BookmarkRecord[];
  onSelectChapter: (index: number) => void;
  onSelectBookmark: (bookmark: BookmarkRecord) => void;
  onDeleteBookmark: (id: string) => void;
  onClose: () => void;
  onTabChange: (tab: DrawerTab) => void;
}

export const NavigationDrawer: React.FC<NavigationDrawerProps> = ({
  isOpen,
  activeTab,
  chapters,
  currentChapterIndex,
  bookmarks,
  onSelectChapter,
  onSelectBookmark,
  onDeleteBookmark,
  onClose,
  onTabChange,
}) => {
  return (
    <div
      className={`docked-drawer ${isOpen ? "open" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="drawer-header">
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className={`hud-btn ${activeTab === "toc" ? "active" : ""}`}
            onClick={() => onTabChange("toc")}
          >
            Contents ({chapters.length})
          </button>
          <button
            className={`hud-btn ${activeTab === "bookmarks" ? "active" : ""}`}
            onClick={() => onTabChange("bookmarks")}
          >
            Bookmarks ({bookmarks.length})
          </button>
        </div>

        <button className="window-control-btn close" onClick={onClose} title="Close Drawer">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <polygon points="10,0.7 9.3,0 5,4.3 0.7,0 0,0.7 4.3,5 0,9.3 0.7,10 5,5.7 9.3,10 10,9.3 5.7,5" />
          </svg>
        </button>
      </div>

      <div className="drawer-list">
        {activeTab === "toc" && (
          <div>
            {chapters.map((ch) => (
              <div
                key={ch.id}
                className={`drawer-item ${ch.chapter_index === currentChapterIndex ? "active" : ""}`}
                onClick={() => {
                  onSelectChapter(ch.chapter_index);
                  onClose();
                }}
              >
                <span className="drawer-item-title">{ch.title}</span>
                <span className="drawer-item-meta">
                  {ch.word_count > 0 ? `${(ch.word_count / 1000).toFixed(1)}k words` : ""}
                </span>
              </div>
            ))}
          </div>
        )}

        {activeTab === "bookmarks" && (
          <div>
            {bookmarks.length === 0 ? (
              <div style={{ padding: "24px 16px", color: "var(--ink-secondary)", fontSize: "12px", textAlign: "center" }}>
                No bookmarks saved yet.<br />
                Press <code className="telemetry-mono">[M]</code> or <code className="telemetry-mono">[Cmd/Ctrl + D]</code> while reading.
              </div>
            ) : (
              bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  className="drawer-item"
                  style={{ flexDirection: "column", gap: 4, alignItems: "stretch" }}
                  onClick={() => {
                    onSelectBookmark(bm);
                    onClose();
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: "11px", color: "var(--accent-bookmark)" }}>
                      CH {bm.chapter_index + 1} • P {bm.para_index + 1}
                    </span>
                    <button
                      className="window-control-btn close"
                      style={{ width: "18px", height: "18px" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteBookmark(bm.id);
                      }}
                      title="Delete bookmark"
                    >
                      <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
                        <polygon points="10,0.7 9.3,0 5,4.3 0.7,0 0,0.7 4.3,5 0,9.3 0.7,10 5,5.7 9.3,10 10,9.3 5.7,5" />
                      </svg>
                    </button>
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--ink-primary)",
                      fontStyle: "italic",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    "{bm.snippet}"
                  </div>
                  <div className="drawer-item-meta" style={{ alignSelf: "flex-end" }}>
                    {new Date(bm.created_at * 1000).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
