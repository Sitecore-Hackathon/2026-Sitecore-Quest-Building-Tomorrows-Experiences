/**
 * Server-side proxy for fetching image field values from XM Cloud Experience Edge.
 *
 * Uses SITECORE_API_KEY env var (the JSS sc_apikey) to authenticate against
 * the rendering host's /api/graph/edge endpoint.
 *
 * In XM Cloud deployed environments this key is injected automatically.
 * For local dev: add SITECORE_API_KEY={guid} to .env.local
 *   (find it in Sitecore: /sitecore/system/Settings/Services/API Keys)
 *
 * Requires the datasource item to be published to Experience Edge.
 */

import { NextRequest, NextResponse } from "next/server";

type FieldShape = { value?: string; jsonValue?: string };

/**
 * Extract an image src from a field returned by Experience Edge.
 * Prefers `jsonValue` (absolute CDN URL) over `value` (relative XML src).
 */
function extractSrc(field: FieldShape | undefined, mediaBase: string): string | undefined {
  if (!field) return undefined;

  // jsonValue: Experience Edge returns { src: "https://..." } — publicly accessible CDN URL
  if (field.jsonValue) {
    try {
      const jv = JSON.parse(field.jsonValue) as { src?: string } | { value?: { src?: string } };
      const src = ("src" in jv ? jv.src : undefined) ?? (("value" in jv && jv.value?.src) ? jv.value.src : undefined);
      if (src) return src.startsWith("http") ? src : `${mediaBase}${src}`;
    } catch { /* not JSON */ }
  }

  // value: raw Sitecore XML — src may be relative
  if (field.value) {
    const xmlSrc = field.value.match(/\bsrc="([^"]+)"/)?.[1];
    if (xmlSrc) return xmlSrc.startsWith("http") ? xmlSrc : `${mediaBase}${xmlSrc}`;
    try {
      const parsed = JSON.parse(field.value) as { src?: string };
      if (parsed?.src) return parsed.src.startsWith("http") ? parsed.src : `${mediaBase}${parsed.src}`;
    } catch { /* not JSON */ }
  }

  return undefined;
}

type ItemShape = { di?: FieldShape; ti?: FieldShape; mi?: FieldShape };

async function tryEdge(
  url: string,
  query: string,
  contextId: string,
  extraHeaders: Record<string, string> = {}
): Promise<ItemShape | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // XM Cloud Experience Edge accepts the context/API key via multiple headers
        "sc_apikey": contextId,
        "X-GQL-Token": contextId,
        "Authorization": `Bearer ${contextId}`,
        ...extraHeaders,
      },
      body: JSON.stringify({ query }),
    });
    console.log(`[SmartSpot/loadimages] ${url} → ${res.status}`);
    if (!res.ok) return null;
    const json = await res.json() as { data?: { item?: unknown } };
    return (json.data?.item as ItemShape) ?? null;
  } catch (err) {
    console.error(`[SmartSpot/loadimages] fetch error for ${url}:`, err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  let body: {
    datasourcePath?: string;
    language?: string;
    previewContextId?: string;
    instanceUrl?: string;
    mediaBaseUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const {
    datasourcePath,
    language = "en",
    previewContextId,
    instanceUrl,
    mediaBaseUrl = "",
  } = body;

  if (!datasourcePath || !instanceUrl) {
    return NextResponse.json({ error: "Missing datasourcePath or instanceUrl" }, { status: 400 });
  }

  // Prefer env var (XM Cloud injects SITECORE_API_KEY automatically in deployed envs).
  // Fall back to the preview context ID that the SDK gives us via resourceAccess.
  const contextId =
    process.env.SITECORE_API_KEY ??
    process.env.SITECORE_JSS_API_KEY ??
    previewContextId ??
    "";

  if (!contextId) {
    return NextResponse.json({ error: "No API context available" }, { status: 503 });
  }

  // jsonValue returns an absolute CDN URL for image fields on Experience Edge.
  // value is kept as a fallback for older Edge schemas that don't have jsonValue.
  const query = `{
    item(path: "${datasourcePath}", language: "${language}") {
      di: field(name: "DesktopImage") { value jsonValue }
      ti: field(name: "TabletImage")  { value jsonValue }
      mi: field(name: "MobileImage")  { value jsonValue }
    }
  }`;

  const base = instanceUrl.replace(/\/$/, "");

  // Try the rendering host Edge proxy, then the centralized Edge platform
  const candidates = [
    `${base}/api/graph/edge`,
    `https://edge.sitecorecloud.io/api/graphql/v1`,
  ];

  let item: ItemShape | null = null;
  for (const url of candidates) {
    item = await tryEdge(url, query, contextId);
    if (item) break;
  }

  if (!item) {
    return NextResponse.json(
      { error: "Item not found — publish the datasource item to Experience Edge first" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    desktop: extractSrc(item.di, mediaBaseUrl),
    tablet:  extractSrc(item.ti, mediaBaseUrl),
    mobile:  extractSrc(item.mi, mediaBaseUrl),
  });
}
