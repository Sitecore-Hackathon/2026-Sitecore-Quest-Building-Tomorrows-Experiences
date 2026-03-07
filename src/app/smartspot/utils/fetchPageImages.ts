/**
 * Utility for resolving Image Hotspots datasource paths and fetching image
 * field values from XM Cloud via the Authoring GraphQL API (SDK-native, no
 * publishing required).
 */

import type { ClientSDK } from "@sitecore-marketplace-sdk/client";

/** Resolve a relative /-/media/... src to an absolute URL. */
function parseSrc(fieldValue: string | undefined, mediaBase: string, contextId?: string): string | undefined {
  if (!fieldValue) return undefined;

  const withCtx = (url: string) =>
    contextId ? `${url}${url.includes("?") ? "&" : "?"}sitecoreContextId=${contextId}` : url;

  // XML with src attr: <image mediaid="{...}" src="/-/media/..." />
  const xmlSrc = fieldValue.match(/\bsrc="([^"]+)"/)?.[1];
  if (xmlSrc) {
    const abs = xmlSrc.startsWith("http") ? xmlSrc : `${mediaBase}${xmlSrc}`;
    return withCtx(abs);
  }
  // Authoring API returns mediaid-only XML: <image mediaid="{GUID}" />
  const mediaId = fieldValue.match(/\bmediaid="([^"]+)"/)?.[1];
  if (mediaId) {
    const bare = mediaId.replace(/[{}\-]/g, "").toLowerCase();
    return withCtx(`${mediaBase}/-/media/${bare}.ashx`);
  }
  // JSON: { "src": "/-/media/..." }
  try {
    const parsed = JSON.parse(fieldValue) as { src?: string };
    if (parsed?.src) {
      const abs = parsed.src.startsWith("http") ? parsed.src : `${mediaBase}${parsed.src}`;
      return withCtx(abs);
    }
  } catch { /* not JSON */ }
  return undefined;
}

/** Return true if the string looks like a bare or braced GUID. */
function isGuid(s: string): boolean {
  return /^[{(]?[0-9a-f]{8}[-]?(?:[0-9a-f]{4}[-]?){3}[0-9a-f]{12}[})]?$/i.test(s.trim());
}

/**
 * Fetch DesktopImage / TabletImage / MobileImage fields from a datasource item
 * using the Sitecore Authoring GraphQL API via the Marketplace SDK.
 *
 * Uses the same `fields { name value }` shape as fetchBrandKit (SMS API schema).
 * Works on unpublished content; no SITECORE_API_KEY required.
 *
 * @param sitecoreContextId  appContext.resourceAccess[0].context.preview
 */
export async function fetchDatasourceImagesViaAuthoring(
  client: ClientSDK,
  datasourcePath: string,
  language: string,
  mediaBase: string,
  sitecoreContextId?: string
): Promise<{ desktop?: string; tablet?: string; mobile?: string } | null> {
  // ── Step 1: Try xmc.preview.graphql (Experience Edge via SDK) ─────────────
  // This uses the SDK's managed auth and returns jsonValue with absolute CDN URLs.
  const previewQuery = `
    query GetDatasourceImagesCDN {
      item(path: "${datasourcePath}", language: "${language}") {
        di: field(name: "DesktopImage") { value jsonValue }
        ti: field(name: "TabletImage")  { value jsonValue }
        mi: field(name: "MobileImage")  { value jsonValue }
      }
    }
  `;

  type FieldVal = { value?: string; jsonValue?: string };
  type PreviewItem = { di?: FieldVal; ti?: FieldVal; mi?: FieldVal };

  const extractCdnSrc = (f: FieldVal | undefined): string | undefined => {
    if (!f) return undefined;
    if (f.jsonValue) {
      try {
        const jv = JSON.parse(f.jsonValue) as { src?: string } | { value?: { src?: string } };
        const src = ("src" in jv ? jv.src : undefined) ?? ("value" in jv ? jv.value?.src : undefined);
        if (src) return src.startsWith("http") ? src : `${mediaBase}${src}`;
      } catch { /* not JSON */ }
    }
    if (f.value) {
      const xmlSrc = f.value.match(/\bsrc="([^"]+)"/)?.[1];
      if (xmlSrc) {
        if (xmlSrc.startsWith("http")) return xmlSrc;
        const edgeBase = process.env.NEXT_PUBLIC_EDGE_MEDIA_BASE as string | undefined;
        // /-/media/path/to/image.png → {edgeBase}/media/path/to/image.png
        if (edgeBase && xmlSrc.startsWith("/-/media/")) {
          return `${edgeBase}/media/${xmlSrc.slice("/-/media/".length)}`;
        }
        return `${mediaBase}${xmlSrc}`;
      }
    }
    return undefined;
  };

  try {
    const previewResult = await client.mutate("xmc.preview.graphql", {
      params: {
        body: { query: previewQuery },
        ...(sitecoreContextId ? { query: { sitecoreContextId } } : {}),
      },
    });
    const pRaw = previewResult?.data as { data?: { item?: PreviewItem } } | undefined;
    const pItem = pRaw?.data?.item;
    if (pItem) {
      const desktop = extractCdnSrc(pItem.di);
      const tablet  = extractCdnSrc(pItem.ti);
      const mobile  = extractCdnSrc(pItem.mi);
      if (desktop || tablet || mobile) {
        console.log("[SmartSpot/images] preview GQL returned CDN URLs:", { desktop, tablet, mobile });
        return { desktop, tablet, mobile };
      }
    }
  } catch (err) {
    console.warn("[SmartSpot/images] preview GQL failed, falling back to authoring:", err);
  }

  // ── Step 2: Fall back to xmc.authoring.graphql ────────────────────────────
  // SMS authoring API only supports `where: { ... }` — direct `path`/`language`
  // args do not exist in this schema (unlike Experience Edge).
  const itemArgs = isGuid(datasourcePath)
    ? `where: { id: "${datasourcePath.replace(/[{}\-]/g, "").toLowerCase()}", language: "${language}" }`
    : `where: { path: "${datasourcePath}", language: "${language}" }`;

  // `fields` returns ItemFieldConnection — use `nodes { name value }` (Relay connection pattern).
  const query = `
    query GetDatasourceImages {
      item(${itemArgs}) {
        fields { nodes { name value } }
      }
    }
  `;

  console.log("[SmartSpot/images] GQL args:", itemArgs);

  let result: Awaited<ReturnType<typeof client.mutate>>;
  try {
    result = await client.mutate("xmc.authoring.graphql", {
      params: {
        body: { query },
        ...(sitecoreContextId ? { query: { sitecoreContextId } } : {}),
      },
    });
  } catch (err) {
    console.error("[SmartSpot/images] mutate threw:", err);
    return null;
  }

  const raw = result?.data as { data?: { item?: unknown }; errors?: unknown } | undefined;
  console.log("[SmartSpot/images] GQL response:", JSON.stringify(raw));

  type RawField = { name: string; value: string };
  const item = (raw?.data as { item?: { fields?: { nodes?: RawField[] } } } | undefined)?.item;
  if (!item) return null;

  const fieldMap: Record<string, string> = {};
  for (const f of item.fields?.nodes ?? []) {
    fieldMap[f.name.toLowerCase()] = f.value;
  }

  // ── Step 3: Resolve mediaid GUIDs → Edge CDN path-based URLs ──────────────
  // Authoring GQL returns <image mediaid="{GUID}" /> with no src.
  // Query each media item by ID to get its Sitecore path + file extension,
  // then build a publicly accessible Edge CDN URL that works server-side.
  const edgeBase = process.env.NEXT_PUBLIC_EDGE_MEDIA_BASE as string | undefined;
  if (edgeBase) {
    const extractGuid = (val: string | undefined) =>
      val?.match(/\bmediaid="([^"]+)"/)?.[1]?.replace(/[{}\-]/g, "").toLowerCase() ?? null;

    const guids = {
      di: extractGuid(fieldMap["desktopimage"]),
      ti: extractGuid(fieldMap["tabletimage"]),
      mi: extractGuid(fieldMap["mobileimage"]),
    };

    const uniqueGuids = [...new Set(Object.values(guids).filter(Boolean) as string[])];
    if (uniqueGuids.length > 0) {
      // Batch query: alias each media item lookup
      const aliases = uniqueGuids
        .map((id) => `g${id}: item(where: { id: "${id}" }) { path fields { nodes { name value } } }`)
        .join("\n");
      const mediaPathQuery = `query GetMediaItemPaths { ${aliases} }`;
      try {
        const mpResult = await client.mutate("xmc.authoring.graphql", {
          params: {
            body: { query: mediaPathQuery },
            ...(sitecoreContextId ? { query: { sitecoreContextId } } : {}),
          },
        });
        type MediaItem = { path?: string; fields?: { nodes?: { name: string; value: string }[] } };
        const mpData = (mpResult?.data as { data?: Record<string, MediaItem> } | undefined)?.data ?? {};

        const buildEdgeUrl = (guid: string | null): string | undefined => {
          if (!guid) return undefined;
          const mi = mpData[`g${guid}`];
          if (!mi?.path) return undefined;
          // Strip Sitecore media library root: /sitecore/media library/Foo/Bar → Foo/Bar
          const libPrefix = "/sitecore/media library/";
          if (!mi.path.toLowerCase().startsWith(libPrefix.toLowerCase())) return undefined;
          const relPath = mi.path.slice(libPrefix.length);
          const ext = mi.fields?.nodes?.find(
            (f) => f.name.toLowerCase() === "extension"
          )?.value ?? "png";
          return `${edgeBase}/media/${relPath}.${ext}`;
        };

        return {
          desktop: buildEdgeUrl(guids.di) ?? parseSrc(fieldMap["desktopimage"], mediaBase, sitecoreContextId),
          tablet:  buildEdgeUrl(guids.ti) ?? parseSrc(fieldMap["tabletimage"],  mediaBase, sitecoreContextId),
          mobile:  buildEdgeUrl(guids.mi) ?? parseSrc(fieldMap["mobileimage"],  mediaBase, sitecoreContextId),
        };
      } catch (err) {
        console.warn("[SmartSpot/images] media path resolution failed, using ASHX fallback:", err);
      }
    }
  }

  return {
    desktop: parseSrc(fieldMap["desktopimage"], mediaBase, sitecoreContextId),
    tablet:  parseSrc(fieldMap["tabletimage"],  mediaBase, sitecoreContextId),
    mobile:  parseSrc(fieldMap["mobileimage"],  mediaBase, sitecoreContextId),
  };
}

/**
 * Parse pagesCtx.pageInfo.presentationDetails and resolve any local: datasource
 * references into full Sitecore content paths.
 *
 * XM Cloud stores local datasources as "local:/Data/ItemName" which resolves
 * relative to the page's Sitecore path.
 */
export function resolveDatasourcesFromPresentationDetails(
  presentationDetails: string,
  pageSitecorePath: string
): string[] {
  try {
    const pd = JSON.parse(presentationDetails) as {
      devices?: { renderings?: { dataSource?: string }[] }[];
    };
    const results: string[] = [];
    for (const device of pd.devices ?? []) {
      for (const r of device.renderings ?? []) {
        if (!r.dataSource) continue;
        let ds = r.dataSource;
        if (ds.startsWith("local:")) {
          ds = pageSitecorePath + ds.slice("local:".length);
        }
        if (ds) results.push(ds);
      }
    }
    return [...new Set(results)];
  } catch {
    return [];
  }
}
