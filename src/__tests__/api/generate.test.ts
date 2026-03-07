/**
 * Tests for /api/smartspot/generate
 *
 * Covers: API key guard, input validation, label sanitisation,
 * AI response truncation, and error handling.
 */

import { NextRequest } from "next/server";

// ── Anthropic SDK mock ──────────────────────────────────────────────────────
const mockCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn(() => ({ messages: { create: mockCreate } })),
}));

// ── helpers ─────────────────────────────────────────────────────────────────
function makeReq(body: Record<string, unknown>): NextRequest {
  return {
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

function makeAnthropicReply(text: string) {
  return {
    content: [{ type: "text", text }],
  };
}

// ── tests ────────────────────────────────────────────────────────────────────
describe("POST /api/smartspot/generate", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("returns 503 when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { POST } = await import("@/src/app/api/smartspot/generate/route");
    const res = await POST(makeReq({ label: "Hero Product" }));
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error).toMatch(/not configured/i);
  });

  it("returns 400 when label is missing", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { POST } = await import("@/src/app/api/smartspot/generate/route");
    const res = await POST(makeReq({}));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/label is required/i);
  });

  it("returns generated description on success", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue(
      makeAnthropicReply("Discover our flagship product with cutting-edge features.")
    );
    const { POST } = await import("@/src/app/api/smartspot/generate/route");
    const res = await POST(makeReq({ label: "Hero Product" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.description).toBe(
      "Discover our flagship product with cutting-edge features."
    );
  });

  it("strips < and > from label before sending to AI", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue(makeAnthropicReply("Safe copy here."));
    const { POST } = await import("@/src/app/api/smartspot/generate/route");
    await POST(makeReq({ label: "<script>alert('xss')</script>" }));
    const callArg = mockCreate.mock.calls[0][0];
    const prompt: string = callArg.messages[0].content;
    expect(prompt).not.toContain("<script>");
    expect(prompt).toContain("scriptalert('xss')/script");
  });

  it("truncates label to 200 characters", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue(makeAnthropicReply("Short copy."));
    const longLabel = "A".repeat(300);
    const { POST } = await import("@/src/app/api/smartspot/generate/route");
    await POST(makeReq({ label: longLabel }));
    const callArg = mockCreate.mock.calls[0][0];
    const prompt: string = callArg.messages[0].content;
    // The safe label inside the prompt should be max 200 chars
    const match = prompt.match(/<label>(.*?)<\/label>/);
    expect(match![1].length).toBe(200);
  });

  it("truncates AI output and appends ellipsis when over 160 characters", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const longText = "X".repeat(200);
    mockCreate.mockResolvedValue(makeAnthropicReply(longText));
    const { POST } = await import("@/src/app/api/smartspot/generate/route");
    const res = await POST(makeReq({ label: "Feature" }));
    const body = await res.json();
    // 157 chars of content + "…" (1 code unit) = 158 JS string length
    expect(body.description.length).toBe(158);
    expect(body.description.endsWith("…")).toBe(true);
  });

  it("returns 500 with error message when Anthropic throws", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockRejectedValue(new Error("Rate limit exceeded"));
    const { POST } = await import("@/src/app/api/smartspot/generate/route");
    const res = await POST(makeReq({ label: "Feature" }));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe("Rate limit exceeded");
  });
});
