import { useState } from "react";
import { Hotspot, BrandCheckResult, IconStyle } from "../types";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { Label } from "@/src/components/ui/label";
import { Badge } from "@/src/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/src/components/ui/tabs";
import { cn } from "@/src/lib/utils";

const ICON_OPTIONS: { value: IconStyle; glyph: string; label: string }[] = [
  { value: "circle", glyph: "●", label: "Circle" },
  { value: "plus", glyph: "+", label: "Plus" },
  { value: "info", glyph: "i", label: "Info" },
  { value: "star", glyph: "★", label: "Star" },
  { value: "pin", glyph: "▼", label: "Pin" },
];

const COLOR_PRESETS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
];

function scoreColorScheme(score: number): "success" | "warning" | "danger" {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "danger";
}

interface HotspotPanelProps {
  hotspots: Hotspot[];
  selectedId: string | null;
  brandCheckResults: BrandCheckResult[];
  isGenerating: boolean;
  generateError: string | null;
  isBrandChecking: boolean;
  brandCheckError: string | null;
  onUpdate: (id: string, updates: Partial<Hotspot>) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onGenerateDescription: (id: string) => void;
  onBrandCheckAll: () => void;
}

export function HotspotPanel({
  hotspots,
  selectedId,
  brandCheckResults,
  isGenerating,
  generateError,
  isBrandChecking,
  brandCheckError,
  onUpdate,
  onDelete,
  onSelect,
  onGenerateDescription,
  onBrandCheckAll,
}: HotspotPanelProps) {
  const [activeTab, setActiveTab] = useState<"hotspots" | "brand">("hotspots");

  const selected = hotspots.find((h) => h.id === selectedId) ?? null;
  const selectedBrand = brandCheckResults.find((r) => r.hotspotId === selectedId) ?? null;

  return (
    <div className="w-75 shrink-0 flex flex-col bg-card rounded-lg border border-border overflow-hidden">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "hotspots" | "brand")}
        className="flex flex-col flex-1 gap-0"
      >
        {/* Tab bar */}
        <TabsList
          variant="line"
          className="w-full h-auto rounded-none border-b border-border bg-transparent px-0"
        >
          <TabsTrigger value="hotspots" variant="line" className="flex-1 rounded-none">
            Hotspots
            {hotspots.length > 0 && (
              <Badge colorScheme="primary" size="sm" className="ml-1.5">
                {hotspots.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="brand" variant="line" className="flex-1 rounded-none">
            Brand Check
          </TabsTrigger>
        </TabsList>

        {/* Hotspots tab */}
        <TabsContent forceMount value="hotspots" className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">
          {hotspots.length === 0 ? (
            <p className="text-muted-foreground text-xs text-center py-6 m-0">
              No hotspots yet — click the image to add one.
            </p>
          ) : (
            <div className="flex flex-col gap-1 mb-3">
              {hotspots.map((h) => {
                const result = brandCheckResults.find((r) => r.hotspotId === h.id);
                const isActive = h.id === selectedId;
                return (
                  <div
                    key={h.id}
                    onClick={() => onSelect(isActive ? null : h.id)}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-md border cursor-pointer transition-colors",
                      isActive
                        ? "bg-primary-bg border-primary-fg"
                        : "border-transparent hover:bg-muted"
                    )}
                  >
                    <div
                      className="w-5.5 h-5.5 shrink-0 flex items-center justify-center text-white text-3xs font-bold rounded-full"
                      style={{ background: h.color }}
                    >
                      {h.iconStyle === "info" ? "i" : h.iconStyle === "plus" ? "+" : h.iconStyle === "star" ? "★" : "●"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold truncate text-foreground">
                        {h.label || "Untitled"}
                      </div>
                      <div className="text-3xs text-muted-foreground">
                        {Math.round(h.x)}%, {Math.round(h.y)}%
                      </div>
                    </div>
                    {result && (
                      <Badge colorScheme={scoreColorScheme(result.score)} size="sm">
                        {result.score}
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      colorScheme="neutral"
                      size="icon-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(h.id);
                      }}
                      title="Delete hotspot"
                      className="shrink-0 text-base leading-none"
                    >
                      ×
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Editor for selected hotspot */}
          {selected && (
            <div className="border-t border-border pt-3 flex flex-col gap-2.5">
              <div className="text-2xs font-bold text-muted-foreground uppercase tracking-widest">
                Edit Hotspot
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="hs-label" className="text-xs">Label</Label>
                <Input
                  id="hs-label"
                  value={selected.label}
                  onChange={(e) => onUpdate(selected.id, { label: e.target.value })}
                  placeholder="e.g. Product Feature"
                  className="h-8 text-sm"
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="hs-aria" className="text-xs">Aria Label</Label>
                <Input
                  id="hs-aria"
                  value={selected.ariaLabel}
                  onChange={(e) => onUpdate(selected.id, { ariaLabel: e.target.value })}
                  placeholder="Screen-reader description"
                  className="h-8 text-sm"
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="hs-desc" className="text-xs">Description</Label>
                <div className="relative">
                  <Textarea
                    id="hs-desc"
                    value={selected.description}
                    onChange={(e) => onUpdate(selected.id, { description: e.target.value })}
                    placeholder="Hotspot description…"
                    rows={3}
                    className="resize-y pr-14 text-sm"
                  />
                  <Button
                    onClick={() => onGenerateDescription(selected.id)}
                    disabled={isGenerating || !selected.label}
                    colorScheme="ai"
                    size="xs"
                    title={!selected.label ? "Add a label first" : "Generate description with AI"}
                    className="absolute top-1.5 right-1.5"
                  >
                    {isGenerating ? "…" : "✨ AI"}
                  </Button>
                  {generateError && (
                    <div className="absolute top-full left-0 right-0 mt-1 text-3xs text-destructive leading-tight">
                      ⚠ {generateError}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="hs-link-href" className="text-xs">Link URL</Label>
                <Input
                  id="hs-link-href"
                  value={selected.link.href}
                  onChange={(e) =>
                    onUpdate(selected.id, { link: { ...selected.link, href: e.target.value } })
                  }
                  placeholder="https://…"
                  className="h-8 text-sm"
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="hs-link-text" className="text-xs">Link Text</Label>
                <Input
                  id="hs-link-text"
                  value={selected.link.text}
                  onChange={(e) =>
                    onUpdate(selected.id, { link: { ...selected.link, text: e.target.value } })
                  }
                  placeholder="Learn more"
                  className="h-8 text-sm"
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label className="text-xs">Icon Style</Label>
                <div className="flex gap-1.5">
                  {ICON_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => onUpdate(selected.id, { iconStyle: opt.value })}
                      title={opt.label}
                      className={cn(
                        "w-7 h-7 rounded-md text-sm font-bold flex items-center justify-center transition-colors cursor-pointer",
                        selected.iconStyle === opt.value
                          ? "border-2 border-primary bg-primary-bg text-primary-fg"
                          : "border border-border bg-muted text-muted-foreground hover:bg-accent",
                        opt.value === "info" ? "italic" : "not-italic"
                      )}
                    >
                      {opt.glyph}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <Label className="text-xs">Color</Label>
                <div className="flex gap-1.5 flex-wrap items-center">
                  {COLOR_PRESETS.map((color) => (
                    <button
                      key={color}
                      onClick={() => onUpdate(selected.id, { color })}
                      title={color}
                      className="w-5.5 h-5.5 rounded-full cursor-pointer p-0 transition-transform hover:scale-110 outline-offset-2"
                      style={{
                        background: color,
                        border: selected.color === color ? "3px solid white" : "2px solid transparent",
                        outline: selected.color === color ? `2px solid ${color}` : "none",
                      }}
                    />
                  ))}
                  <input
                    type="color"
                    value={selected.color}
                    onChange={(e) => onUpdate(selected.id, { color: e.target.value })}
                    title="Custom color"
                    className="w-5.5 h-5.5 rounded-full cursor-pointer bg-transparent border border-gray-300 p-0"
                  />
                </div>
              </div>

              {/* Per-hotspot brand check result */}
              {selectedBrand && (
                <div
                  className={cn(
                    "rounded-lg p-2.5 border",
                    selectedBrand.score >= 80
                      ? "border-success/40 bg-success-bg"
                      : selectedBrand.score >= 60
                      ? "border-warning/40 bg-warning-bg"
                      : "border-danger/40 bg-danger-bg"
                  )}
                >
                  <div className="flex justify-between items-center mb-1.5">
                    <div className="text-2xs font-semibold text-muted-foreground">Brand Score</div>
                    <Badge colorScheme={scoreColorScheme(selectedBrand.score)}>
                      {selectedBrand.score} / 100
                    </Badge>
                  </div>
                  {selectedBrand.issues.map((issue, i) => (
                    <div key={i} className="text-danger-fg text-xs mb-0.5">⚠ {issue}</div>
                  ))}
                  {selectedBrand.suggestions.map((s, i) => (
                    <div key={i} className="text-success-fg text-xs mb-0.5">→ {s}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* Brand Check tab */}
        <TabsContent forceMount value="brand" className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
          <p className="text-muted-foreground text-xs leading-relaxed m-0">
            Runs a brand compliance audit on all hotspot content — labels, descriptions, aria-labels, and copy quality.
          </p>
          <Button
            onClick={onBrandCheckAll}
            disabled={isBrandChecking || hotspots.length === 0}
            colorScheme="ai"
            className="w-full"
          >
            {isBrandChecking ? "Checking…" : "✨ Run Brand Check"}
          </Button>
          {brandCheckError && (
            <div className="text-destructive text-xs leading-tight">
              ⚠ {brandCheckError}
            </div>
          )}

          {brandCheckResults.length > 0 && (
            <div className="flex flex-col gap-2">
              {brandCheckResults.map((result) => {
                const hotspot = hotspots.find((h) => h.id === result.hotspotId);
                return (
                  <div
                    key={result.hotspotId}
                    onClick={() => {
                      onSelect(result.hotspotId);
                      setActiveTab("hotspots");
                    }}
                    className={cn(
                      "rounded-lg p-2.5 border cursor-pointer transition-colors hover:bg-muted",
                      result.score >= 80 ? "border-success/40" :
                      result.score >= 60 ? "border-warning/40" :
                      "border-danger/40"
                    )}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <div className="text-xs font-semibold text-foreground truncate">
                        {hotspot?.label || result.hotspotId}
                      </div>
                      <Badge colorScheme={scoreColorScheme(result.score)} size="sm">
                        {result.score}/100
                      </Badge>
                    </div>
                    {result.issues.map((issue, i) => (
                      <div key={i} className="text-danger-fg text-xs mb-0.5">⚠ {issue}</div>
                    ))}
                    {result.suggestions.map((s, i) => (
                      <div key={i} className="text-success-fg text-xs mb-0.5">→ {s}</div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
