import type { ClientSDK, PagesContext } from "@sitecore-marketplace-sdk/client";
import { Key } from "react";

export interface HotspotImageData {
  desktop: {
    url: string;
    base64: string;
  };
  tablet: {
    url: string;
    base64: string;
  };
  mobile: {
    url: string;
    base64: string;
  };
}

/**
 * Fetch the images URLs from the ImageHotspots rendering's datasouce item.
 */
export async function fetchImages(
  client: ClientSDK,
  sitecoreContextId: string,
  pagesContext: PagesContext
): Promise<HotspotImageData | null> {
  if (!(pagesContext || sitecoreContextId)) return null;

  const desktopImageField = "DesktopImage";
  const tabletImageField = "TabletImage";
  const mobileImageField = "MobileImage";
  const renderingId = "{6BD21CC3-426F-4B42-A762-D5148049B4CA}";
  const pageItemPath = pagesContext.pageInfo?.path || "";
  const pageId = pagesContext.pageInfo?.id || "";
  const language = pagesContext.language || "en";

  interface renderQueryResponse {
    data: {
      data: {
        item: {
          field: {
            value: string;
          };
        };
      };
    };
  }

  interface imageQueryResponse {
    data: {
      data: {
        item: {
          DesktopImage: {
            jsonValue: {
              value: {
                src: string;
                alt: string;
                width: string;
                height: string;
              };
            };
          },
          TabletImage: {
            jsonValue: {
              value: {
                src: string;
                alt: string;
                width: string;
                height: string;
              };
            };
          },
          MobileImage: {
            jsonValue: {
              value: {
                src: string;
                alt: string;
                width: string;
                height: string;
              };
            };
          }
        };
      };
    };
  }

  const renderingQuery = `
    query RenderingQuery {
      item(where: {path: "${pageId}", language: "${language}"})
      {
        field(name: "__final renderings") {
          value
        }
      }
    }
  `;

  function getImageQuery(datasourcePath: string, language: string): string {
    return `
      query {
        item(path: "${datasourcePath}", language: "${language}") {
          DesktopImage: field(name: "DesktopImage") {
            jsonValue
          }
          TabletImage: field(name: "TabletImage") {
            jsonValue
          }
          MobileImage: field(name: "MobileImage") {
            jsonValue
          }
        }
      }
    `;
  }

  function getDatasourcePathByRenderingId(xml: string, targetId: string): string | null {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");

    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      throw new Error(`XML parsing failed: ${parseError.textContent}`);
    }

    const rElements = doc.querySelectorAll("r");

    for (const r of rElements) {
      const sId = r.getAttributeNS("s", "id");
      if (sId === targetId) {
        return r.getAttributeNS("s", "ds");
      }
    }

    return null;
  }

  async function imageUrlToBase64(url: string): Promise<string> {
    if (!url) {
      return "";
    }

    const proxyUrl = `/api/smartspot/imageproxy?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl);

    if (!response.ok) {
      console.error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      return "";
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const binary = uint8Array.reduce((acc, byte) => acc + String.fromCharCode(byte), "");
    const base64 = btoa(binary);

    return `data:${contentType};base64,${base64}`;
  }

  let result: Awaited<ReturnType<typeof client.mutate>>;
  try {
    result = await client.mutate("xmc.authoring.graphql", {
      params: {
        query: { sitecoreContextId },
        body: { query: renderingQuery },
      },
    });
  } catch {
    return null;
  }

  const renderingData = result as renderQueryResponse;
  if (!renderingData) return null;
  
  const renderingsXml = renderingData.data.data.item.field.value;
  const datasourcePath = getDatasourcePathByRenderingId(renderingsXml, renderingId);
  if (datasourcePath) {
    let finalPath = datasourcePath;
    if (datasourcePath.startsWith("local:")) {
      const localPath = datasourcePath.replace("local:", "");
      finalPath = `${pageItemPath}${localPath}`;
    }

    console.log("Datasource path for hotspots", finalPath);

    const imageQuery = getImageQuery(finalPath, language);
    let imageResult: Awaited<ReturnType<typeof client.mutate>>;

    try {
      imageResult = await client.mutate("xmc.preview.graphql", {
        params: {
          query: { sitecoreContextId },
          body: { query: imageQuery },
        },
      });
    } catch {
      return null;
    }

    const imageResultData = imageResult as imageQueryResponse;
    if (!imageResultData) return null;

    const desktopUrl = imageResultData.data.data.item.DesktopImage.jsonValue.value.src || "";
    const tabletUrl = imageResultData.data.data.item.TabletImage.jsonValue.value.src || "";
    const mobileUrl = imageResultData.data.data.item.MobileImage.jsonValue.value.src || "";
    const desktopBase64 = await imageUrlToBase64(desktopUrl);
    const tabletBase64 = await imageUrlToBase64(tabletUrl);
    const mobileBase64 = await imageUrlToBase64(mobileUrl);

    const hotspotImageData: HotspotImageData = {
      desktop: {
        url: desktopUrl,
        base64: desktopBase64,
      },
      tablet: {
        url: tabletUrl,
        base64: tabletBase64,
      },
      mobile: {
        url: mobileUrl,
        base64: mobileBase64,
      },
    };

    return hotspotImageData;
  }

  return null;
}
