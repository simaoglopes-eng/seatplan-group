import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Listing } from "../../api/venueDirectory";

const getDirectory = vi.fn();
vi.mock("../../api/venueDirectory", () => ({ getDirectory: (...args: unknown[]) => getDirectory(...args) }));

import DirectoryPage from "./DirectoryPage";

const listing = (id: string, name: string, kind: Listing["kind"]): Listing => ({
  id, name, kind, kind_label: kind, country: "IT", country_label: "Italy", city: "Roma", city_inferred: false,
  street: null, postcode: null, lat: 0, lng: 0, website: null, source_url: `https://www.openstreetmap.org/way/${id.slice(1)}`,
});

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <DirectoryPage />
    </MemoryRouter>,
  );
}

afterEach(() => getDirectory.mockReset());

describe("DirectoryPage", () => {
  it("shows a photo on every card and the create-your-own block after the grid", async () => {
    getDirectory.mockResolvedValue({ items: [listing("w43664624", "Roma Convention Center La Nuvola", "conference"), listing("w5550001", "Sala Uno", "hall")], total: 2, attribution: "" });
    renderAt("/directory");
    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(2);
    for (const card of cards) expect(card.querySelector(".dir-card-photo img")).not.toBeNull();
    expect(within(cards[0]).queryByText("Illustrative photo")).toBeNull();
    expect(within(cards[1]).getByText("Illustrative photo")).toBeTruthy();

    // The header has its own "Create your own event" button; this is the block in the page.
    const blocks = screen.getAllByRole("complementary", { name: /Can't find your venue\?/ });
    expect(blocks).toHaveLength(1);
    expect(within(blocks[0]).getByText(/Create your own event at any place, even one that is not listed\./)).toBeTruthy();
    const link = within(blocks[0]).getByRole("link", { name: "Create your own event" });
    expect(link.getAttribute("href")).toBe("/organiser?new=1");
    // After the grid, not before it.
    const grid = document.querySelector(".dir-grid");
    expect(grid).not.toBeNull();
    expect(grid!.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers to create your own event in the empty state too", async () => {
    getDirectory.mockResolvedValue({ items: [], total: 0, attribution: "" });
    renderAt("/directory?q=nowhere");
    expect(await screen.findByText("No venue matches")).toBeTruthy();
    const block = screen.getByRole("complementary", { name: /Can't find your venue\?/ });
    expect(within(block).getByRole("link", { name: "Create your own event" }).getAttribute("href")).toBe("/organiser?new=1");
  });
});
