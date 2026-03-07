import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { Hotspot, BrandCheckResult } from "@/src/app/smartspot/types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { hotspots, brandContext } = (await req.json()) as {
    hotspots: Hotspot[];
    brandContext?: string;
  };

  if (!hotspots?.length) {
    return NextResponse.json({ results: [] });
  }

  const hotspotSummary = hotspots
    .map(
      (h) =>
        `ID: ${h.id}\n  Label: "${h.label}"\n  Description: "${h.description}"\n  Aria-label: "${h.ariaLabel}"\n  Link text: "${h.link.text}"`
    )
    .join("\n\n");

  const brandSection = brandContext
    ? `\n\nBrand guidelines to evaluate against:\n${brandContext}\n`
    : "";

  try {
    const message = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `You are a brand compliance auditor for a web content platform. Review the following image hotspots and evaluate each on:

1. **Brand voice** — is the copy clear, benefit-led, and professional?${brandContext ? " Does it match the brand guidelines provided?" : ""}
2. **Accessibility** — does it have an aria-label? Is the label unique among the set? Is copy screen-reader friendly?
3. **Completeness** — does it have a label, description, and aria-label?
4. **Clarity** — is the label concise and descriptive?
${brandSection}
Hotspots to review:
${hotspotSummary}

Return ONLY a valid JSON array (no markdown fences) with one entry per hotspot in this exact shape:
[{"hotspotId": string, "score": number, "issues": string[], "suggestions": string[]}]

Score 0–100 where 100 = fully compliant. Keep issues and suggestions brief (under 80 chars each).`,
        },
      ],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "[]";

    let results: BrandCheckResult[] = [];
    try {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) results = JSON.parse(match[0]);
    } catch {
      results = [];
    }

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Brand check failed";
    console.error("[smartspot/brandcheck]", err);
    return NextResponse.json({ error: message, results: [] }, { status: 500 });
  }
}
