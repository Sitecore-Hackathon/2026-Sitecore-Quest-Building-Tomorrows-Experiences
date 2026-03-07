/**
 * @jest-environment jsdom
 *
 * Tests for HotspotPanel component.
 *
 * Covers: empty state, hotspot list rendering, brand score badges,
 * editor form fields, AI generate button, brand-check tab, and
 * delete / select interactions.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { HotspotPanel } from "@/src/app/smartspot/components/HotspotPanel";
import type { Hotspot, BrandCheckResult } from "@/src/app/smartspot/types";

// ── helpers ─────────────────────────────────────────────────────────────────
function makeHotspot(id: string, overrides: Partial<Hotspot> = {}): Hotspot {
  return {
    id,
    x: 50,
    y: 50,
    label: `Label ${id}`,
    description: `Description ${id}`,
    ariaLabel: `Aria ${id}`,
    link: { href: "https://example.com", text: "Learn more" },
    iconStyle: "circle",
    color: "#3b82f6",
    ...overrides,
  };
}

type PanelProps = React.ComponentProps<typeof HotspotPanel>;

const defaultProps: PanelProps = {
  hotspots: [],
  selectedId: null,
  brandCheckResults: [],
  isGenerating: false,
  generateError: null,
  isBrandChecking: false,
  brandCheckError: null,
  onUpdate: jest.fn(),
  onDelete: jest.fn(),
  onSelect: jest.fn(),
  onGenerateDescription: jest.fn(),
  onBrandCheckAll: jest.fn(),
};

function renderPanel(props: Partial<PanelProps> = {}) {
  return render(<HotspotPanel {...defaultProps} {...props} />);
}

// ── tests ────────────────────────────────────────────────────────────────────
describe("HotspotPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Empty state ────────────────────────────────────────────────────────────
  describe("empty state", () => {
    it("shows empty-state message when no hotspots", () => {
      renderPanel();
      expect(screen.getByText(/no hotspots yet/i)).toBeInTheDocument();
    });

    it("does not render the hotspot count badge when list is empty", () => {
      renderPanel();
      // The Hotspots tab badge only appears with hotspots.length > 0
      const tabTrigger = screen.getByRole("tab", { name: /hotspots/i });
      expect(tabTrigger).not.toHaveTextContent("0");
    });
  });

  // ── Hotspot list ───────────────────────────────────────────────────────────
  describe("hotspot list", () => {
    it("renders each hotspot label in the list", () => {
      const hotspots = [makeHotspot("hs_1"), makeHotspot("hs_2")];
      renderPanel({ hotspots });
      expect(screen.getByText("Label hs_1")).toBeInTheDocument();
      expect(screen.getByText("Label hs_2")).toBeInTheDocument();
    });

    it("shows badge with hotspot count", () => {
      const hotspots = [makeHotspot("hs_1"), makeHotspot("hs_2")];
      renderPanel({ hotspots });
      expect(screen.getByText("2")).toBeInTheDocument();
    });

    it("calls onSelect when a hotspot row is clicked", () => {
      const hotspots = [makeHotspot("hs_1")];
      renderPanel({ hotspots });
      fireEvent.click(screen.getByText("Label hs_1"));
      expect(defaultProps.onSelect).toHaveBeenCalledWith("hs_1");
    });

    it("calls onSelect(null) when the active hotspot is clicked again", () => {
      const hotspots = [makeHotspot("hs_1")];
      renderPanel({ hotspots, selectedId: "hs_1" });
      fireEvent.click(screen.getByText("Label hs_1"));
      expect(defaultProps.onSelect).toHaveBeenCalledWith(null);
    });

    it("calls onDelete when delete button is clicked and stops propagation", () => {
      const hotspots = [makeHotspot("hs_1")];
      renderPanel({ hotspots });
      const deleteBtn = screen.getByTitle("Delete hotspot");
      fireEvent.click(deleteBtn);
      expect(defaultProps.onDelete).toHaveBeenCalledWith("hs_1");
      // onSelect should NOT have been called (stopPropagation worked)
      expect(defaultProps.onSelect).not.toHaveBeenCalled();
    });

    it("shows brand score badge when brandCheckResults provided", () => {
      const hotspots = [makeHotspot("hs_1")];
      const brandCheckResults: BrandCheckResult[] = [
        { hotspotId: "hs_1", score: 85, issues: [], suggestions: [] },
      ];
      renderPanel({ hotspots, brandCheckResults });
      expect(screen.getByText("85")).toBeInTheDocument();
    });
  });

  // ── Editor panel (selected hotspot) ───────────────────────────────────────
  describe("editor panel", () => {
    it("shows editor when a hotspot is selected", () => {
      const hotspots = [makeHotspot("hs_1")];
      renderPanel({ hotspots, selectedId: "hs_1" });
      expect(screen.getByText("Edit Hotspot")).toBeInTheDocument();
    });

    it("does not show editor when no hotspot is selected", () => {
      const hotspots = [makeHotspot("hs_1")];
      renderPanel({ hotspots, selectedId: null });
      expect(screen.queryByText("Edit Hotspot")).not.toBeInTheDocument();
    });

    it("calls onUpdate when label input changes", () => {
      const hotspots = [makeHotspot("hs_1")];
      renderPanel({ hotspots, selectedId: "hs_1" });
      const labelInput = screen.getByLabelText("Label");
      fireEvent.change(labelInput, { target: { value: "New Label" } });
      expect(defaultProps.onUpdate).toHaveBeenCalledWith("hs_1", { label: "New Label" });
    });

    it("calls onUpdate when aria label input changes", () => {
      const hotspots = [makeHotspot("hs_1")];
      renderPanel({ hotspots, selectedId: "hs_1" });
      const ariaInput = screen.getByLabelText("Aria Label");
      fireEvent.change(ariaInput, { target: { value: "New Aria" } });
      expect(defaultProps.onUpdate).toHaveBeenCalledWith("hs_1", { ariaLabel: "New Aria" });
    });

    it("AI generate button calls onGenerateDescription", () => {
      const hotspots = [makeHotspot("hs_1", { label: "Hero" })];
      renderPanel({ hotspots, selectedId: "hs_1" });
      const aiBtn = screen.getByTitle("Generate description with AI");
      fireEvent.click(aiBtn);
      expect(defaultProps.onGenerateDescription).toHaveBeenCalledWith("hs_1");
    });

    it("AI generate button is disabled when label is empty", () => {
      const hotspots = [makeHotspot("hs_1", { label: "" })];
      renderPanel({ hotspots, selectedId: "hs_1" });
      const aiBtn = screen.getByTitle("Add a label first");
      expect(aiBtn).toBeDisabled();
    });

    it("AI generate button is disabled while generating", () => {
      const hotspots = [makeHotspot("hs_1", { label: "Hero" })];
      renderPanel({ hotspots, selectedId: "hs_1", isGenerating: true });
      const aiBtn = screen.getByRole("button", { name: /…/i });
      expect(aiBtn).toBeDisabled();
    });

    it("shows generateError below the description field", () => {
      const hotspots = [makeHotspot("hs_1")];
      renderPanel({ hotspots, selectedId: "hs_1", generateError: "AI unavailable" });
      expect(screen.getByText(/AI unavailable/)).toBeInTheDocument();
    });

    it("shows per-hotspot brand result when selectedBrand is available", () => {
      const hotspots = [makeHotspot("hs_1")];
      const brandCheckResults: BrandCheckResult[] = [
        {
          hotspotId: "hs_1",
          score: 45,
          issues: ["Missing aria-label"],
          suggestions: ["Add descriptive aria-label"],
        },
      ];
      renderPanel({ hotspots, selectedId: "hs_1", brandCheckResults });
      // "Brand Score" label only renders in the editor panel for the selected hotspot
      expect(screen.getByText("Brand Score")).toBeInTheDocument();
      // Issues/suggestions appear in both the editor panel and brand check tab (forceMount)
      expect(screen.getAllByText(/Missing aria-label/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Add descriptive aria-label/).length).toBeGreaterThan(0);
    });
  });

  // ── Brand Check tab ────────────────────────────────────────────────────────
  // Note: Radix UI tab content that is inactive has `hidden` attribute.
  // getByRole filters hidden elements by default, so we use { hidden: true }
  // for role queries. getByText searches all DOM nodes regardless of hidden.
  describe("Brand Check tab", () => {
    it("renders Run Brand Check button in brand tab content", () => {
      renderPanel();
      expect(
        screen.getByRole("button", { name: /run brand check/i, hidden: true })
      ).toBeInTheDocument();
    });

    it("Run Brand Check button is disabled when no hotspots", () => {
      renderPanel();
      expect(
        screen.getByRole("button", { name: /run brand check/i, hidden: true })
      ).toBeDisabled();
    });

    it("Run Brand Check button is enabled when hotspots exist", () => {
      const hotspots = [makeHotspot("hs_1")];
      renderPanel({ hotspots });
      expect(
        screen.getByRole("button", { name: /run brand check/i, hidden: true })
      ).not.toBeDisabled();
    });

    it("calls onBrandCheckAll when Run Brand Check is clicked", () => {
      const hotspots = [makeHotspot("hs_1")];
      renderPanel({ hotspots });
      fireEvent.click(
        screen.getByRole("button", { name: /run brand check/i, hidden: true })
      );
      expect(defaultProps.onBrandCheckAll).toHaveBeenCalledTimes(1);
    });

    it("shows brandCheckError when set", () => {
      renderPanel({ brandCheckError: "Brand check failed" });
      expect(screen.getByText(/brand check failed/i)).toBeInTheDocument();
    });

    it("renders all brand check result cards with scores", () => {
      const hotspots = [makeHotspot("hs_1"), makeHotspot("hs_2")];
      const brandCheckResults: BrandCheckResult[] = [
        { hotspotId: "hs_1", score: 90, issues: [], suggestions: [] },
        { hotspotId: "hs_2", score: 50, issues: ["Poor copy"], suggestions: [] },
      ];
      renderPanel({ hotspots, brandCheckResults });
      // Scores only appear in the brand results, not in the hotspot list
      expect(screen.getByText("90/100")).toBeInTheDocument();
      expect(screen.getByText("50/100")).toBeInTheDocument();
      expect(screen.getByText(/Poor copy/)).toBeInTheDocument();
    });

    it("clicking a brand result card calls onSelect with the hotspot id", () => {
      const hotspots = [makeHotspot("hs_1")];
      const brandCheckResults: BrandCheckResult[] = [
        { hotspotId: "hs_1", score: 75, issues: [], suggestions: [] },
      ];
      renderPanel({ hotspots, brandCheckResults });
      // "75/100" only exists in the brand results list
      const scoreEl = screen.getByText("75/100");
      fireEvent.click(scoreEl.closest("[class*='cursor-pointer']")!);
      expect(defaultProps.onSelect).toHaveBeenCalledWith("hs_1");
    });
  });
});
