import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface TitleBarProps {
  title?: string;
}

export const TitleBar: React.FC<TitleBarProps> = ({ title = "BUNKOREADER" }) => {
  const appWindow = getCurrentWindow();

  const handleMinimize = () => {
    appWindow.minimize().catch(console.error);
  };

  const handleMaximize = () => {
    appWindow.toggleMaximize().catch(console.error);
  };

  const handleClose = () => {
    appWindow.close().catch(console.error);
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-drag-region" data-tauri-drag-region>
        <span className="titlebar-title" data-tauri-drag-region>
          {title}
        </span>
      </div>

      <div className="window-controls">
        <button
          className="window-control-btn"
          onClick={handleMinimize}
          title="Minimize"
          aria-label="Minimize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <rect y="5" width="10" height="1" />
          </svg>
        </button>

        <button
          className="window-control-btn"
          onClick={handleMaximize}
          title="Maximize"
          aria-label="Maximize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <rect x="0.5" y="0.5" width="9" height="9" strokeWidth="1" />
          </svg>
        </button>

        <button
          className="window-control-btn close"
          onClick={handleClose}
          title="Close"
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <polygon points="10,0.7 9.3,0 5,4.3 0.7,0 0,0.7 4.3,5 0,9.3 0.7,10 5,5.7 9.3,10 10,9.3 5.7,5" />
          </svg>
        </button>
      </div>
    </div>
  );
};
