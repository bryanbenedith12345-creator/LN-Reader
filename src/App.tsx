import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BookRecord, DEFAULT_SETTINGS, ReaderSettings } from "./types";
import { TitleBar } from "./components/TitleBar";
import { LibraryView } from "./components/LibraryView";
import { ReaderView } from "./components/ReaderView";

export const App: React.FC = () => {
  const [selectedBook, setSelectedBook] = useState<BookRecord | null>(null);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);

  // Load saved settings from SQLite
  useEffect(() => {
    invoke<string | null>("get_setting", { key: "reader_settings" })
      .then((raw) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            setSettings((prev) => ({ ...prev, ...parsed }));
          } catch (e) {
            console.error("Failed to parse saved settings:", e);
          }
        }
      })
      .catch((err) => {
        console.error("Failed to fetch settings from DB:", err);
      });
  }, []);

  // Sync settings to CSS custom properties & SQLite
  useEffect(() => {
    const root = document.documentElement;

    // Theme attribute
    root.setAttribute("data-theme", settings.theme);

    // Dynamic reader typography variables
    root.style.setProperty("--reader-font-size", `${settings.fontSize}px`);
    root.style.setProperty("--reader-line-height", `${settings.lineHeight}`);
    root.style.setProperty("--reader-max-width", `${settings.maxWidth}ch`);
    root.style.setProperty("--reader-para-gap", `${settings.paraGap}em`);
    root.style.setProperty("--reader-margin-x", `${settings.margins}px`);
    root.style.setProperty("--reader-text-align", settings.textAlign);

    // Font family mapping
    let fontVar = "var(--font-serif-literata)";
    if (settings.fontFamily === "newsreader") fontVar = "var(--font-serif-newsreader)";
    else if (settings.fontFamily === "mincho") fontVar = "var(--font-serif-mincho)";
    else if (settings.fontFamily === "system") fontVar = "var(--font-serif-system)";
    root.style.setProperty("--reader-font-family", fontVar);

    // Furigana toggle
    root.setAttribute("data-hide-furigana", settings.showFurigana ? "false" : "true");

    // Persist to DB asynchronously
    invoke("set_setting", {
      key: "reader_settings",
      value: JSON.stringify(settings),
    }).catch((e) => console.error("Failed to persist settings:", e));
  }, [settings]);

  return (
    <div className="app-shell">
      <TitleBar title={selectedBook ? selectedBook.title : "BUNKOREADER"} />

      {selectedBook ? (
        <ReaderView
          book={selectedBook}
          settings={settings}
          onUpdateSettings={setSettings}
          onBackToLibrary={() => setSelectedBook(null)}
        />
      ) : (
        <LibraryView onOpenBook={(book) => setSelectedBook(book)} />
      )}
    </div>
  );
};

export default App;
