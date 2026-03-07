import type { ClientSDK } from "@sitecore-marketplace-sdk/client";

export interface BrandKitContext {
  name: string;
  /** Key brand fields extracted from the Sitecore item */
  fields: Record<string, string>;
  /** Ready-to-inject prompt string summarising the brand kit */
  summary: string;
}

/**
 * Normalise a Sitecore GUID to the bare 32-char hex string the
 * Authoring GraphQL API accepts in `where: { id: "..." }`.
 */
function normaliseId(raw: string): string {
  return raw.replace(/[{}\-]/g, "").toLowerCase();
}

/**
 * Field names commonly found on Sitecore Brand Kit items.
 * Keys are lowercased, space-stripped versions of the Sitecore field name.
 */
const FIELD_LABELS: Record<string, string> = {
  brandname: "Brand name",
  name: "Brand name",
  tagline: "Tagline",
  description: "Brand description",
  toneofvoice: "Tone of voice",
  voiceandtone: "Tone of voice",
  guidelines: "Brand guidelines",
  primarycolor: "Primary colour",
  secondarycolor: "Secondary colour",
  fontfamily: "Font family",
  keywords: "Brand keywords",
  targetaudience: "Target audience",
};

/**
 * Fetch a brand kit item from the Sitecore Authoring GraphQL API and return
 * a structured context object for use in Claude prompts.
 *
 * Returns `null` when the brand kit ID is missing, the query fails, or the
 * item has no usable fields — callers should degrade gracefully.
 */
export async function fetchBrandKit(
  client: ClientSDK,
  brandKitId: string,
  sitecoreContextId?: string
): Promise<BrandKitContext | null> {
  if (!brandKitId) return null;

  const id = normaliseId(brandKitId);

  const query = `
    query GetBrandKit {
      item(where: { id: "${id}" }) {
        id
        name
        fields { nodes { name value } }
      }
    }
  `;

  let result: Awaited<ReturnType<typeof client.mutate>>;
  try {
    result = await client.mutate("xmc.authoring.graphql", {
      params: {
        body: { query },
        ...(sitecoreContextId ? { query: { sitecoreContextId } } : {}),
      },
    });
  } catch {
    return null;
  }

  type RawItem = {
    name?: string;
    fields?: { nodes?: { name: string; value: string }[] };
  };

  const item = (result?.data as { data?: { item?: RawItem } } | undefined)?.data?.item;
  if (!item) return null;

  // Build a normalised key→value map, preserving original field name for labels
  const fields: Record<string, string> = {};
  const labelledLines: string[] = [];

  for (const f of item.fields?.nodes ?? []) {
    const trimmed = f.value?.trim();
    if (!trimmed) continue;

    const normKey = f.name.toLowerCase().replace(/\s+/g, "");
    fields[normKey] = trimmed;

    const label = FIELD_LABELS[normKey] ?? f.name;
    labelledLines.push(`- ${label}: ${trimmed}`);
  }

  if (labelledLines.length === 0) return null;

  const summary =
    `Brand kit "${item.name ?? brandKitId}":\n` + labelledLines.join("\n");

  return { name: item.name ?? brandKitId, fields, summary };
}
