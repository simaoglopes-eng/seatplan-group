import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "../../api/eventsPublic";

const api = {
  getEventTypes: vi.fn(),
  getPublicEvents: vi.fn(),
  getEventVenues: vi.fn(),
};
vi.mock("../../api/eventsPublic", () => ({
  getEventTypes: () => api.getEventTypes(),
  getPublicEvents: (q: unknown) => api.getPublicEvents(q),
  getEventVenues: (t: unknown) => api.getEventVenues(t),
}));

import EventsPage from "./EventsPage";

const event: PublicEvent = {
  public_id: "e1", name: "Summer wedding", event_type: "wedding", event_type_label: "Wedding",
  starts_at: "2027-06-12T15:00:00Z", ends_at: "2027-06-12T23:00:00Z",
  venue: { name: "Quinta Demo", slug: "quinta-demo", venue_type: "quinta", address: "Sintra", cover_url: null },
  places_left: 10, join_path: "/j/abc",
};

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/events"]}>
      <EventsPage />
    </MemoryRouter>,
  );
}

function stub(items: PublicEvent[]) {
  api.getEventTypes.mockResolvedValue([{ key: "wedding", label: "Wedding" }]);
  api.getPublicEvents.mockResolvedValue({ items, total: items.length });
  api.getEventVenues.mockResolvedValue({ items: [] });
}

afterEach(() => Object.values(api).forEach((fn) => fn.mockReset()));

describe("EventsPage create-your-own block", () => {
  it("sits under the list of events and opens a new event in the organiser", async () => {
    stub([event]);
    renderPage();
    expect(await screen.findByText("Summer wedding")).toBeTruthy();
    // The header has its own "Create your own event" button; this is the block under the list.
    const blocks = screen.getAllByRole("complementary", { name: /Can't find your venue\?/ });
    expect(blocks).toHaveLength(1);
    expect(within(blocks[0]).getByText(/Create your own event at any place, even one that is not listed\./)).toBeTruthy();
    expect(within(blocks[0]).getByRole("link", { name: "Create your own event" }).getAttribute("href")).toBe("/organiser?new=1");
    expect(blocks[0].closest("section")?.getAttribute("aria-label")).toBe("Upcoming events");
  });

  it("is offered in the empty state as well", async () => {
    stub([]);
    renderPage();
    expect(await screen.findByText("No upcoming events")).toBeTruthy();
    const block = screen.getByRole("complementary", { name: /Can't find your venue\?/ });
    expect(within(block).getByRole("link", { name: "Create your own event" }).getAttribute("href")).toBe("/organiser?new=1");
  });
});
