export type IconStyle = "circle" | "plus" | "info" | "star" | "pin";

export interface HotspotLink {
  href: string;
  text: string;
}

export interface Hotspot {
  id: string;
  /** 0–100, percentage of image width from left */
  x: number;
  /** 0–100, percentage of image height from top */
  y: number;
  label: string;
  description: string;
  link: HotspotLink;
  iconStyle: IconStyle;
  color: string;
  ariaLabel: string;
}

export type Breakpoint = "desktop" | "tablet" | "mobile";

export interface ImageVariant {
  imageUrl: string;
  hotspots: Hotspot[];
}

export interface SmartSpotData {
  /** Schema version — increment when the shape changes to enable migration */
  version: 1;
  variants: Partial<Record<Breakpoint, ImageVariant>>;
}

export interface BrandCheckResult {
  hotspotId: string;
  /** Compliance score 0–100 */
  score: number;
  issues: string[];
  suggestions: string[];
}

export interface AIDetectedSpot {
  x: number;
  y: number;
  label: string;
  description: string;
}
