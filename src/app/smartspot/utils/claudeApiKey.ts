import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import { Key } from "react";

/**
 * Fetch the Claude API key stored in site properties.
 * Returns `null` when the key is missing or the query fails
 */
export async function fetchClaudeApiKey(
  client: ClientSDK,
  sitecoreContextId: string,
  site: string
): Promise<string | null> {
  if (!(site || sitecoreContextId)) return null;

  const keyName = "smartspot-claude-apikey";

  interface SiteResponse {
    data: {
      data: {
        site: {
          properties: { key: string; value: string }[];
        };
      };
    };
  }

  const query = `
    query {
      site(siteName: "${site}") {
        properties {
          key
          value
        }
      }
    }
  `;

  let result: Awaited<ReturnType<typeof client.mutate>>;
  try {
    result = await client.mutate("xmc.authoring.graphql", {
      params: {
        query: { sitecoreContextId },
        body: { query },
      },
    });
  } catch {
    return null;
  }

  const siteData = result as SiteResponse;
  if (!siteData) return null;

  const apiKey = siteData.data.data.site.properties.find((prop) => prop.key === keyName)?.value;

  return apiKey || null;
}
