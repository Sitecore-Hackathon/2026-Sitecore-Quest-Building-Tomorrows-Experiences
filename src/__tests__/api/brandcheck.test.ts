/**
 * Tests for /api/smartspot/brandcheck
 *
 * Covers: API key guard, empty hotspot short-circuit, hotspot cap at 20,
 * successful audit results, malformed AI JSON, and error handling.
 */

import { NextRequest } from "next/server";
import type { Hotspot } from "@/src/app/smartspot/types";

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

function makeHotspot(id: string, overrides: Partial<Hotspot> = {}): Hotspot {
  return {
    id,
    x: 50,
    y: 50,
    label: `Label ${id}`,
    description: `Description for ${id}.`,
    ariaLabel: `Aria label for ${id}`,
    link: { href: "https://example.com", text: "Learn more" },
    iconStyle: "circle",
    color: "#3b82f6",
    ...overrides,
  };
}

const SAMPLE_RESULTS = [
  { hotspotId: "hs_1", score: 90, issues: [], suggestions: ["Add more detail"] },
  { hotspotId: "hs_2", score: 55, issues: ["Missing aria-label"], suggestions: [] },
];

// ── tests ────────────────────────────────────────────────────────────────────
describe("POST /api/smartspot/brandcheck", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("returns 503 when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { POST } = await import("@/src/app/api/smartspot/brandcheck/route");
    const res = await POST(makeReq({ hotspots: [makeHotspot("hs_1")] }));
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error).toMatch(/not configured/i);
  });

  it("returns empty results immediately when hotspots array is empty", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { POST } = await import("@/src/app/api/smartspot/brandcheck/route");
    const res = await POST(makeReq({ hotspots: [] }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns empty results immediately when hotspots is missing", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { POST } = await import("@/src/app/api/smartspot/brandcheck/route");
    const res = await POST(makeReq({}));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns brand check results on success", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(SAMPLE_RESULTS) }],
    });
    const { POST } = await import("@/src/app/api/smartspot/brandcheck/route");
    const res = await POST(
      makeReq({ hotspots: [makeHotspot("hs_1"), makeHotspot("hs_2")] })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(2);
    expect(body.results[0].score).toBe(90);
    expect(body.results[1].issues).toContain("Missing aria-label");
  });

  it("caps hotspots at 20 before sending to AI", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "[]" }],
    });
    const hotspots = Array.from({ length: 25 }, (_, i) => makeHotspot(`hs_${i}`));
    const { POST } = await import("@/src/app/api/smartspot/brandcheck/route");
    await POST(makeReq({ hotspots }));
    const callArg = mockCreate.mock.calls[0][0];
    const prompt: string = callArg.messages[0].content;
    // Only 20 hotspot IDs should appear in the prompt
    const idMatches = prompt.match(/ID: hs_/g) ?? [];
    expect(idMatches.length).toBe(20);
  });

  it("returns empty results when AI returns malformed JSON", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "I cannot evaluate these hotspots." }],
    });
    const { POST } = await import("@/src/app/api/smartspot/brandcheck/route");
    const res = await POST(makeReq({ hotspots: [makeHotspot("hs_1")] }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results).toEqual([]);
  });

  it("injects brandContext into the AI prompt when provided", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "[]" }],
    });
    const { POST } = await import("@/src/app/api/smartspot/brandcheck/route");
    await POST(
      makeReq({
        hotspots: [makeHotspot("hs_1")],
        brandContext: "Tone: professional, aspirational",
      })
    );
    const callArg = mockCreate.mock.calls[0][0];
    const prompt: string = callArg.messages[0].content;
    expect(prompt).toContain("Tone: professional, aspirational");
  });

  it("returns 500 with error message when Anthropic throws", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockRejectedValue(new Error("Context window exceeded"));
    const { POST } = await import("@/src/app/api/smartspot/brandcheck/route");
    const res = await POST(makeReq({ hotspots: [makeHotspot("hs_1")] }));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe("Context window exceeded");
    expect(body.results).toEqual([]);
  });
});
