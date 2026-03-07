"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useMarketplaceClient } from "@/src/utils/hooks/useMarketplaceClient";
import type { ApplicationContext, PagesContext } from "@sitecore-marketplace-sdk/client";
import { Hotspot, SmartSpotData, BrandCheckResult, AIDetectedSpot, Breakpoint, ImageVariant } from "./types";
import { HotspotCanvas } from "./components/HotspotCanvas";
import { HotspotPanel } from "./components/HotspotPanel";
import { fetchBrandKit, BrandKitContext } from "./utils/brandKit";
import { fetchClaudeApiKey } from "./utils/claudeApiKey";
import { fetchImages, HotspotImageData } from "./utils/imageUtil";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { get } from "http";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return `hs_${crypto.randomUUID()}`;
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

// ─── Constants ───────────────────────────────────────────────────────────────

const MARKETPLACE_OPTIONS = { retryAttempts: 1 };

const BREAKPOINTS: { key: Breakpoint; label: string; icon: string }[] = [
  { key: "desktop", label: "Desktop", icon: "🖥" },
  { key: "tablet", label: "Tablet", icon: "⬜" },
  { key: "mobile", label: "Mobile", icon: "📱" },
];

const emptyVariant = (): ImageVariant => ({ imageUrl: "", hotspots: [] });
const emptyVariants = (): Record<Breakpoint, ImageVariant> => ({
  desktop: emptyVariant(),
  tablet: emptyVariant(),
  mobile: emptyVariant(),
});

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SmartSpotPage() {
  const { client, isInitialized, isLoading: sdkLoading, error } = useMarketplaceClient(MARKETPLACE_OPTIONS);
  const [appContext, setAppContext] = useState<ApplicationContext>();
  const [pagesContext, setPagesContext] = useState<PagesContext>();
  const [brandKit, setBrandKit] = useState<BrandKitContext | null>(null);
  const [claudeApiKey, setClaudeApiKey] = useState<string>("");
  const [isApiKeyLoading, setIsApiKeyLoading] = useState<boolean>(true);
  const [imageData, setImageData] = useState<HotspotImageData | null>(null);
  const [isImageDataLoading, setIsImageDataLoading] = useState<boolean>(true);

  const [activeBreakpoint, setActiveBreakpoint] = useState<Breakpoint>("desktop");
  const [variants, setVariants] = useState<Record<Breakpoint, ImageVariant>>(emptyVariants());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [brandCheckResults, setBrandCheckResults] = useState<BrandCheckResult[]>([]);

  // Derived from active breakpoint
  const imageUrl = variants[activeBreakpoint].imageUrl;
  const hotspots = variants[activeBreakpoint].hotspots;

  const setImageUrl = useCallback((url: string) =>
    setVariants((prev) => ({
      ...prev,
      [activeBreakpoint]: { ...prev[activeBreakpoint], imageUrl: url },
    })), [activeBreakpoint]);

  const setHotspots = useCallback(
    (updater: Hotspot[] | ((prev: Hotspot[]) => Hotspot[])) =>
      setVariants((prev) => {
        const current = prev[activeBreakpoint].hotspots;
        const next = typeof updater === "function" ? updater(current) : updater;
        return { ...prev, [activeBreakpoint]: { ...prev[activeBreakpoint], hotspots: next } };
      }),
    [activeBreakpoint]
  );

  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [isBrandChecking, setIsBrandChecking] = useState(false);
  const [brandCheckError, setBrandCheckError] = useState<string | null>(null);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [autoDetectError, setAutoDetectError] = useState<string | null>(null);
  const [autoDetectCount, setAutoDetectCount] = useState<number | null>(null);
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
            // version 1: multi-breakpoint variants shape
            if (data.variants) {
              setVariants({
                desktop: data.variants.desktop ?? emptyVariant(),
                tablet: data.variants.tablet ?? emptyVariant(),
                mobile: data.variants.mobile ?? emptyVariant(),
              });
            }
          } catch {
            // Field value is not SmartSpot JSON — start fresh
          }
        })
        .catch((err) => console.error("Error retrieving field value:", err));

      // App context — name is forwarded to AI prompts as page context
      client
        .query("application.context")
        .then((res) => {
          const ctx = res.data as ApplicationContext;
          if (ctx.type && ctx.type !== "custom-field-extension") {
            console.warn(`SmartSpot: unexpected extension type "${ctx.type}" — expected "custom-field-extension"`);
          }
          setAppContext(ctx);
        })
        .catch((err) => console.error("Error retrieving application.context:", err));

      const resolveBrandKit = async (data: unknown) => {
        const brandKitId = (data as { siteInfo?: { brandKitId?: string } })
          ?.siteInfo?.brandKitId;
        if (brandKitId) {
          const kit = await fetchBrandKit(client, brandKitId);
          setBrandKit(kit);
        }
      };

      // Subscribe to pages.context so the brand kit refreshes if the author
      // switches page while the extension is open
      client
        .query("pages.context", {
          subscribe: true,
          onSuccess: (data) => {
            resolveBrandKit(data).catch(() => {});
          },
        })
        .then((result) => {
          const ctx = result.data as PagesContext;
          setPagesContext(ctx);

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

  // Claude API key and image effect
  useEffect(() => {
    if (appContext && pagesContext && client) {
      const site = pagesContext.siteInfo?.name;
      const sitecoreContextId = appContext.resourceAccess?.[0]?.context.preview;

      if (site && sitecoreContextId) {
        // Get Claude API key from site properties
        fetchClaudeApiKey(client, sitecoreContextId, site)
          .then((key) => {
            setClaudeApiKey(key ?? ""); 
            setIsApiKeyLoading(false);
          })
          .catch(() => {
            setClaudeApiKey("");
            setIsApiKeyLoading(false);
          });
        
        // Fetch image data from the page context
        fetchImages(client, sitecoreContextId, pagesContext)
          .then((images) => { 
            console.log("Fetched image data for hotspots", images);
            setImageData(images);
            setIsImageDataLoading(false);
            if (images) {
              setVariants(prev => ({
                desktop: { ...prev.desktop, imageUrl: images.desktop.url },
                tablet: { ...prev.tablet, imageUrl: images.tablet.url },
                mobile: { ...prev.mobile, imageUrl: images.mobile.url },
              }));
            }
          })
          .catch(() => {
            setImageData(null);
            setIsImageDataLoading(false);
          });
      } else {
        setIsApiKeyLoading(false);
        setIsImageDataLoading(false);
      }
    }
  }, [appContext, pagesContext, client]);

  // ── Hotspot mutations ──────────────────────────────────────────────────────
  const handleAdd = useCallback((x: number, y: number) => {
    const spot = makeHotspot(x, y);
    setHotspots((prev) => [...prev, spot]);
    setSelectedId(spot.id);
  }, [setHotspots]);

  const handleMove = useCallback((id: string, x: number, y: number) => {
    setHotspots((prev) =>
      prev.map((h) => (h.id === id ? { ...h, x, y } : h))
    );
  }, [setHotspots]);

  const handleUpdate = useCallback((id: string, updates: Partial<Hotspot>) => {
    setHotspots((prev) =>
      prev.map((h) => (h.id === id ? { ...h, ...updates } : h))
    );
  }, [setHotspots]);

  const handleDelete = useCallback((id: string) => {
    setHotspots((prev) => prev.filter((h) => h.id !== id));
    setBrandCheckResults((prev) => prev.filter((r) => r.hotspotId !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  }, [setHotspots]);

  // ── AI: generate description ───────────────────────────────────────────────
  const handleGenerateDescription = useCallback(
    async (id: string) => {
      const spot = hotspots.find((h) => h.id === id);
      if (!spot?.label) return;

      setIsGenerating(true);
      setGenerateError(null);
      try {
        const res = await fetch("/api/smartspot/generate", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json", 
            "X-Claude-Api-Key": claudeApiKey 
          },
          body: JSON.stringify({
            label: spot.label,
            context: appContext?.name ?? "",
            brandContext: brandKit?.summary ?? "",
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          setGenerateError(data.error ?? "Generation failed");
          return;
        }
        handleUpdate(id, { description: data.description ?? "" });
      } catch (err) {
        setGenerateError(err instanceof Error ? err.message : "Generation failed");
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
    setBrandCheckError(null);
    try {
      const res = await fetch("/api/smartspot/brandcheck", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-Claude-Api-Key": claudeApiKey,
        },
        body: JSON.stringify({ hotspots, brandContext: brandKit?.summary ?? "" }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setBrandCheckError(data.error ?? "Brand check failed");
        return;
      }
      setBrandCheckResults(data.results ?? []);
    } catch (err) {
      setBrandCheckError(err instanceof Error ? err.message : "Brand check failed");
    } finally {
      setIsBrandChecking(false);
    }
  }, [hotspots, brandKit]);

  // ── AI: vision auto-detect ─────────────────────────────────────────────────
  const handleAutoDetect = useCallback(async () => {
    if (!imageUrl) return;
    setIsAutoDetecting(true);
    setAutoDetectError(null);
    setAutoDetectCount(null);
    try {
      const res = await fetch("/api/smartspot/vision", {
        method: "POST",
        headers: { 
          "Content-Type": "text/plain", 
          "X-Claude-Api-Key": claudeApiKey 
        },
        body: getActiveImageUrl(true), // base64 version
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
      setAutoDetectCount(newSpots.length);
      if (newSpots.length > 0) setSelectedId(newSpots[0].id);
    } catch (err) {
      setAutoDetectError(err instanceof Error ? err.message : "Auto-detect failed");
    } finally {
      setIsAutoDetecting(false);
    }
  }, [imageUrl, setHotspots]);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!client) return;
    setSaveStatus("saving");
    try {
      const payload: SmartSpotData = { version: 1, variants };
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
  }, [client, variants]);

  const getActiveImageUrl = (isBase64: boolean = false) => {
    switch (activeBreakpoint) {
      case "desktop":
        return isBase64 ? imageData?.desktop.base64 ?? "" : imageData?.desktop.url ?? "";
      case "tablet":
        return isBase64 ? imageData?.tablet.base64 ?? "" : imageData?.tablet.url ?? "";
      case "mobile":
        return isBase64 ? imageData?.mobile.base64 ?? "" : imageData?.mobile.url ?? "";
      default:
        return "";
    }
  };

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

  if (sdkLoading || isApiKeyLoading || isImageDataLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background text-muted-foreground text-sm gap-1">
        <div className="text-4xl">🎯</div>
        <div className="font-semibold text-foreground">SmartSpot</div>
        <div>Initializing…</div>
      </div>
    );
  }

  if (!claudeApiKey) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-3.5 font-sans">
        <div className="bg-card rounded-lg border border-destructive/20 p-6 max-w-md text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <div className="text-lg font-bold text-destructive mb-2">There were some issues...</div>
          <div className="text-sm text-muted-foreground mb-4">
            Your browser session could have been expired, or the Claude API key could not be retrieved from site configuration. Please ensure the SmartSpot configuration includes a valid API key.
          </div>
          <div className="text-xs text-muted-foreground">
            Contact your site administrator if you believe this is an error. If the issue persists, please ask the administrator to validate the API key configuration on the site grouping item. The API key should be set in the "Other properties" field with the <strong>smartspot-claude-apikey</strong> name.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col p-3.5 gap-2.5 font-sans box-border">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-card rounded-lg border border-border flex-wrap">
        {/* Breakpoint switcher */}
        <select
          value={activeBreakpoint}
          onChange={(e) => {
            setActiveBreakpoint(e.target.value as Breakpoint);
            setImageUrl(getActiveImageUrl());
            setSelectedId(null);
            setBrandCheckResults([]);
            setAutoDetectError(null);
            setAutoDetectCount(null);
          }}
          className="h-9 px-2 rounded-md border border-border bg-card text-sm text-foreground cursor-pointer shrink-0"
        >
          {BREAKPOINTS.map(({ key, label, icon }) => (
            <option key={key} value={key}>{icon} {label}</option>
          ))}
        </select>

        {/* Auto-detect */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            onClick={handleAutoDetect}
            disabled={isAutoDetecting || !imageUrl}
            colorScheme="ai"
            size="sm"
            title="Use Claude Vision to auto-place hotspots"
            className="whitespace-nowrap"
          >
            {isAutoDetecting ? "Detecting…" : "✨ Auto-Detect"}
          </Button>
          {autoDetectError && (
            <div className="text-destructive text-3xs max-w-36 leading-tight">
              {autoDetectError}
            </div>
          )}
          {!autoDetectError && autoDetectCount !== null && (
            <div className="text-3xs max-w-36 leading-tight text-green-600 font-medium">
              {autoDetectCount === 0
                ? "No hotspots found"
                : `${autoDetectCount} hotspot${autoDetectCount === 1 ? "" : "s"} detected`}
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
          className="ml-auto"
        >
          {saveStatus === "saving" ? "Saving…" :
           saveStatus === "saved" ? "✓ Saved" :
           saveStatus === "error" ? "✕ Error" :
           "Save"}
        </Button>
      </div>

      {/* ── Main canvas + panel ──────────────────────────────────────── */}
      <div className="flex gap-2.5 flex-1 min-h-0 items-start">
        <HotspotCanvas
          imageUrl={getActiveImageUrl()}
          hotspots={hotspots}
          selectedId={selectedId}
          onAdd={handleAdd}
          onMove={handleMove}
          onSelect={setSelectedId}
        />
        <HotspotPanel
          key={activeBreakpoint}
          hotspots={hotspots}
          selectedId={selectedId}
          brandCheckResults={brandCheckResults}
          isGenerating={isGenerating}
          generateError={generateError}
          isBrandChecking={isBrandChecking}
          brandCheckError={brandCheckError}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onSelect={setSelectedId}
          onGenerateDescription={handleGenerateDescription}
          onBrandCheckAll={handleBrandCheckAll}
        />
      </div>

      {/* ── Status bar ──────────────────────────────────────────────── */}
      <div className="flex gap-3.5 px-3 py-2 bg-card rounded-md border border-border text-xs text-muted-foreground flex-wrap items-center">
        <span className="font-semibold text-foreground capitalize">{activeBreakpoint}</span>
        <Divider />
        <StatPill value={hotspots.length} label="hotspot" plural="hotspots" />
        <Divider />
        <StatPill value={withAriaLabel} label="with aria-label" />
        <Divider />
        <StatPill value={withDescription} label="with description" />
        {avgScore !== null && (
          <>
            <Divider />
            <span>
              Avg quality score:{" "}
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
            <Divider />
            <button
              onClick={async () => {
                const payload = JSON.stringify({ version: 1, variants }, null, 2);
                try {
                  await navigator.clipboard.writeText(payload);
                } catch {
                  // Fallback for non-HTTPS environments
                  const el = document.createElement("textarea");
                  el.value = payload;
                  el.style.position = "fixed";
                  el.style.opacity = "0";
                  document.body.appendChild(el);
                  el.select();
                  document.execCommand("copy");
                  document.body.removeChild(el);
                }
              }}
              className="text-blue-500 underline cursor-pointer text-xs"
              title="Copy the current field JSON to clipboard"
            >
              📋 Copy field JSON
            </button>
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
