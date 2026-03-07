import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side image proxy.
 *
 * Fetches a Sitecore media URL (which may require auth) from the server and
 * streams the bytes back to the browser. This allows the canvas <img> tag to
 * load auth-protected media without needing Sitecore cookies in the browser.
 *
 * Usage: /api/smartspot/proxy-image?url=<encoded-media-url>
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (!url) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return new NextResponse("Invalid URL protocol", { status: 400 });
    }
  } catch {
    return new NextResponse("Invalid URL", { status: 400 });
  }

  const urlStr = parsed.toString();
  const ctxId = parsed.searchParams.get("sitecoreContextId");
  // Prefer the delivery API key (set in .env.local) over the preview context token.
  // The preview JWT works for GQL queries but NOT for media binary downloads on Experience Edge.
  const apiKey =
    process.env.SITECORE_API_KEY ??
    process.env.SITECORE_JSS_API_KEY ??
    ctxId ??
    "";
  // Experience Edge accepts the key via multiple headers; include all variants.
  const headers: Record<string, string> = { Accept: "image/*,*/*" };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["X-GQL-Token"] = apiKey;
    headers["sc_apikey"] = apiKey;
  }

  // Detect whether the URL already carries a Sitecore media hash token (tt + hash params).
  // When present, the hash IS the auth — try the URL without extra auth headers first.
  const hasHashToken = parsed.searchParams.has("tt") && parsed.searchParams.has("hash");

  // Build a prioritised list of candidates to try:
  // Each entry: [url, useAuthHeaders]
  const candidates: Array<[string, boolean]> = [];

  if (hasHashToken) {
    // Hash-signed URL: also try the base URL without security/resize params —
    // xmc-*.sitecorecloud.io/-/media/ paths are publicly accessible without hash tokens.
    const bare = new URL(parsed.origin + parsed.pathname);
    // Preserve only sitecoreContextId if present
    if (ctxId) bare.searchParams.set("sitecoreContextId", ctxId);
    candidates.push([bare.toString(), false]);
    // Also try as-is in case hash is still valid
    candidates.push([urlStr, false]);
  } else {
    candidates.push([urlStr, true]);
    // For xmc-*.sitecorecloud.io/-/media/ path-based URLs (preview rendering host),
    // also try without auth (media may be publicly accessible) and with sc_apikey as query param.
    if (parsed.hostname.match(/^xmc-.*\.sitecorecloud\.io$/) && parsed.pathname.includes("/-/media/")) {
      candidates.push([urlStr, false]);
      if (apiKey) {
        const withKey = new URL(urlStr);
        withKey.searchParams.set("sc_apikey", apiKey);
        candidates.push([withKey.toString(), false]);
      }
    }
  }

  // 1. EH↔CM / xmc alternate
  const altUrl = urlStr.includes("-cm.sitecorecloud.io")
    ? urlStr.replace(/-cm\.sitecorecloud\.io/, "-eh.sitecorecloud.io")
    : urlStr.includes("-eh.sitecorecloud.io")
    ? urlStr.replace(/-eh\.sitecorecloud\.io/, "-cm.sitecorecloud.io")
    : null;
  if (altUrl) candidates.push([altUrl, true]);

  // 2. Experience Edge CDN — for bare-GUID .ashx URLs try tenant-specific CDN first, then global.
  const mediaIdMatch = urlStr.match(/\/-\/media\/([0-9a-f]+)\.ashx/i);
  if (mediaIdMatch) {
    const mediaId = mediaIdMatch[1];
    // Tenant-specific Edge CDN (e.g. https://edge.sitecorecloud.io/{tenant}/-/media/{guid}.ashx)
    const tenantEdgeBase = process.env.NEXT_PUBLIC_EDGE_MEDIA_BASE;
    if (tenantEdgeBase) {
      candidates.push([`${tenantEdgeBase}/-/media/${mediaId}.ashx`, false]);
      if (apiKey) candidates.push([`${tenantEdgeBase}/-/media/${mediaId}.ashx?sc_apikey=${apiKey}`, false]);
    }
    // Global Edge CDN fallback
    const edgeBase = "https://edge.sitecorecloud.io/-/media";
    if (apiKey) candidates.push([`${edgeBase}/${mediaId}.ashx?sc_apikey=${apiKey}`, false]);
    candidates.push([`${edgeBase}/${mediaId}.ashx`, false]);
    if (ctxId && ctxId !== apiKey) {
      candidates.push([`${edgeBase}/${mediaId}.ashx?sitecoreContextId=${ctxId}`, false]);
      candidates.push([`${edgeBase}/${mediaId}.ashx?sc_apikey=${ctxId}`, false]);
    }
  }

  for (const [candidateUrl, useAuth] of candidates) {
    try {
      const imgRes = await fetch(candidateUrl, { headers: useAuth ? headers : { Accept: "image/*,*/*" } });
      const ct = imgRes.headers.get("content-type") ?? "(none)";
      console.log(`[proxy-image] ${candidateUrl} → ${imgRes.status} ${ct}`);
      if (!imgRes.ok) continue;
      // Reject HTML redirect/login pages masquerading as 200
      if (ct.startsWith("text/")) continue;
      const buffer = await imgRes.arrayBuffer();
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": ct,
          "Cache-Control": "public, max-age=300",
        },
      });
    } catch (err) {
      console.log(`[proxy-image] ${candidateUrl} → THREW: ${err instanceof Error ? err.message : err}`);
    }
  }

  return new NextResponse(
    `Could not fetch image from ${urlStr} (tried ${candidates.length} URL(s))`,
    { status: 502 }
  );
}
