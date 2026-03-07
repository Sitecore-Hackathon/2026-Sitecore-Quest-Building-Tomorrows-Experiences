import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { AIDetectedSpot } from "@/src/app/smartspot/types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { imageUrl } = (await req.json()) as { imageUrl: string };

  if (!imageUrl) {
    return NextResponse.json(
      { error: "imageUrl is required" },
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
              source: { type: "url", url: imageUrl },
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
