"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useMarketplaceClient } from "@/src/utils/hooks/useMarketplaceClient";
import type { ApplicationContext } from "@sitecore-marketplace-sdk/client";
import { Hotspot, SmartSpotData, BrandCheckResult, AIDetectedSpot } from "./types";
import { HotspotCanvas } from "./components/HotspotCanvas";
import { HotspotPanel } from "./components/HotspotPanel";
import { fetchBrandKit, BrandKitContext } from "./utils/brandKit";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return `hs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeHotspot(x: number, y: number): Hotspot {
  return {
    id: generateId(),
    x,
    y,
    label: "",
    description: "",
    link: { href: "", text: "" },
    iconStyle: "circle",
    color: "#3b82f6",
    ariaLabel: "",
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SmartSpotPage() {
  const { client, isInitialized, isLoading: sdkLoading, error } = useMarketplaceClient({ retryAttempts: 1 });
  const [appContext, setAppContext] = useState<ApplicationContext>();
  const [brandKit, setBrandKit] = useState<BrandKitContext | null>(null);

  const [imageUrl, setImageUrl] = useState("");
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [brandCheckResults, setBrandCheckResults] = useState<BrandCheckResult[]>([]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isBrandChecking, setIsBrandChecking] = useState(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [autoDetectError, setAutoDetectError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // ── SDK initialisation — mirrors the pattern used across all starter examples ──
  const unsubPagesContext = useRef<(() => void) | undefined>(undefined);
  const isMounted = useRef(true);
  useEffect(() => { return () => { isMounted.current = false; }; }, []);

  useEffect(() => {
    if (!error && isInitialized && client) {
      // Load the current field value via the SDK's getValue() API
      client
        .getValue()
        .then((value: string | null) => {
          if (!value) return;
          try {
            const data = JSON.parse(value) as SmartSpotData;
            setImageUrl(data.imageUrl ?? "");
            setHotspots(data.hotspots ?? []);
          } catch {
            // Field value is not SmartSpot JSON — start fresh
          }
        })
        .catch((err) => console.error("Error retrieving field value:", err));

      // App context — name is forwarded to AI prompts as page context
      client
        .query("application.context")
        .then((res) => {
          setAppContext(res.data as ApplicationContext);
        })
        .catch((err) => console.error("Error retrieving application.context:", err));

      // Subscribe to pages.context so the brand kit refreshes if the author
      // switches page while the extension is open
      const resolveBrandKit = async (data: unknown) => {
        const brandKitId = (data as { siteInfo?: { brandKitId?: string } })
          ?.siteInfo?.brandKitId;
        if (brandKitId) {
          const kit = await fetchBrandKit(client, brandKitId);
          setBrandKit(kit);
        }
      };

      client
        .query("pages.context", {
          subscribe: true,
          onSuccess: (data) => {
            resolveBrandKit(data).catch(() => {});
          },
        })
        .then((result) => {
          unsubPagesContext.current = result.unsubscribe;
          resolveBrandKit(result.data).catch(() => {});
        })
        .catch((err) => console.error("Error retrieving pages.context:", err));
    } else if (error) {
      console.error("Error initializing Marketplace client:", error);
    }

    return () => {
      unsubPagesContext.current?.();
    };
  }, [client, error, isInitialized]);

  // ── Hotspot mutations ──────────────────────────────────────────────────────
  const handleAdd = useCallback((x: number, y: number) => {
    const spot = makeHotspot(x, y);
    setHotspots((prev) => [...prev, spot]);
    setSelectedId(spot.id);
  }, []);

  const handleMove = useCallback((id: string, x: number, y: number) => {
    setHotspots((prev) =>
      prev.map((h) => (h.id === id ? { ...h, x, y } : h))
    );
  }, []);

  const handleUpdate = useCallback((id: string, updates: Partial<Hotspot>) => {
    setHotspots((prev) =>
      prev.map((h) => (h.id === id ? { ...h, ...updates } : h))
    );
  }, []);

  const handleDelete = useCallback((id: string) => {
    setHotspots((prev) => prev.filter((h) => h.id !== id));
    setBrandCheckResults((prev) => prev.filter((r) => r.hotspotId !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  }, []);

  // ── AI: generate description ───────────────────────────────────────────────
  const handleGenerateDescription = useCallback(
    async (id: string) => {
      const spot = hotspots.find((h) => h.id === id);
      if (!spot?.label) return;

      setIsGenerating(true);
      try {
        const res = await fetch("/api/smartspot/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: spot.label,
            context: appContext?.name ?? "",
            brandContext: brandKit?.summary ?? "",
          }),
        });
        const data = await res.json();
        handleUpdate(id, { description: data.description ?? "" });
      } catch (err) {
        console.error("Generate description error:", err);
      } finally {
        setIsGenerating(false);
      }
    },
    [hotspots, appContext, brandKit, handleUpdate]
  );

  // ── AI: brand check ────────────────────────────────────────────────────────
  const handleBrandCheckAll = useCallback(async () => {
    if (!hotspots.length) return;
    setIsBrandChecking(true);
    try {
      const res = await fetch("/api/smartspot/brandcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hotspots, brandContext: brandKit?.summary ?? "" }),
      });
      const data = await res.json();
      setBrandCheckResults(data.results ?? []);
    } catch (err) {
      console.error("Brand check error:", err);
    } finally {
      setIsBrandChecking(false);
    }
  }, [hotspots, brandKit]);

  // ── AI: vision auto-detect ─────────────────────────────────────────────────
  const handleAutoDetect = useCallback(async () => {
    if (!imageUrl) return;
    setIsAutoDetecting(true);
    setAutoDetectError(null);
    try {
      const res = await fetch("/api/smartspot/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setAutoDetectError(data.error ?? "Auto-detect failed");
        return;
      }
      const suggestions: AIDetectedSpot[] = data.suggestions ?? [];
      const newSpots = suggestions.map((s) => ({
        ...makeHotspot(s.x, s.y),
        label: s.label,
        description: s.description,
        ariaLabel: s.label,
      }));
      setHotspots((prev) => [...prev, ...newSpots]);
      if (newSpots.length > 0) setSelectedId(newSpots[0].id);
    } catch (err) {
      setAutoDetectError(err instanceof Error ? err.message : "Auto-detect failed");
    } finally {
      setIsAutoDetecting(false);
    }
  }, [imageUrl]);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!client) return;
    setSaveStatus("saving");
    try {
      const payload: SmartSpotData = { imageUrl, hotspots };
      // canvasReload: true tells Sitecore to refresh the page preview after save
      await client.setValue(JSON.stringify(payload), true);
      setSaveStatus("saved");
      // Close the field extension panel after confirming save to the author
      setTimeout(() => { if (isMounted.current) client.closeApp(); }, 1200);
    } catch (err) {
      console.error("Save error:", err);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 2500);
    }
  }, [client, imageUrl, hotspots]);

  // ── Accessibility stats ────────────────────────────────────────────────────
  const withAriaLabel = hotspots.filter((h) => h.ariaLabel.trim()).length;
  const withDescription = hotspots.filter((h) => h.description.trim()).length;
  const avgScore =
    brandCheckResults.length > 0
      ? Math.round(
          brandCheckResults.reduce((sum, r) => sum + r.score, 0) /
            brandCheckResults.length
        )
      : null;

  // ── Loading state ──────────────────────────────────────────────────────────
  const isLoading = sdkLoading;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background text-muted-foreground text-sm gap-1">
        <div className="text-4xl">🎯</div>
        <div className="font-semibold text-foreground">SmartSpot</div>
        <div>Initializing…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col p-3.5 gap-2.5 font-sans box-border">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-card rounded-lg border border-border flex-wrap">
        {/* Brand mark */}
        <div className="flex items-center gap-2 mr-1">
          <div className="text-2xl">🎯</div>
          <div>
            <div className="font-bold text-sm tracking-tight">SmartSpot</div>
            <div className="text-muted-foreground text-[10px] tracking-wide">AI Hotspot Editor</div>
          </div>
        </div>

        {/* Image URL */}
        <Input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="Image URL…"
          className="flex-1 min-w-44 h-9 text-sm"
        />

        {/* Auto-detect */}
        <div className="flex flex-col gap-1">
          <Button
            onClick={handleAutoDetect}
            disabled={isAutoDetecting || !imageUrl}
            colorScheme="ai"
            size="sm"
            title="Use Claude Vision to auto-place hotspots"
          >
            {isAutoDetecting ? "Detecting…" : "🔍 Auto-Detect"}
          </Button>
          {autoDetectError && (
            <div className="text-destructive text-[10px] max-w-36 leading-tight">
              {autoDetectError}
            </div>
          )}
        </div>

        {/* Save */}
        <Button
          onClick={handleSave}
          disabled={saveStatus === "saving"}
          colorScheme={
            saveStatus === "saved" ? "success" :
            saveStatus === "error" ? "danger" :
            "primary"
          }
          size="sm"
          title="Save hotspot data to Sitecore field"
        >
          {saveStatus === "saving" ? "Saving…" :
           saveStatus === "saved" ? "✓ Saved" :
           saveStatus === "error" ? "✕ Error" :
           "💾 Save"}
        </Button>
      </div>

      {/* ── Main canvas + panel ──────────────────────────────────────── */}
      <div className="flex gap-2.5 flex-1 min-h-0 items-start">
        <HotspotCanvas
          imageUrl={imageUrl}
          hotspots={hotspots}
          selectedId={selectedId}
          onAdd={handleAdd}
          onMove={handleMove}
          onSelect={setSelectedId}
        />
        <HotspotPanel
          hotspots={hotspots}
          selectedId={selectedId}
          brandCheckResults={brandCheckResults}
          isGenerating={isGenerating}
          isBrandChecking={isBrandChecking}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onSelect={setSelectedId}
          onGenerateDescription={handleGenerateDescription}
          onBrandCheckAll={handleBrandCheckAll}
        />
      </div>

      {/* ── Status bar ──────────────────────────────────────────────── */}
      <div className="flex gap-3.5 px-3 py-2 bg-card rounded-md border border-border text-xs text-muted-foreground flex-wrap items-center">
        <StatPill value={hotspots.length} label="hotspot" plural="hotspots" />
        <Divider />
        <StatPill value={withAriaLabel} label="with aria-label" />
        <Divider />
        <StatPill value={withDescription} label="with description" />
        {avgScore !== null && (
          <>
            <Divider />
            <span>
              Avg brand score:{" "}
              <strong className={avgScore >= 80 ? "text-green-600" : avgScore >= 60 ? "text-yellow-600" : "text-red-600"}>
                {avgScore}/100
              </strong>
            </span>
          </>
        )}
        {brandKit && (
          <>
            <Divider />
            <span className="text-green-600">
              Brand kit: <strong>{brandKit.name}</strong>
            </span>
          </>
        )}
        {error && (
          <>
            <Divider />
            <span className="text-yellow-600">⚠ Dev mode (SDK not connected)</span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────

function StatPill({ value, label, plural }: { value: number; label: string; plural?: string }) {
  return (
    <span>
      <strong className="text-foreground">{value}</strong>{" "}
      {plural ? (value === 1 ? label : plural) : label}
    </span>
  );
}

function Divider() {
  return <span className="opacity-30">|</span>;
}
