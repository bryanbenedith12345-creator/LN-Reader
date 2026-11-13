import React, { useState, useEffect, useRef } from "react";

interface LightboxProps {
  illustrations: string[];
  initialSrc: string;
  onClose: () => void;
}

export const Lightbox: React.FC<LightboxProps> = ({
  illustrations,
  initialSrc,
  onClose,
}) => {
  const currentIndex = illustrations.indexOf(initialSrc);
  const [activeIdx, setActiveIdx] = useState(currentIndex >= 0 ? currentIndex : 0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Reset zoom & pan when image changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [activeIdx]);

  // Keyboard navigation inside lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowRight") {
        if (activeIdx < illustrations.length - 1) {
          setActiveIdx((prev) => prev + 1);
        }
      } else if (e.key === "ArrowLeft") {
        if (activeIdx > 0) {
          setActiveIdx((prev) => prev - 1);
        }
      } else if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(z + 0.25, 4.0));
      } else if (e.key === "-") {
        setZoom((z) => Math.max(z - 0.25, 0.5));
      } else if (e.key === "0") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIdx, illustrations.length, onClose]);

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    const delta = e.deltaY * -0.002;
    setZoom((prev) => Math.min(Math.max(0.5, prev + delta), 4.0));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left-click
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const currentImg = illustrations[activeIdx] || initialSrc;

  return (
    <div
      className="lightbox-backdrop"
      onClick={onClose}
      onWheel={handleWheel}
      onMouseUp={handleMouseUp}
    >
      <div
        className="lightbox-img-wrapper"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
      >
        <img
          src={currentImg}
          alt={`Illustration ${activeIdx + 1}`}
          className={`lightbox-img ${zoom > 1 ? "zoomed" : ""}`}
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          }}
          draggable={false}
        />
      </div>

      <div className="lightbox-hud" onClick={(e) => e.stopPropagation()}>
        <span>
          {activeIdx + 1} / {illustrations.length || 1}
        </span>
        <span>•</span>
        <span>{Math.round(zoom * 100)}%</span>
        <span>•</span>
        <button
          className="hud-btn"
          style={{ height: "20px", padding: "0 6px", fontSize: "11px" }}
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          Reset
        </button>
        <span>•</span>
        <span style={{ opacity: 0.7 }}>[ESC] Close</span>
      </div>
    </div>
  );
};
