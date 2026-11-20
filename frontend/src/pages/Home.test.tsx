import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "./Home";

const VENUES = [
  { slug: "q1", name: "Quinta Um", venue_type: "quinta", venue_type_label: "Quinta", description: "", address: "Rua 1, Sintra", lat: null, lng: null, cover_url: null, cover_alt: null, capacity: 80, event_types: ["wedding"], upcoming_count: 1 },
  { slug: "h1", name: "Hall Um", venue_type: "hall", venue_type_label: "Event hall", description: "", address: "Rua 2, Lisboa", lat: null, lng: null, cover_url: null, cover_alt: null, capacity: 144, event_types: ["conference"], upcoming_count: 0 },
  { slug: "h2", name: "Hall Dois", venue_type: "hall", venue_type_label: "Event hall", description: "", address: "Rua 3, Porto", lat: null, lng: null, cover_url: null, cover_alt: null, capacity: 48, event_types: ["gala_dinner"], upcoming_count: 0 },
];
const TYPES = [{ key: "wedding", label: "Wedding" }, { key: "conference", label: "Conference" }];

function stub(venues: unknown[] | "fail" = VENUES) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/event-venues")) return venues === "fail" ? new Response(JSON.stringify({ code: "server_error", message: "Down" }), { status: 500 }) : new Response(JSON.stringify({ items: venues }), { status: 200 });
    if (url.includes("/event-types")) return new Response(JSON.stringify(TYPES), { status: 200 });
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
  }));
}

afterEach(() => vi.unstubAllGlobals());

const renderHome = () => render(<MemoryRouter><Home /></MemoryRouter>);

describe("Home", () => {
  it("sends organisers, guests and staff to real pages", async () => {
    stub();
    renderHome();
    expect(screen.getByRole("heading", { level: 1, name: "Find the room. Seat every guest." })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Plan an event" }).getAttribute("href")).toBe("/organiser/register");
    expect(screen.getByRole("link", { name: "I have an invitation" }).getAttribute("href")).toBe("/participant");
    expect(screen.getByRole("link", { name: "Open the staff area" }).getAttribute("href")).toBe("/events/staff");
    const wedding = await screen.findByRole("link", { name: /^Wedding/ });
    expect(wedding.getAttribute("href")).toBe("/events?type=wedding");
    expect(await within(wedding).findByText("None open now")).toBeTruthy();
  });

  it("filters venues by kind and size, and See all keeps the same filter", async () => {
    stub();
    renderHome();
    await screen.findByText("Quinta Um");
    const conference = screen.getByRole("button", { name: /Conference rooms/ });
    expect(within(conference).getByText("1 venue")).toBeTruthy();
    fireEvent.click(conference);
    expect(conference.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("Quinta Um")).toBeNull();
    expect(screen.getByText("Hall Um")).toBeTruthy();
    expect(screen.getByRole("link", { name: /See all 1 conference rooms/ }).getAttribute("href")).toBe("/venues?occasion=conference");
    fireEvent.click(conference);
    fireEvent.change(screen.getByLabelText("Guests"), { target: { value: "100" } });
    expect(screen.queryByText("Hall Dois")).toBeNull();
    expect(screen.getByRole("link", { name: /See all 1 venue for 100 guests or more/ }).getAttribute("href")).toBe("/venues?guests=100");
  });

  it("still offers a way in when no venue is published or the list fails", async () => {
    stub([]);
    const first = renderHome();
    expect(await screen.findByText("No venues published yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add your venue" }).getAttribute("href")).toBe("/organiser/register");
    first.unmount();
    stub("fail");
    renderHome();
    expect(await screen.findByRole("button", { name: /try again/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Plan an event" })).toBeTruthy();
  });
});
