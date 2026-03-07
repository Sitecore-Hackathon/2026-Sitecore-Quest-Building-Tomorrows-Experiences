![Hackathon Logo](docs/images/hackathon.png?raw=true "Hackathon Logo")

# Hackathon Submission Entry form

## Team name
Sitecore Quest: Building Tomorrow's Experiences

**Team Members:** Yamini Punyavathi Muttevi · Krushna Patel · Dennis Lee

## Category
XM Cloud Marketplace Plugin — Custom Field Extension

## Description

**SmartSpot** is an AI-powered interactive image hotspot editor built as a Custom Field Extension for the Sitecore XM Cloud Page Builder.

- **Module Purpose:** SmartSpot lets content authors visually place, configure, and enrich clickable hotspot pins on images — directly inside the Page Builder sidebar — and saves the result as structured JSON into a Sitecore custom field. The saved data drives a front-end `ImageHotspots` rendering component that delivers the interactive experience to site visitors: hoverable/clickable pins overlaid on an image, each with a label, description tooltip, and optional CTA link.

- **What problem was solved:** Creating interactive image hotspots traditionally requires developers to manually coordinate pixel positions, separate tooling for copy and accessibility labels, no per-device flexibility, and no brand compliance workflow — all disconnected from the CMS. This is slow, fragile, and puts the burden on technical staff rather than authors.

- **How does this module solve it:** SmartSpot brings the entire hotspot authoring workflow inside Sitecore Page Builder:
  - Visual click-to-place and drag-to-reposition pins on the live image
  - Per-breakpoint variants (Desktop / Tablet / Mobile) with images loaded automatically from the component datasource
  - Claude AI generates on-brand hotspot descriptions from just a label
  - Claude Vision analyses the image and auto-suggests where hotspots should go
  - A quality audit scores every hotspot for brand compliance, accessibility, and completeness
  - The Claude API key and Brand Kit are both sourced from Sitecore — no external configuration needed per author

## Video link

⟹ [Replace this Video link](#video-link)

## Pre-requisites and Dependencies

- **Sitecore XM Cloud** with the Marketplace custom field extension capability enabled
- **Node.js 18+** to run or deploy the Next.js extension app
- **Anthropic API key** for all AI features — stored as a Sitecore site property (see Configuration)
- **ImageHotspots rendering** installed on your XM Cloud instance, with a datasource template containing `DesktopImage`, `TabletImage`, and `MobileImage` image fields
- The **SmartSpot custom field** registered in XM Cloud Page Builder pointing to the deployed extension URL

## Installation instructions

1. Clone the repository:
   ```bash
   git clone https://github.com/Sitecore-Hackathon/2026-sitecore-quest
   cd 2026-sitecore-quest
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env.local` and set your Anthropic API key:
   ```bash
   cp .env.example .env.local
   ```
   ```env
   ANTHROPIC_API_KEY=sk-ant-...
   ```

4. Run locally for development:
   ```bash
   npm run dev
   ```
   The extension is available at `http://localhost:3000/smartspot`.

5. Deploy the Next.js app to your preferred host (Vercel, Azure App Service, etc.).

6. In XM Cloud, register the deployed URL as a **Custom Field Extension** under Marketplace settings, and add the SmartSpot field type to your `ImageHotspots` datasource template.

### Configuration

**Claude API Key**

Store your Anthropic API key as a site property on the Sitecore site grouping item. SmartSpot reads it at load time via the Authoring GraphQL API — no environment variable needed in production.

| Property key | Value |
|---|---|
| `smartspot-claude-apikey` | `sk-ant-api03-...` |

If the key is missing the extension shows a clear error screen with instructions for the site administrator.

**ImageHotspots Rendering ID**

The rendering ID used to locate the component datasource is defined in `src/app/smartspot/utils/imageUtil.ts`:
```
{6BD21CC3-426F-4B42-A762-D5148049B4CA}
```
Update this GUID if your `ImageHotspots` rendering item has a different ID in your Sitecore instance.

**Datasource Image Fields**

The datasource item must have three image fields named exactly: `DesktopImage`, `TabletImage`, `MobileImage`.

## Usage instructions

SmartSpot opens as a panel inside XM Cloud Page Builder when an author edits a field using the SmartSpot custom field type.

### Editor layout

```
┌─────────────────────────────────────────────────────┐
│  [Desktop ▾]   [✨ Auto-Detect]           [Save]    │  ← Toolbar
├──────────────────────────────┬──────────────────────┤
│                              │  Hotspots  | Quality  │
│      Image Canvas            │  ──────────────────  │
│   (click to place pins,      │  • Pin list          │
│    drag to reposition)       │  • Property editor   │
│                              │  • AI buttons        │
├──────────────────────────────┴──────────────────────┤
│  Desktop | 3 hotspots | 3 with aria-label | Brand: Acme │  ← Status bar
└─────────────────────────────────────────────────────┘
```

### Placing and editing hotspots

1. Select a breakpoint from the toolbar — **Desktop**, **Tablet**, or **Mobile**
2. **Click anywhere on the image** to place a pin at that position
3. Fill in the fields in the right panel:

   | Field | Purpose |
   |-------|---------|
   | Label | Short title shown as the pin tooltip (2–5 words) |
   | Aria Label | Screen-reader description — required for accessibility |
   | Description | Longer tooltip copy, up to 160 characters |
   | Link URL | Optional CTA destination |
   | Link Text | Anchor text for the CTA (e.g. "Learn more") |
   | Icon Style | Pin glyph: ● Circle, + Plus, *i* Info, ★ Star, ▼ Pin |
   | Color | Pin background — 8 colour presets or a custom picker |

4. **Drag** any pin to reposition it. Click **×** next to a pin in the list to delete it.

### AI: Auto-Detect hotspots

Click **✨ Auto-Detect** in the toolbar. Claude Vision analyses the active image and suggests 3–7 hotspot positions with pre-filled labels and descriptions. Review the suggestions, adjust positions, and delete any that aren't relevant. Run separately for each breakpoint if the image crops differ.

### AI: Generate description

With a hotspot selected and a **Label** filled in, click the **✨ AI** button inside the description field. Claude writes a 2–3 sentence, benefit-led description (max 160 characters) grounded in the site's Brand Kit tone of voice. Edit freely after generation.

### Quality Check tab

Open the **Quality Check** tab and click **✨ Run Quality Check** to audit all hotspots at once. Claude evaluates each pin on:

| Dimension | What is checked |
|-----------|----------------|
| Brand voice | Clear, benefit-led, professional copy — matches brand guidelines |
| Accessibility | aria-label present, unique, screen-reader friendly |
| Completeness | Label, description, and aria-label all filled in |
| Clarity | Label is concise and descriptive |
| Link quality | Link text is descriptive and not generic |

Each hotspot receives a score from 0–100:
- 🟢 **80–100** — compliant
- 🟡 **60–79** — minor issues
- 🔴 **0–59** — requires attention

Scores also appear as inline badges on each pin in the hotspot list, and the status bar shows the average across all checked hotspots.

### Saving

Click **Save**. The field JSON is written back to Sitecore, the Page Builder preview canvas reloads automatically, and the extension closes after a brief confirmation.

![Hackathon Logo](docs/images/hackathon.png?raw=true "Hackathon Logo")

## Comments

- The Claude API key is managed through Sitecore site properties rather than a shared server environment variable, allowing different XM Cloud sites to use different keys without redeployment.
- Hotspot coordinates are stored as percentages (0–100) of image dimensions rather than absolute pixels, making the data resolution-independent and safe across CDN-resized variants.
- SmartSpot degrades gracefully in local development (outside the Sitecore iframe): all visual editing still works, and a **Copy field JSON** button appears in the status bar so developers can inspect the output.
- The quality audit is capped at 20 hotspots per run to stay within Claude's token budget for a single request.
