import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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
    { country: "IT", kind: "estate", count: 1178 },
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
    if (url.includes("/venue-directory/counts")) {
      if (mode === "fail") return json({ code: "server_error", message: "Down" }, 500);
      return json(mode === "empty" ? { ...COUNTS, items: [] } : COUNTS);
    }
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

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}
const renderHome = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/directory" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

describe("Home", () => {
  it("opens on the hero with the live venue total and real ways in", async () => {
    stub();
    renderHome();
    expect(screen.getByRole("heading", { level: 1, name: "Venues for events that matter." })).toBeTruthy();
    expect(screen.getByText("Portugal · Belgium · Italy")).toBeTruthy();
    expect(screen.queryByText(/Quintas · Event halls · Conference rooms/)).toBeNull();
    // Live total from the counts endpoint, formatted the same everywhere.
    expect(await screen.findByText(/^1,287 quintas, halls and conference centres\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Find a venue" }).getAttribute("href")).toBe("/directory");
    expect(screen.getByRole("link", { name: "I have an invitation" }).getAttribute("href")).toBe("/participant");
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    // The hero photo carries a real description; the room tiles repeat their text, so theirs are decorative.
    expect(screen.getByRole("img", { name: /cinema hall/ }).getAttribute("loading")).toBeNull();
  });

  it("searches the directory with the chosen country and kind", async () => {
    stub();
    renderHome();
    const search = screen.getByRole("search", { name: "Find a venue" });
    expect(await within(search).findByRole("button", { name: "Search 1,287 venues" })).toBeTruthy();
    fireEvent.change(within(search).getByLabelText("Country"), { target: { value: "PT" } });
    // The kind list counts what is in the chosen country.
    expect(within(search).getByRole("option", { name: "Quintas and estates (92)" })).toBeTruthy();
    fireEvent.change(within(search).getByLabelText("Kind of venue"), { target: { value: "estate" } });
    const submit = within(search).getByRole("button", { name: "Search 92 venues" });
    fireEvent.click(submit);
    expect(screen.getByTestId("where").textContent).toBe("/directory?country=PT&kind=estate");
  });

  it("searches everything when nothing is chosen, and still works without counts", async () => {
    stub("fail");
    renderHome();
    const search = screen.getByRole("search", { name: "Find a venue" });
    // No number while the counts are missing: never "0" or "NaN".
    await waitFor(() => expect(calls.some((u) => u.includes("/venue-directory/counts"))).toBe(true));
    expect(within(search).getByRole("button", { name: "Search venues" })).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getByText(/^Quintas, halls and conference centres\./)).toBeTruthy();
    fireEvent.click(within(search).getByRole("button", { name: "Search venues" }));
    expect(screen.getByTestId("where").textContent).toBe("/directory");
  });

  it("links each room tile to the directory filtered by its kind, with live counts", async () => {
    stub();
    renderHome();
    const rooms = screen.getByRole("region", { name: "Three kinds of room, one way to seat it." });
    const estate = await within(rooms).findByRole("link", { name: /1,270 venues.*Quintas and estates/ });
    expect(estate.getAttribute("href")).toBe("/directory?kind=estate");
    expect(within(rooms).getByRole("link", { name: /Event halls/ }).getAttribute("href")).toBe("/directory?kind=hall");
    expect(within(rooms).getByRole("link", { name: /Conference centres/ }).getAttribute("href")).toBe("/directory?kind=conference");
    for (const img of within(rooms).getAllByRole("presentation")) {
      expect(img.getAttribute("alt")).toBe("");
      expect(img.getAttribute("loading")).toBe("lazy");
    }
  });

  it("shows three real venues, as in the mock, and See all opens the whole directory", async () => {
    stub();
    renderHome();
    const listing = screen.getByRole("region", { name: "Start with a room you can visit." });
    await within(listing).findByText("Villa Sole");
    // Three cards, no country chips (the search bar above already filters by country).
    expect(within(listing).getAllByRole("article")).toHaveLength(3);
    expect(within(listing).queryByRole("button", { name: /Portugal/ })).toBeNull();
    expect(calls.some((u) => u.includes("/venue-directory?") && u.includes("limit=3"))).toBe(true);
    expect(within(listing).getByRole("link", { name: /See all 3 venues/ }).getAttribute("href")).toBe("/directory");
    expect(within(listing).getByRole("link", { name: /Plan an event here: Quinta da Lua/ }).getAttribute("href")).toBe("/organiser?at=w1");
    expect(within(listing).getByRole("link", { name: /OpenStreetMap contributors/ })).toBeTruthy();
  });

  it("puts the credited Palazzo Vecchio photo in the organisers band, next to the way to plan", () => {
    stub();
    renderHome();
    const band = screen.getByRole("region", { name: "Every guest, in the right seat." });
    expect(within(band).getByRole("img", { name: /Palazzo Vecchio/ }).getAttribute("src")).toBe("/images/photos/palazzo-hall.jpg");
    // The interactive sample room lives on /demo now, not on the front door.
    expect(within(band).queryByRole("listbox")).toBeNull();
    expect(within(band).getByRole("list").querySelectorAll("li")).toHaveLength(3);
    expect(within(band).getByRole("link", { name: "Plan an event" }).getAttribute("href")).toBe("/organiser/register");
  });

  it("follows the mock's order and keeps events, demo rooms, staff and credits one click away", () => {
    stub();
    renderHome();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Three kinds of room, one way to seat it.", "Start with a room you can visit.", "Every guest, in the right seat."]);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Demo rooms" }).getAttribute("href")).toBe("/venues");
    expect(within(footer).getByRole("link", { name: "Live demo" }).getAttribute("href")).toBe("/demo");
    expect(within(footer).getByRole("link", { name: "Staff area" }).getAttribute("href")).toBe("/events/staff");
    expect(within(footer).getByRole("link", { name: "Photo credits" }).getAttribute("href")).toBe("/credits");
    expect(within(footer).getByRole("link", { name: /OpenStreetMap contributors/ }).getAttribute("href")).toBe("https://www.openstreetmap.org/copyright");
    expect(screen.getByRole("navigation", { name: "Main" }).querySelector('a[href="/events"]')).toBeTruthy();
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
    expect(screen.getByRole("link", { name: "Find a venue" })).toBeTruthy();
  });
});
