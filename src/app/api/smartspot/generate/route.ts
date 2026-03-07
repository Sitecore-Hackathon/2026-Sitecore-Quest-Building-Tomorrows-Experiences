import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { label, context, brandContext } = (await req.json()) as {
    label: string;
    context?: string;
    brandContext?: string;
  };

  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

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
          content: `You are a brand copywriter for a Sitecore CMS website. Write a concise, engaging hotspot description (2–3 sentences, maximum 160 characters) for an interactive image hotspot labeled "${label}".${context ? ` The page or component context is: "${context}".` : ""}${brandSection} The copy must be clear, benefit-led, and accessible. Return only the description text — no quotes, no bullet points, no extra formatting.`,
        },
      ],
    });

    const description =
      message.content[0].type === "text" ? message.content[0].text.trim() : "";

    return NextResponse.json({ description });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generate failed";
    console.error("[smartspot/generate]", err);
    return NextResponse.json({ error: message, description: "" }, { status: 500 });
  }
}
