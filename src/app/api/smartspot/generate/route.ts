import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-Claude-Api-Key");
  if (!apiKey) {
    return NextResponse.json({ error: "Claude API key not provided" }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey });

  const { label, context, brandContext } = (await req.json()) as {
    label: string;
    context?: string;
    brandContext?: string;
  };

  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  // Sanitise label to prevent prompt injection
  const safeLabel = label.replace(/[<>]/g, "").slice(0, 200);

  const brandSection = brandContext
    ? `\n\nYou MUST follow these brand guidelines when writing:\n${brandContext}`
    : "";

  try {
    const message = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: `You are a brand copywriter for a Sitecore CMS website. Write a concise, engaging hotspot description (2–3 sentences, maximum 160 characters) for an interactive image hotspot labeled <label>${safeLabel}</label>.${context ? ` The page or component context is: "${context}".` : ""}${brandSection} The copy must be clear, benefit-led, and accessible. Return only the description text — no quotes, no bullet points, no extra formatting.`,
        },
      ],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text.trim() : "";
    const description = raw.length > 160 ? raw.slice(0, 157) + "…" : raw;

    return NextResponse.json({ description });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generate failed";
    console.error("[smartspot/generate]", err);
    return NextResponse.json({ error: message, description: "" }, { status: 500 });
  }
}
