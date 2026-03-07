"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useMarketplaceClient } from "@/src/utils/hooks/useMarketplaceClient";
import type { ApplicationContext, PagesContext } from "@sitecore-marketplace-sdk/client";
import { Hotspot, SmartSpotData, BrandCheckResult, AIDetectedSpot, Breakpoint, ImageVariant } from "./types";
import { HotspotCanvas } from "./components/HotspotCanvas";
import { HotspotPanel } from "./components/HotspotPanel";
import { fetchBrandKit, BrandKitContext } from "./utils/brandKit";
import { resolveDatasourcesFromPresentationDetails, fetchDatasourceImagesViaAuthoring } from "./utils/fetchPageImages";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";

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
  const [pagesCtx, setPagesCtx] = useState<PagesContext | null>(null);
  const [brandKit, setBrandKit] = useState<BrandKitContext | null>(null);

  const [activeBreakpoint, setActiveBreakpoint] = useState<Breakpoint>("desktop");
  const [variants, setVariants] = useState<Record<Breakpoint, ImageVariant>>(emptyVariants());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [brandCheckResults, setBrandCheckResults] = useState<BrandCheckResult[]>([]);
  // In-memory blob URLs keyed by breakpoint — created from server-proxied image bytes.
  // Not persisted to Sitecore; revoked when replaced or on unmount.
  const [imageBlobUrls, setImageBlobUrls] = useState<Partial<Record<Breakpoint, string>>>({});
  const blobUrlsRef = useRef<Partial<Record<Breakpoint, string>>>({});

  // Derived from active breakpoint
  const imageUrl = variants[activeBreakpoint].imageUrl;
  const hotspots = variants[activeBreakpoint].hotspots;
  // Canvas displays the in-memory blob if available, otherwise falls back to the real URL.
  const canvasImageUrl = imageBlobUrls[activeBreakpoint] || imageUrl;

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

  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [loadImagesError, setLoadImagesError] = useState<string | null>(null);
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
  // Stores appContext.resourceAccess[0].context.preview so that async
  // callbacks (resolvePagesCtx) can read it without stale-closure issues.
  const sitecoreContextIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    return () => {
      isMounted.current = false;
      // Revoke all blob URLs on unmount to free memory
      Object.values(blobUrlsRef.current).forEach((u) => u && URL.revokeObjectURL(u));
    };
  }, []);

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
          setAppContext(ctx);
          // Cache the preview context ID so async callbacks can use it
          sitecoreContextIdRef.current =
            (ctx.resourceAccess as { context?: { preview?: string } }[] | undefined)
              ?.[0]?.context?.preview ?? undefined;
        })
        .catch((err) => console.error("Error retrieving application.context:", err));

      // Subscribe to pages.context so the brand kit refreshes if the author
      // switches page while the extension is open
      const resolvePagesCtx = async (data: unknown) => {
        const ctx = data as PagesContext;
        setPagesCtx(ctx);
        const brandKitId = ctx?.siteInfo?.brandKitId;
        if (brandKitId) {
          const kit = await fetchBrandKit(client, brandKitId, sitecoreContextIdRef.current);
          setBrandKit(kit);
        }
      };

      client
        .query("pages.context", {
          subscribe: true,
          onSuccess: (data) => {
            resolvePagesCtx(data).catch(() => {});
          },
        })
        .then((result) => {
          unsubPagesContext.current = result.unsubscribe;
          resolvePagesCtx(result.data).catch(() => {});
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
          headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, sitecoreContextId: sitecoreContextIdRef.current }),
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

  // ── Load images from page datasource ──────────────────────────────────────
  const handleLoadImages = useCallback(async () => {
    if (!client) return;

    const pageInfo = (pagesCtx as unknown as {
      pageInfo?: { id?: string; path?: string; presentationDetails?: string };
    })?.pageInfo;

    const datasourcePaths = pageInfo?.presentationDetails
      ? resolveDatasourcesFromPresentationDetails(
          pageInfo.presentationDetails,
          pageInfo.path ?? ""
        )
      : [];

    if (!datasourcePaths.length) {
      setLoadImagesError("No datasource found — make sure the Image Hotspots component is on this page");
      return;
    }

    const language = (pagesCtx?.pageInfo as unknown as { language?: string })?.language ?? "en";
    const siteInfo = (pagesCtx as unknown as {
      siteInfo?: { renderingEngineApplicationUrl?: string; hostName?: string };
    })?.siteInfo;
    const instanceUrl = siteInfo?.renderingEngineApplicationUrl ?? appContext?.url ?? "";
    // Resolve the best media base URL (used to build /-/media/{guid}.ashx paths).
    // Priority:
    //   1. NEXT_PUBLIC_MEDIA_BASE env var  — explicit override for local dev
    //   2. siteInfo.hostName              — set by Pages SDK in some versions
    //   3. appContext.url origin           — correct in deployed XM Cloud (not localhost)
    //   4. instanceUrl (EH host)           — last resort; requires SITECORE_API_KEY
    const appOrigin = (() => { try { return new URL(appContext?.url ?? "").origin; } catch { return ""; } })();
    const mediaBase: string =
      (process.env.NEXT_PUBLIC_MEDIA_BASE as string | undefined) ||
      (siteInfo?.hostName ? `https://${siteInfo.hostName}` : "") ||
      (!appOrigin.includes("localhost") && !appOrigin.includes("127.0.0.1") ? appOrigin : "") ||
      instanceUrl;
    const sitecoreContextId =
      (appContext?.resourceAccess as { context?: { preview?: string } }[] | undefined)
        ?.[0]?.context?.preview ?? undefined;

    setIsLoadingImages(true);
    setLoadImagesError(null);
    try {
      // ── Step 1: Try Experience Edge (returns public CDN src URLs, no auth needed) ──
      let data: { desktop?: string; tablet?: string; mobile?: string } | null = null;
      try {
        const edgeRes = await fetch("/api/smartspot/loadimages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            datasourcePath: datasourcePaths[0],
            language,
            previewContextId: sitecoreContextId,
            instanceUrl,
            mediaBaseUrl: mediaBase,
          }),
        });
        if (edgeRes.ok) {
          const edgeData = await edgeRes.json() as { desktop?: string; tablet?: string; mobile?: string };
          if (edgeData.desktop || edgeData.tablet || edgeData.mobile) {
            data = edgeData;
          }
        }
      } catch { /* fall through to authoring API */ }

      // ── Step 2: Fall back to Authoring GQL (works on unpublished content) ──
      if (!data) {
        data = await fetchDatasourceImagesViaAuthoring(
          client, datasourcePaths[0], language, mediaBase, sitecoreContextId
        );
      }

      if (!data) {
        setLoadImagesError("Item not found — publish the datasource or check the component is on this page");
        return;
      }
      setVariants((prev) => ({
        desktop: data!.desktop ? { ...prev.desktop, imageUrl: data!.desktop! } : prev.desktop,
        tablet:  data!.tablet  ? { ...prev.tablet,  imageUrl: data!.tablet!  } : prev.tablet,
        mobile:  data!.mobile  ? { ...prev.mobile,  imageUrl: data!.mobile!  } : prev.mobile,
      }));

      // ── Step 3: Fetch each image server-side and store as in-memory blob URL ──
      // This avoids mixed-content and auth issues in the canvas <img> tag.
      const bpEntries = (
        [["desktop", data!.desktop], ["tablet", data!.tablet], ["mobile", data!.mobile]] as
        [Breakpoint, string | undefined][]
      ).filter(([, url]) => !!url);

      const newBlobs: Partial<Record<Breakpoint, string>> = {};
      await Promise.all(
        bpEntries.map(async ([bp, url]) => {
          try {
            const res = await fetch(`/api/smartspot/proxy-image?url=${encodeURIComponent(url!)}`);
            if (!res.ok) return;
            const blob = await res.blob();
            if (!blob.type.startsWith("image/")) return;
            // Revoke old blob URL for this breakpoint
            const old = blobUrlsRef.current[bp];
            if (old) URL.revokeObjectURL(old);
            const blobUrl = URL.createObjectURL(blob);
            blobUrlsRef.current[bp] = blobUrl;
            newBlobs[bp] = blobUrl;
          } catch { /* proxy failed — canvas will fall back to direct URL */ }
        })
      );
      if (Object.keys(newBlobs).length > 0) {
        setImageBlobUrls((prev) => ({ ...prev, ...newBlobs }));
      }
    } catch (err) {
      setLoadImagesError(err instanceof Error ? err.message : "Failed to load images");
    } finally {
      setIsLoadingImages(false);
    }
  }, [client, pagesCtx, appContext, setVariants]);

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

  if (sdkLoading) {
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
            <div className="text-muted-foreground text-3xs tracking-wide">AI Hotspot Editor</div>
          </div>
        </div>

        {/* Breakpoint switcher */}
        <select
          value={activeBreakpoint}
          onChange={(e) => {
            setActiveBreakpoint(e.target.value as Breakpoint);
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

        {/* Load images from Sitecore datasource */}
        {isInitialized && (
          <div className="flex flex-col gap-1 shrink-0">
            <Button
              onClick={handleLoadImages}
              disabled={isLoadingImages || !pagesCtx}
              colorScheme="neutral"
              size="sm"
              title="Load DesktopImage / TabletImage / MobileImage from the page's ImageHotspots datasource"
              className="whitespace-nowrap"
            >
              {isLoadingImages ? "Loading…" : "📂 Load from page"}
            </Button>
            {loadImagesError && (
              <div className="text-destructive text-3xs max-w-44 leading-tight">
                {loadImagesError}
              </div>
            )}
          </div>
        )}

        {/* Image URL for active breakpoint */}
        <Input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder={`${activeBreakpoint.charAt(0).toUpperCase() + activeBreakpoint.slice(1)} image URL…`}
          className="flex-1 min-w-44 h-9 text-sm"
        />

        {/* Auto-detect */}
        <div className="flex flex-col gap-1 shrink-0">
          <Button
            onClick={handleAutoDetect}
            disabled={isAutoDetecting || !imageUrl}
            colorScheme="ai"
            size="sm"
            title="Use Claude Vision to auto-place hotspots"
            className="whitespace-nowrap"
          >
            {isAutoDetecting ? "Detecting…" : "🔍 Auto-Detect"}
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
          imageUrl={canvasImageUrl}
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
