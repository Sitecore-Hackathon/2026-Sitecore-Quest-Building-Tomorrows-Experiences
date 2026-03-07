"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Hotspot, IconStyle } from "../types";
import { cn } from "@/src/lib/utils";

const ICON_GLYPHS: Record<IconStyle, string> = {
  circle: "●",
  plus: "+",
  info: "i",
  star: "★",
  pin: "▼",
};

interface HotspotCanvasProps {
  imageUrl: string;
  hotspots: Hotspot[];
  selectedId: string | null;
  onAdd: (x: number, y: number) => void;
  onMove: (id: string, x: number, y: number) => void;
  onSelect: (id: string | null) => void;
}

export function HotspotCanvas({
  imageUrl,
  hotspots,
  selectedId,
  onAdd,
  onMove,
  onSelect,
}: HotspotCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Reset image state whenever the URL changes
  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
  }, [imageUrl]);

  const getRelativePos = useCallback(
    (e: React.MouseEvent): { x: number; y: number } => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
        y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
      };
    },
    []
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (draggingId) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-hotspot-pin]")) return;
      const pos = getRelativePos(e);
      onAdd(pos.x, pos.y);
    },
    [draggingId, getRelativePos, onAdd]
  );

  const handlePinMouseDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      e.preventDefault();
      onSelect(id);
      setDraggingId(id);
    },
    [onSelect]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!draggingId) return;
      const pos = getRelativePos(e);
      onMove(draggingId, pos.x, pos.y);
    },
    [draggingId, getRelativePos, onMove]
  );

  const handleMouseUp = useCallback(() => {
    setDraggingId(null);
  }, []);

  // Release drag even when mouse is released outside the canvas
  useEffect(() => {
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseUp]);

  if (!imageUrl) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#1a1a2e] rounded-lg border-2 border-dashed border-[#333] text-[#555] text-sm gap-2.5 min-h-100">
        <div className="text-[40px]">🖼️</div>
        <div className="font-semibold text-[#666]">No image selected</div>
        <div className="text-xs">Select an image for the chosen device size to add hotspots</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex-1 relative overflow-hidden bg-black rounded-lg border border-border select-none min-h-100 self-start",
        draggingId ? "cursor-grabbing" : "cursor-crosshair"
      )}
      onClick={handleCanvasClick}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {imageError ? (
        <div className="min-h-100 flex flex-col items-center justify-center bg-[#1a1a2e] text-red-500 gap-2 text-sm">
          <div className="text-[36px]">⚠️</div>
          <div>Could not load image</div>
          <div className="text-[#888] text-xs">Check the URL and try again</div>
        </div>
      ) : (
        <img
          src={imageUrl}
          alt="Hotspot canvas"
          className="w-full h-auto block pointer-events-none"
          onError={() => { setImageError(true); setImageLoaded(false); }}
          onLoad={() => { setImageError(false); setImageLoaded(true); }}
        />
      )}

      {/* Hotspot pins */}
      {imageLoaded &&
        hotspots.map((hotspot) => {
          const isSelected = selectedId === hotspot.id;
          const isHovered = hoveredId === hotspot.id;
          const showTooltip = isSelected || isHovered;
          return (
            <div
              key={hotspot.id}
              data-hotspot-pin="true"
              role="button"
              tabIndex={0}
              aria-label={hotspot.ariaLabel || hotspot.label || "Hotspot"}
              onMouseDown={(e) => handlePinMouseDown(e, hotspot.id)}
              onMouseEnter={() => setHoveredId(hotspot.id)}
              onMouseLeave={() => setHoveredId(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(hotspot.id);
                }
              }}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 w-8.5 h-8.5 rounded-full cursor-grab flex items-center justify-center text-white font-bold transition-shadow duration-150 outline-none",
                isSelected ? "border-[3px] border-white z-20" : "border-2 border-white/50 z-10",
                hotspot.iconStyle === "info" ? "text-xs italic" : "text-[15px] not-italic"
              )}
              style={{
                left: `${hotspot.x}%`,
                top: `${hotspot.y}%`,
                background: hotspot.color || "#3b82f6",
                boxShadow: isSelected
                  ? `0 0 0 3px ${hotspot.color || "#3b82f6"}, 0 6px 20px rgba(0,0,0,0.6)`
                  : "0 2px 10px rgba(0,0,0,0.5)",
              }}
            >
              {ICON_GLYPHS[hotspot.iconStyle] ?? ICON_GLYPHS.circle}

              {/* Tooltip label — flips below pin when near the top edge */}
              <div
                className={cn(
                  "absolute left-1/2 -translate-x-1/2 bg-black/90 text-white py-1 px-2.5 rounded text-2xs font-medium whitespace-nowrap pointer-events-none transition-opacity duration-150 not-italic shadow-[0_2px_8px_rgba(0,0,0,0.4)]",
                  hotspot.y < 15 ? "top-[calc(100%+8px)]" : "bottom-[calc(100%+8px)]",
                  showTooltip ? "opacity-100" : "opacity-0"
                )}
              >
                {hotspot.label || "Untitled"}
              </div>
            </div>
          );
        })}

      {/* Empty-state hint */}
      {imageLoaded && hotspots.length === 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/75 text-gray-300 py-2 px-4.5 rounded-[20px] text-xs pointer-events-none whitespace-nowrap">
          Click anywhere on the image to place a hotspot
        </div>
      )}
    </div>
  );
}
