import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "./Home";

const DEMO = [
  { slug: "q1", name: "Quinta Um", venue_type: "quinta", venue_type_label: "Quinta", description: "", address: "Rua 1, Sintra", lat: null, lng: null, cover_url: null, cover_alt: null, capacity: 80, event_types: ["wedding"], upcoming_count: 1, is_demo: true },
];
const TYPES = [{ key: "wedding", label: "Wedding" }, { key: "conference", label: "Conference" }];
const COUNTS = {
  items: [
    { country: "PT", kind: "estate", count: 92 },
    { country: "PT", kind: "conference", count: 17 },
    { country: "IT", kind: "estate", count: 178 },
  ],
  countries: [], kinds: [], attribution: "© OpenStreetMap contributors",
};
const listing = (id: string, name: string, country: string, kind: string) => ({ id, name, kind, kind_label: kind === "estate" ? "Quinta or estate" : "Conference centre", country, country_label: country === "PT" ? "Portugal" : "Italy", city: "Sintra", city_inferred: true, street: null, postcode: null, lat: 0, lng: 0, website: "https://example.org", source_url: "https://www.openstreetmap.org/way/1" });

type Mode = "ok" | "empty" | "fail";
const calls: string[] = [];
function stub(mode: Mode = "ok") {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.includes("/venue-directory/counts")) return json(mode === "empty" ? { ...COUNTS, items: [] } : COUNTS);
    if (url.includes("/venue-directory")) {
      if (mode === "fail") return json({ code: "server_error", message: "Down" }, 500);
      if (mode === "empty") return json({ items: [], total: 0, attribution: "" });
      const q = new URL(url, "http://x").searchParams;
      const all = [listing("w1", "Quinta da Lua", "PT", "estate"), listing("w2", "Centro de Congressos", "PT", "conference"), listing("w3", "Villa Sole", "IT", "estate")];
      const items = all.filter((l) => (!q.get("country") || l.country === q.get("country")) && (!q.get("kind") || l.kind === q.get("kind")));
      return json({ items, total: items.length, attribution: "" });
    }
    if (url.includes("/event-venues")) return json({ items: DEMO });
    if (url.includes("/event-types")) return json(TYPES);
    return json({ items: [], total: 0 });
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
    expect((await screen.findByRole("link", { name: /All 1 demo rooms/ })).getAttribute("href")).toBe("/venues");
    expect(screen.getByText("Demo venue · Quinta · Sintra")).toBeTruthy();
  });

  it("filters real venues by country and kind on the server, and See all keeps the filter", async () => {
    stub();
    renderHome();
    await screen.findByText("Villa Sole");
    expect(screen.getByRole("button", { name: /Portugal · 109/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Portugal/ }));
    const estates = screen.getByRole("button", { name: /Quintas and estates/ });
    expect(within(estates).getByText("92 in Portugal")).toBeTruthy();
    fireEvent.click(estates);
    await waitFor(() => expect(screen.queryByText("Villa Sole")).toBeNull());
    expect(screen.queryByText("Centro de Congressos")).toBeNull();
    expect(calls.some((u) => u.includes("country=PT") && u.includes("kind=estate"))).toBe(true);
    expect(screen.getByRole("link", { name: /See all 1 quintas and estates in Portugal/ }).getAttribute("href")).toBe("/directory?country=PT&kind=estate");
    expect(screen.getByRole("link", { name: /Plan an event here: Quinta da Lua/ }).getAttribute("href")).toBe("/organiser?at=w1");
    expect(screen.getByRole("link", { name: /OpenStreetMap contributors/ })).toBeTruthy();
  });

  it("still offers a way in when nothing is listed or the list fails", async () => {
    stub("empty");
    const first = renderHome();
    expect(await screen.findByText("No venues listed here yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add your venue" }).getAttribute("href")).toBe("/organiser/register");
    first.unmount();
    stub("fail");
    renderHome();
    expect(await screen.findByRole("button", { name: /try again/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Plan an event" })).toBeTruthy();
  });
});
