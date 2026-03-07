/**
 * Tests for src/app/smartspot/utils/brandKit.ts
 *
 * Covers: empty ID guard, GUID normalisation, field extraction,
 * summary formatting, and graceful failure modes.
 */

import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import { fetchBrandKit } from "@/src/app/smartspot/utils/brandKit";

// ── helpers ─────────────────────────────────────────────────────────────────
type MutateResult = { data?: unknown };

function makeClient(mutateImpl: () => Promise<MutateResult>): ClientSDK {
  return {
    mutate: jest.fn(mutateImpl),
  } as unknown as ClientSDK;
}

function makeItemResponse(fields: { name: string; value: string }[], name = "Test Brand") {
  return Promise.resolve({
    data: {
      item: { name, fields },
    },
  });
}

// ── tests ────────────────────────────────────────────────────────────────────
describe("fetchBrandKit", () => {
  it("returns null immediately when brandKitId is empty", async () => {
    const client = makeClient(() => makeItemResponse([]));
    const result = await fetchBrandKit(client, "");
    expect(result).toBeNull();
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it("normalises a GUID with braces and dashes before querying", async () => {
    const client = makeClient(() => makeItemResponse([{ name: "TagLine", value: "Hello" }]));
    await fetchBrandKit(client, "{A1B2-C3D4-E5F6}");
    const callArg = (client.mutate as jest.Mock).mock.calls[0];
    const body = callArg[1].params.body.query as string;
    // The query should contain the normalised ID (lowercase, no braces/dashes)
    // wrapped in double quotes as a string literal inside the GraphQL query
    expect(body).toContain('"a1b2c3d4e5f6"');
    // The GUID value itself should not include braces or dashes
    const idMatch = body.match(/id:\s*"([^"]+)"/);
    expect(idMatch).not.toBeNull();
    expect(idMatch![1]).not.toContain("{");
    expect(idMatch![1]).not.toContain("-");
  });

  it("returns null when mutate throws", async () => {
    const client = makeClient(() => {
      throw new Error("Network error");
    });
    const result = await fetchBrandKit(client, "abc123");
    expect(result).toBeNull();
  });

  it("returns null when item is missing from the response", async () => {
    const client = makeClient(() => Promise.resolve({ data: { item: null } }));
    const result = await fetchBrandKit(client, "abc123");
    expect(result).toBeNull();
  });

  it("returns null when item has no non-empty fields", async () => {
    const client = makeClient(() =>
      makeItemResponse([
        { name: "TagLine", value: "" },
        { name: "Description", value: "   " },
      ])
    );
    const result = await fetchBrandKit(client, "abc123");
    expect(result).toBeNull();
  });

  it("returns BrandKitContext with name and fields map on success", async () => {
    const client = makeClient(() =>
      makeItemResponse(
        [
          { name: "tagline", value: "Innovate Together" },
          { name: "toneofvoice", value: "Professional, warm" },
        ],
        "Acme Brand"
      )
    );
    const result = await fetchBrandKit(client, "abc123");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Acme Brand");
    expect(result!.fields["tagline"]).toBe("Innovate Together");
    expect(result!.fields["toneofvoice"]).toBe("Professional, warm");
  });

  it("generates a summary string starting with the brand name", async () => {
    const client = makeClient(() =>
      makeItemResponse([{ name: "tagline", value: "Innovate Together" }], "Acme Brand")
    );
    const result = await fetchBrandKit(client, "abc123");
    expect(result!.summary).toMatch(/^Brand kit "Acme Brand"/);
    expect(result!.summary).toContain("Innovate Together");
  });

  it("uses human-readable labels for known field names in the summary", async () => {
    const client = makeClient(() =>
      makeItemResponse(
        [
          { name: "toneofvoice", value: "Friendly" },
          { name: "targetaudience", value: "Developers" },
        ],
        "Dev Brand"
      )
    );
    const result = await fetchBrandKit(client, "abc123");
    expect(result!.summary).toContain("Tone of voice: Friendly");
    expect(result!.summary).toContain("Target audience: Developers");
  });

  it("uses the raw field name for unknown field names", async () => {
    const client = makeClient(() =>
      makeItemResponse([{ name: "customField123", value: "Some value" }], "X Brand")
    );
    const result = await fetchBrandKit(client, "abc123");
    expect(result!.summary).toContain("customField123: Some value");
  });

  it("trims whitespace from field values", async () => {
    const client = makeClient(() =>
      makeItemResponse([{ name: "tagline", value: "  Hello World  " }], "B")
    );
    const result = await fetchBrandKit(client, "abc123");
    expect(result!.fields["tagline"]).toBe("Hello World");
  });
});
