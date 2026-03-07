import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { AIDetectedSpot } from "@/src/app/smartspot/types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI not configured" }, { status: 503 });
  }

  let body: { imageUrl?: string; sitecoreContextId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { imageUrl, sitecoreContextId } = body;

  if (!imageUrl) {
    return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });
  }

  // Validate imageUrl is absolute http/https — or allow relative paths by constructing absolute URL.
  let absoluteImageUrl: string;
  if (imageUrl.startsWith("/")) {
    // Relative path (e.g. /api/smartspot/proxy-image?url=...) — make it absolute using the request origin.
    absoluteImageUrl = `${req.nextUrl.origin}${imageUrl}`;
  } else {
    try {
      const parsed = new URL(imageUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return NextResponse.json({ error: "imageUrl must be an http/https URL" }, { status: 400 });
      }
      absoluteImageUrl = imageUrl;
    } catch {
      return NextResponse.json({ error: "imageUrl is not a valid URL" }, { status: 400 });
    }
  }

  // Fetch the image server-side so Claude doesn't need to access auth-protected URLs.
  // Build a prioritised list of (url, headers) candidates to try.
  const apiKey = process.env.SITECORE_API_KEY ?? process.env.SITECORE_JSS_API_KEY ?? "";
  const authHeaders: Record<string, string> = { Accept: "image/*,*/*" };
  if (apiKey) {
    authHeaders["Authorization"] = `Bearer ${apiKey}`;
    authHeaders["sc_apikey"] = apiKey;
    authHeaders["X-GQL-Token"] = apiKey;
  }

  const fetchCandidates: Array<[string, Record<string, string>]> = [];
  // 1. Try the URL as-is with auth headers
  fetchCandidates.push([absoluteImageUrl, authHeaders]);
  // 2. Try without auth (may be publicly accessible)
  fetchCandidates.push([absoluteImageUrl, { Accept: "image/*,*/*" }]);
  // 3. Append sc_apikey + sitecoreContextId as query params
  try {
    const withParams = new URL(absoluteImageUrl);
    if (apiKey) withParams.searchParams.set("sc_apikey", apiKey);
    if (sitecoreContextId) withParams.searchParams.set("sitecoreContextId", sitecoreContextId);
    fetchCandidates.push([withParams.toString(), { Accept: "image/*,*/*" }]);
  } catch { /* invalid URL */ }

  let imageBase64 = "";
  let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" = "image/jpeg";
  let fetchedOk = false;
  for (const [candidateUrl, candidateHeaders] of fetchCandidates) {
    try {
      const imgRes = await fetch(candidateUrl, { headers: candidateHeaders });
      const ct = imgRes.headers.get("content-type") ?? "";
      if (!imgRes.ok || ct.startsWith("text/")) continue;
      const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      const raw = ct.split(";")[0].trim();
      mediaType = (allowed.includes(raw) ? raw : "image/jpeg") as typeof mediaType;
      const buffer = await imgRes.arrayBuffer();
      imageBase64 = Buffer.from(buffer).toString("base64");
      fetchedOk = true;
      break;
    } catch { continue; }
  }
  if (!fetchedOk) {
    return NextResponse.json(
      { error: `Could not fetch image from ${absoluteImageUrl}` },
      { status: 400 }
    );
  }

  try {
    const message = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imageBase64 },
            },
            {
              type: "text",
              text: `Analyze this image and identify 3–5 visually distinct points of interest that would work well as interactive hotspots (e.g. products, features, people, locations, UI elements).

For each point return:
- x: horizontal position as a percentage (0 = left edge, 100 = right edge)
- y: vertical position as a percentage (0 = top edge, 100 = bottom edge)
- label: a concise label, 2–5 words
- description: one or two sentences suitable for a tooltip

Respond ONLY with a valid JSON array in this exact shape, no markdown fences:
[{"x": number, "y": number, "label": string, "description": string}]`,
            },
          ],
        },
      ],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "[]";

    let suggestions: AIDetectedSpot[] = [];
    try {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) suggestions = JSON.parse(match[0]);
    } catch {
      suggestions = [];
    }

    return NextResponse.json({ suggestions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Vision analysis failed";
    console.error("[smartspot/vision]", err);
    return NextResponse.json({ error: message, suggestions: [] }, { status: 500 });
  }
}
