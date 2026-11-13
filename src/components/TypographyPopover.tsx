import React from "react";
import { FontFamily, LayoutMode, ColumnMode, TextAlign, ThemeMode, ReaderSettings } from "../types";

interface TypographyPopoverProps {
  settings: ReaderSettings;
  onUpdate: (updater: (prev: ReaderSettings) => ReaderSettings) => void;
  onClose: () => void;
}

export const TypographyPopover: React.FC<TypographyPopoverProps> = ({
  settings,
  onUpdate,
}) => {
  const themes: { id: ThemeMode; label: string; bg: string; text: string }[] = [
    { id: "washi", label: "Washi", bg: "#F7F5F0", text: "#1E1D1A" },
    { id: "kinari", label: "Kinari", bg: "#F2E8D5", text: "#2A2017" },
    { id: "sumi", label: "Sumi", bg: "#131312", text: "#D8D4C9" },
    { id: "aizome", label: "Aizome", bg: "#12161D", text: "#D2D9E5" },
  ];

  const fonts: { id: FontFamily; label: string }[] = [
    { id: "literata", label: "Literata" },
    { id: "newsreader", label: "Newsreader" },
    { id: "mincho", label: "Shippori Mincho" },
    { id: "system", label: "System Sans" },
  ];

  return (
    <div className="typography-popover" onClick={(e) => e.stopPropagation()}>
      {/* Theme Selection */}
      <div className="setting-group">
        <div className="setting-row" style={{ marginBottom: 6 }}>
          <span className="setting-label">Paper & Ink</span>
          <span className="setting-value">{settings.theme.toUpperCase()}</span>
        </div>
        <div className="theme-swatches">
          {themes.map((th) => (
            <button
              key={th.id}
              className={`theme-swatch-btn ${settings.theme === th.id ? "active" : ""}`}
              style={{ backgroundColor: th.bg, color: th.text }}
              onClick={() => onUpdate((s) => ({ ...s, theme: th.id }))}
            >
              {th.label}
            </button>
          ))}
        </div>
      </div>

      {/* Font Family */}
      <div className="setting-group">
        <div className="setting-row" style={{ marginBottom: 6 }}>
          <span className="setting-label">Typeface</span>
          <span className="setting-value">{settings.fontFamily}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {fonts.map((f) => (
            <button
              key={f.id}
              className={`hud-btn ${settings.fontFamily === f.id ? "active" : ""}`}
              style={{ justifyContent: "center" }}
              onClick={() => onUpdate((s) => ({ ...s, fontFamily: f.id }))}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Font Size */}
      <div className="setting-row">
        <span className="setting-label">Font Size</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="range"
            min="14"
            max="30"
            step="1"
            value={settings.fontSize}
            onChange={(e) => {
              const val = Number(e.target.value);
              onUpdate((s) => ({ ...s, fontSize: val }));
            }}
            className="hud-slider"
            style={{ maxWidth: 120, margin: 0 }}
          />
          <span className="setting-value" style={{ width: "36px", textAlign: "right" }}>
            {settings.fontSize}px
          </span>
        </div>
      </div>

      {/* Line Height */}
      <div className="setting-row">
        <span className="setting-label">Line Height</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="range"
            min="1.40"
            max="2.10"
            step="0.05"
            value={settings.lineHeight}
            onChange={(e) => {
              const val = Number(e.target.value);
              onUpdate((s) => ({ ...s, lineHeight: val }));
            }}
            className="hud-slider"
            style={{ maxWidth: 120, margin: 0 }}
          />
          <span className="setting-value" style={{ width: "36px", textAlign: "right" }}>
            {settings.lineHeight.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Line Measure / Width */}
      <div className="setting-row">
        <span className="setting-label">Measure (ch)</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="range"
            min="50"
            max="82"
            step="2"
            value={settings.maxWidth}
            onChange={(e) => {
              const val = Number(e.target.value);
              onUpdate((s) => ({ ...s, maxWidth: val }));
            }}
            className="hud-slider"
            style={{ maxWidth: 120, margin: 0 }}
          />
          <span className="setting-value" style={{ width: "36px", textAlign: "right" }}>
            {settings.maxWidth}ch
          </span>
        </div>
      </div>

      {/* Paragraph Gap */}
      <div className="setting-row">
        <span className="setting-label">Paragraph Gap</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="range"
            min="0.4"
            max="1.8"
            step="0.05"
            value={settings.paraGap}
            onChange={(e) => {
              const val = Number(e.target.value);
              onUpdate((s) => ({ ...s, paraGap: val }));
            }}
            className="hud-slider"
            style={{ maxWidth: 120, margin: 0 }}
          />
          <span className="setting-value" style={{ width: "36px", textAlign: "right" }}>
            {settings.paraGap.toFixed(2)}em
          </span>
        </div>
      </div>

      {/* Margins */}
      <div className="setting-row">
        <span className="setting-label">Page Margins</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="range"
            min="24"
            max="96"
            step="4"
            value={settings.margins}
            onChange={(e) => {
              const val = Number(e.target.value);
              onUpdate((s) => ({ ...s, margins: val }));
            }}
            className="hud-slider"
            style={{ maxWidth: 120, margin: 0 }}
          />
          <span className="setting-value" style={{ width: "36px", textAlign: "right" }}>
            {settings.margins}px
          </span>
        </div>
      </div>

      {/* Layout Engine */}
      <div className="setting-row">
        <span className="setting-label">Layout Flow</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            className={`hud-btn ${settings.layoutMode === "paginated" ? "active" : ""}`}
            onClick={() => onUpdate((s) => ({ ...s, layoutMode: "paginated" as LayoutMode }))}
          >
            Spread
          </button>
          <button
            className={`hud-btn ${settings.layoutMode === "scroll" ? "active" : ""}`}
            onClick={() => onUpdate((s) => ({ ...s, layoutMode: "scroll" as LayoutMode }))}
          >
            Scroll
          </button>
        </div>
      </div>

      {/* Column Mode for Paginated */}
      {settings.layoutMode === "paginated" && (
        <div className="setting-row">
          <span className="setting-label">Columns</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              className={`hud-btn ${settings.columnMode === "single" ? "active" : ""}`}
              onClick={() => onUpdate((s) => ({ ...s, columnMode: "single" as ColumnMode }))}
            >
              1 Col
            </button>
            <button
              className={`hud-btn ${settings.columnMode === "dual" ? "active" : ""}`}
              onClick={() => onUpdate((s) => ({ ...s, columnMode: "dual" as ColumnMode }))}
            >
              2 Col
            </button>
          </div>
        </div>
      )}

      {/* Text Alignment */}
      <div className="setting-row">
        <span className="setting-label">Alignment</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            className={`hud-btn ${settings.textAlign === "justify" ? "active" : ""}`}
            onClick={() => onUpdate((s) => ({ ...s, textAlign: "justify" as TextAlign }))}
          >
            Justify
          </button>
          <button
            className={`hud-btn ${settings.textAlign === "left" ? "active" : ""}`}
            onClick={() => onUpdate((s) => ({ ...s, textAlign: "left" as TextAlign }))}
          >
            Left
          </button>
        </div>
      </div>

      {/* Furigana */}
      <div className="setting-row">
        <span className="setting-label">Ruby Furigana</span>
        <button
          className={`hud-btn ${settings.showFurigana ? "active" : ""}`}
          onClick={() => onUpdate((s) => ({ ...s, showFurigana: !s.showFurigana }))}
        >
          {settings.showFurigana ? "Showing" : "Hidden"}
        </button>
      </div>
    </div>
  );
};
