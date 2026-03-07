import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { AIDetectedSpot } from "@/src/app/smartspot/types";

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-Claude-Api-Key");
  if (!apiKey) {
    return NextResponse.json({ error: "Claude API key not provided" }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey });
  
  const imageUrl = (await req.text()).trim();

  if (!imageUrl) {
    return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });
  }

  function parseBase64ImageUrl(base64Url: string): { mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } {
    const [metadata, data] = base64Url.split(",");
    const mediaTypeRaw = metadata.split(":")[1].split(";")[0];
    const validMediaTypes: ("image/jpeg" | "image/png" | "image/gif" | "image/webp")[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    const mediaType = validMediaTypes.includes(mediaTypeRaw as any) ? (mediaTypeRaw as "image/jpeg" | "image/png" | "image/gif" | "image/webp") : "image/jpeg";

    return { mediaType, data };
  }

  try {
    const { mediaType, data } = parseBase64ImageUrl(imageUrl);
    const message = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { 
                type: "base64", 
                media_type: mediaType,
                data: data
              },
            },
            {
              type: "text",
              text: `Analyze this image and identify 3–7 visually distinct points of interest that would work well as interactive hotspots (e.g. products, features, people, locations, UI elements).

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
