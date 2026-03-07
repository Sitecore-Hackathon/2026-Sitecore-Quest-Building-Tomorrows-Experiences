/**
 * Tests for /api/smartspot/vision
 *
 * Covers: API key guard, URL validation, protocol enforcement,
 * successful spot detection, malformed AI JSON, and error handling.
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

const VALID_URL = "https://example.com/hero.jpg";

const SAMPLE_SPOTS = [
  { x: 25, y: 40, label: "Main Product", description: "Our flagship item." },
  { x: 70, y: 60, label: "Call to Action", description: "Click to learn more." },
];

// ── tests ────────────────────────────────────────────────────────────────────
describe("POST /api/smartspot/vision", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("returns 503 when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { POST } = await import("@/src/app/api/smartspot/vision/route");
    const res = await POST(makeReq({ imageUrl: VALID_URL }));
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error).toMatch(/not configured/i);
  });

  it("returns 400 when imageUrl is missing", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { POST } = await import("@/src/app/api/smartspot/vision/route");
    const res = await POST(makeReq({}));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/imageUrl is required/i);
  });

  it("returns 400 for a completely invalid URL", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { POST } = await import("@/src/app/api/smartspot/vision/route");
    const res = await POST(makeReq({ imageUrl: "not-a-url" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/not a valid URL/i);
  });

  it("returns 400 for non-http/https protocol", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { POST } = await import("@/src/app/api/smartspot/vision/route");
    const res = await POST(makeReq({ imageUrl: "ftp://example.com/img.jpg" }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/http\/https/i);
  });

  it("returns detected spots on success", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(SAMPLE_SPOTS) }],
    });
    const { POST } = await import("@/src/app/api/smartspot/vision/route");
    const res = await POST(makeReq({ imageUrl: VALID_URL }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.suggestions).toHaveLength(2);
    expect(body.suggestions[0].label).toBe("Main Product");
    expect(body.suggestions[0].x).toBe(25);
  });

  it("returns empty suggestions when AI returns malformed JSON", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Sorry, I cannot analyse this image." }],
    });
    const { POST } = await import("@/src/app/api/smartspot/vision/route");
    const res = await POST(makeReq({ imageUrl: VALID_URL }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.suggestions).toEqual([]);
  });

  it("extracts JSON array even when surrounded by prose", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const wrappedJson = `Here are the hotspots: ${JSON.stringify(SAMPLE_SPOTS)} Let me know if you need more.`;
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: wrappedJson }],
    });
    const { POST } = await import("@/src/app/api/smartspot/vision/route");
    const res = await POST(makeReq({ imageUrl: VALID_URL }));
    const body = await res.json();
    expect(body.suggestions).toHaveLength(2);
  });

  it("returns 500 with error message when Anthropic throws", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockRejectedValue(new Error("Vision API unavailable"));
    const { POST } = await import("@/src/app/api/smartspot/vision/route");
    const res = await POST(makeReq({ imageUrl: VALID_URL }));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe("Vision API unavailable");
    expect(body.suggestions).toEqual([]);
  });
});
