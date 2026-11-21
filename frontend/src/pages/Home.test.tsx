import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FEATURED_VENUES, VENUE_PHOTOS } from "../data/venuePhotos";
import Home from "./Home";

const COUNTS = {
  items: [
    { country: "PT", kind: "estate", count: 92 },
    { country: "PT", kind: "conference", count: 17 },
    { country: "IT", kind: "estate", count: 1178 },
  ],
  countries: [], kinds: [], attribution: "© OpenStreetMap contributors",
};
const NAMES: Record<string, string> = {
  r5424595: "Palácio da Bolsa",
  w142509065: "Kasteel van Groenenberg",
  r10379191: "Villa Andrea Ponti",
  r10794433: "Convento de São Francisco",
  w144502504: "Square Brussels Convention Centre",
  w43664624: "Roma Convention Center La Nuvola",
};
const listing = (id: string) => ({
  id, name: NAMES[id], kind: "conference", kind_label: "Conference centre", country: "PT", country_label: "Portugal",
  city: "Porto", city_inferred: false, street: null, postcode: null, lat: 0, lng: 0,
  // Every other venue has no website, so its card links to the map instead.
  website: id.startsWith("r") ? "https://example.org" : null, source_url: `https://www.openstreetmap.org/x/${id}`,
});

type Mode = "ok" | "fail";
const calls: string[] = [];
/** `missing`: listing ids that answer 404, as if they had left the directory. */
function stub(mode: Mode = "ok", missing: string[] = []) {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.includes("/venue-directory/counts")) {
      if (mode === "fail") return json({ code: "server_error", message: "Down" }, 500);
      return json(COUNTS);
    }
    const one = /\/venue-directory\/([^/?]+)$/.exec(url);
    if (one) {
      const id = decodeURIComponent(one[1]);
      if (mode === "fail" || missing.includes(id) || !NAMES[id]) return json({ code: "not_found", message: "Gone" }, 404);
      return json(listing(id));
    }
    return json({ items: [], total: 0 });
  }));
}

function motion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // Back to jsdom's own getter (the slide test shadows it on the instance).
  delete (document as { visibilityState?: unknown }).visibilityState;
});

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
        <Route path="/participant" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

describe("Home", () => {
  it("opens on the dinner hero with two glass choice cards and decorative slides", async () => {
    stub();
    renderHome();
    expect(screen.getByRole("heading", { level: 1, name: "Long tables, good company, everyone seated." })).toBeTruthy();
    expect(screen.getByText("Dinners · Conferences · Parties")).toBeTruthy();
    expect(screen.getByText("Seat plans for events of every size, up to 800 guests. Tell us who you are.")).toBeTruthy();
    const hero = screen.getByRole("region", { name: "Long tables, good company, everyone seated." });
    // Three dinner slides: decorative (empty alt), sized, only the first one loads eagerly.
    const slides = hero.querySelectorAll(".ld-slides img");
    expect(Array.from(slides).map((img) => img.getAttribute("src"))).toEqual([
      "/images/photos/hero-terrace-assisi.jpg",
      "/images/photos/hero-dinner-giant.jpg",
      "/images/photos/hero-dining-hall.jpg",
    ]);
    slides.forEach((img, i) => {
      expect(img.getAttribute("alt")).toBe("");
      expect(img.getAttribute("width")).toBeTruthy();
      expect(img.getAttribute("loading")).toBe(i === 0 ? null : "lazy");
    });
    // The organiser card: create, then browse with the live total.
    const organiser = within(hero).getByRole("region", { name: "Plan an event" });
    expect(organiser.classList.contains("glass-panel")).toBe(true);
    expect(within(organiser).getByText("I am organising")).toBeTruthy();
    const create = within(organiser).getByRole("link", { name: "Create your own event" });
    expect(create.getAttribute("href")).toBe("/organiser?new=1");
    expect(create.classList.contains("btn-glass-green")).toBe(true);
    const browse = await within(organiser).findByRole("link", { name: "or browse 1,287 venues" });
    expect(browse.getAttribute("href")).toBe("/directory");
    // The guest card: a form with the invitation code and a brass glass button.
    const guest = within(hero).getByRole("form", { name: "Find my seat" });
    expect(guest.classList.contains("glass-panel")).toBe(true);
    expect(within(guest).getByText("I am a guest")).toBeTruthy();
    expect(within(guest).getByLabelText("Invitation code").getAttribute("placeholder")).toBe("e.g. 7KQ-24M");
    expect(within(guest).getByRole("button", { name: "Open my invitation" }).classList.contains("btn-glass-brass")).toBe(true);
    // The venue search left the hero for the rooms block; no wedding copy up here.
    expect(within(hero).queryByRole("search")).toBeNull();
    expect(hero.textContent).not.toMatch(/wedding/i);
  });

  it("opens the guest's invitation on /participant with the code typed in", () => {
    stub();
    renderHome();
    const guest = screen.getByRole("form", { name: "Find my seat" });
    fireEvent.change(within(guest).getByLabelText("Invitation code"), { target: { value: "  7KQ-24M  " } });
    fireEvent.click(within(guest).getByRole("button", { name: "Open my invitation" }));
    expect(screen.getByTestId("where").textContent).toBe("/participant?code=7KQ-24M");
  });

  it("encodes a pasted invitation link in the query", () => {
    stub();
    renderHome();
    const guest = screen.getByRole("form", { name: "Find my seat" });
    fireEvent.change(within(guest).getByLabelText("Invitation code"), { target: { value: "http://localhost/j/abc?x=1&y=2" } });
    fireEvent.submit(guest);
    expect(screen.getByTestId("where").textContent).toBe("/participant?code=http%3A%2F%2Flocalhost%2Fj%2Fabc%3Fx%3D1%26y%3D2");
  });

  it("opens /participant without a code when the field is empty (phones hide it)", () => {
    stub();
    renderHome();
    fireEvent.click(within(screen.getByRole("form", { name: "Find my seat" })).getByRole("button", { name: "Open my invitation" }));
    expect(screen.getByTestId("where").textContent).toBe("/participant");
  });

  it("puts the venue search in the header of the rooms block", () => {
    stub();
    renderHome();
    const rooms = screen.getByRole("region", { name: "Three kinds of room, one way to seat it." });
    const search = within(rooms).getByRole("search", { name: "Find a venue" });
    expect(rooms.querySelector(".ld-head")?.contains(search)).toBe(true);
    expect(within(search).queryByLabelText(/guests/i)).toBeNull();
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
    fireEvent.click(within(search).getByRole("button", { name: "Search 92 venues" }));
    expect(screen.getByTestId("where").textContent).toBe("/directory?country=PT&kind=estate");
  });

  it("searches everything without counts, and never shows 0 or NaN", async () => {
    stub("fail");
    renderHome();
    const search = screen.getByRole("search", { name: "Find a venue" });
    await waitFor(() => expect(calls.some((u) => u.includes("/venue-directory/counts"))).toBe(true));
    expect(within(search).getByRole("button", { name: "Search venues" })).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.queryByText(/\b0 venues/)).toBeNull();
    expect(screen.getByRole("link", { name: "or browse the venues" }).getAttribute("href")).toBe("/directory");
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
  });

  it("shows three real venues of the right kind in each room tile, named in the corner", () => {
    stub();
    renderHome();
    const rooms = screen.getByRole("region", { name: "Three kinds of room, one way to seat it." });
    const expected: Record<string, { files: string[]; first: string }> = {
      "/directory?kind=estate": {
        files: ["way-542292860.jpg", "node-3942508757.jpg", "way-212650231.jpg"],
        first: "Villa delle Ginestre, Italy",
      },
      "/directory?kind=hall": {
        // Nekkerhal, not the park gate of Kasteeldomein Hof ter Linden, under "event halls".
        files: ["way-93159180.jpg", "way-23041580.jpg", "way-111347385.jpg"],
        first: "Dogana Veneta, Italy",
      },
      "/directory?kind=conference": {
        files: ["way-43664624.jpg", "way-200415692.jpg", "relation-5424595.jpg"],
        first: "Roma Convention Center La Nuvola, Italy",
      },
    };
    const tiles = rooms.querySelectorAll<HTMLAnchorElement>("a.ld-tile");
    expect(tiles).toHaveLength(3);
    tiles.forEach((tile) => {
      // The caption is a glass panel over the photos.
      expect(tile.querySelector(".ld-tile-text")?.classList.contains("glass-panel")).toBe(true);
      const want = expected[tile.getAttribute("href") ?? ""];
      expect(want).toBeTruthy();
      const imgs = Array.from(tile.querySelectorAll("img"));
      expect(imgs.map((img) => img.getAttribute("src"))).toEqual(want.files.map((f) => `/images/venues/${f}`));
      imgs.forEach((img, i) => {
        // Decorative (the tile names its kind), lazy, and only the first one on show.
        expect(img.getAttribute("alt")).toBe("");
        expect(img.getAttribute("loading")).toBe("lazy");
        expect(img.classList.contains("is-on")).toBe(i === 0);
      });
      expect(tile.querySelector(".ld-tile-venue")?.textContent).toBe(want.first);
      // The caption changes with the photo, so it stays out of the link's name.
      expect(tile.querySelector(".ld-tile-venue")?.getAttribute("aria-hidden")).toBe("true");
    });
  });

  it("moves each tile to its next venue every 5 s, a third of that apart from its neighbour", () => {
    motion(false);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    stub();
    renderHome();
    const rooms = screen.getByRole("region", { name: "Three kinds of room, one way to seat it." });
    const onIndex = () =>
      Array.from(rooms.querySelectorAll("a.ld-tile")).map((tile) => Array.from(tile.querySelectorAll("img")).findIndex((img) => img.classList.contains("is-on")));
    expect(onIndex()).toEqual([0, 0, 0]);
    act(() => {
      vi.advanceTimersByTime(1667);
    });
    expect(onIndex()).toEqual([1, 0, 0]);
    act(() => {
      vi.advanceTimersByTime(1667);
    });
    expect(onIndex()).toEqual([1, 1, 0]);
    act(() => {
      vi.advanceTimersByTime(1667);
    });
    expect(onIndex()).toEqual([1, 1, 1]);
    act(() => {
      vi.advanceTimersByTime(5001);
    });
    expect(onIndex()).toEqual([2, 2, 2]);
    expect(rooms.querySelector(".ld-tile-venue")?.textContent).toBe("Castello dei Solaro, Italy");
  });

  it("offers 'Create your own event' in the hero, the header and the organisers band, all to the new-event form", () => {
    stub();
    renderHome();
    const hero = screen.getByRole("region", { name: "Long tables, good company, everyone seated." });
    expect(within(hero).getByRole("link", { name: "Create your own event" }).getAttribute("href")).toBe("/organiser?new=1");
    const header = screen.getByRole("navigation", { name: "Main" });
    const inMenu = within(header).getByRole("link", { name: "Create your own event" });
    expect(inMenu.getAttribute("href")).toBe("/organiser?new=1");
    // Inside the menu panel, so a phone reaches it from Menu too.
    expect(inMenu.closest("#site-nav-links")).toBeTruthy();
    const band = screen.getByRole("region", { name: "Every guest, in the right seat." });
    expect(within(band).getByRole("link", { name: "Create your own event" }).getAttribute("href")).toBe("/organiser?new=1");
  });

  it("shows the featured venues that load, each with its own photo, and skips the ones that fail", async () => {
    stub("ok", ["w142509065"]);
    renderHome();
    const strip = screen.getByRole("region", { name: "Start with a room you can visit." });
    await within(strip).findByText("Roma Convention Center La Nuvola");
    const cards = within(strip).getAllByRole("article");
    // Five of six answered; the order of FEATURED_VENUES is kept.
    const shown = FEATURED_VENUES.filter((id) => id !== "w142509065");
    expect(cards).toHaveLength(shown.length);
    expect(within(strip).queryByText("Kasteel van Groenenberg")).toBeNull();
    cards.forEach((card, i) => {
      const id = shown[i];
      expect(within(card).getByRole("heading", { level: 3 }).textContent).toBe(NAMES[id]);
      const img = within(card).getByRole("img");
      expect(img.getAttribute("src")).toBe(VENUE_PHOTOS[id].src);
      expect(img.getAttribute("alt")).toBe(VENUE_PHOTOS[id].alt);
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(within(card).getByText("Conference centre · Portugal")).toBeTruthy();
      expect(within(card).getByText("Porto, Portugal")).toBeTruthy();
      const plan = within(card).getByRole("link", { name: `Plan an event here: ${NAMES[id]}` });
      expect(plan.getAttribute("href")).toBe(`/organiser?at=${id}`);
      // On the photo, so it is a glass button there.
      expect(plan.closest(".ld-card-photo")).toBeTruthy();
      expect(plan.classList.contains("btn-glass-green")).toBe(true);
      const out = within(card).getByRole("link", { name: id.startsWith("r") ? /^Website/ : /^Map/ });
      expect(out.getAttribute("href")).toBe(id.startsWith("r") ? "https://example.org" : `https://www.openstreetmap.org/x/${id}`);
      expect(out.getAttribute("target")).toBe("_blank");
      expect(out.getAttribute("rel")).toBe("noopener noreferrer");
    });
    expect(within(strip).getByRole("link", { name: /See all 1,287 venues/ }).getAttribute("href")).toBe("/directory");
  });

  it("disables the strip arrows at either end", async () => {
    stub();
    renderHome();
    const strip = screen.getByRole("region", { name: "Start with a room you can visit." });
    const list = await within(strip).findByRole("list", { name: "Featured venues" });
    const prev = within(strip).getByRole("button", { name: "Previous venues" }) as HTMLButtonElement;
    const next = within(strip).getByRole("button", { name: "Next venues" }) as HTMLButtonElement;
    Object.defineProperty(list, "scrollWidth", { configurable: true, value: 1200 });
    Object.defineProperty(list, "clientWidth", { configurable: true, value: 400 });
    list.scrollLeft = 0;
    fireEvent.scroll(list);
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    list.scrollLeft = 400;
    fireEvent.scroll(list);
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
    list.scrollLeft = 800;
    fireEvent.scroll(list);
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(true);
  });

  it("says so, with a way on, when no featured venue loads", async () => {
    stub("fail");
    renderHome();
    const strip = screen.getByRole("region", { name: "Start with a room you can visit." });
    expect(await within(strip).findByText(/could not be loaded/)).toBeTruthy();
    expect(within(strip).queryByRole("article")).toBeNull();
    expect(within(strip).queryByRole("button", { name: "Next venues" })).toBeNull();
    expect(within(strip).getByRole("link", { name: "See all venues" }).getAttribute("href")).toBe("/directory");
  });

  it("changes slide every 6.5 s, and a dot picks one", async () => {
    motion(false);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    stub();
    renderHome();
    const dots = within(screen.getByRole("group", { name: "Background photos" })).getAllByRole("button");
    expect(dots.map((d) => d.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    act(() => {
      vi.advanceTimersByTime(6500);
    });
    expect(dots.map((d) => d.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    fireEvent.click(dots[2]);
    expect(dots[2].getAttribute("aria-pressed")).toBe("true");
    // A pause while the tab is hidden.
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(dots[2].getAttribute("aria-pressed")).toBe("true");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    fireEvent(document, new Event("visibilitychange"));
    act(() => {
      vi.advanceTimersByTime(6500);
    });
    expect(dots[0].getAttribute("aria-pressed")).toBe("true");
    await screen.findByText("Roma Convention Center La Nuvola");
  });

  it("keeps the first slide still under reduced motion", async () => {
    motion(true);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    stub();
    renderHome();
    const dots = within(screen.getByRole("group", { name: "Background photos" })).getAllByRole("button");
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(dots.map((d) => d.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    expect(vi.getTimerCount()).toBe(0);
    await screen.findByText("Roma Convention Center La Nuvola");
  });

  it("lays the organisers band over the credited Palazzo Vecchio photo, its copy on glass", () => {
    stub();
    renderHome();
    const band = screen.getByRole("region", { name: "Every guest, in the right seat." });
    expect(band.classList.contains("photo-band")).toBe(true);
    const photo = within(band).getByRole("img", { name: /Palazzo Vecchio/ });
    expect(photo.getAttribute("src")).toBe("/images/photos/palazzo-hall.jpg");
    expect(photo.closest(".photo-band-photo")).toBeTruthy();
    // The heading, the steps and the button sit in one glass panel.
    const panel = band.querySelector(".glass-panel");
    expect(panel?.contains(within(band).getByRole("heading", { level: 2 }))).toBe(true);
    expect(within(band).getByRole("link", { name: "Create your own event" }).classList.contains("btn-glass-green")).toBe(true);
    expect(within(band).getByRole("list").querySelectorAll("li")).toHaveLength(3);
    expect(within(band).getByRole("link", { name: "Create your own event" }).getAttribute("href")).toBe("/organiser?new=1");
  });

  it("lets the visitor try the sample seat map, with the way to the live demo", () => {
    stub();
    renderHome();
    const tryIt = screen.getByRole("region", { name: "Try choosing a seat." });
    expect(within(tryIt).getByRole("listbox", { name: "Sample seat map, try choosing a seat" })).toBeTruthy();
    expect(within(tryIt).getByText("No seat chosen yet.")).toBeTruthy();
    expect(within(tryIt).getByRole("link", { name: "Open the live demo" }).getAttribute("href")).toBe("/demo");
    expect(within(tryIt).getByRole("link", { name: "I have an invitation" }).getAttribute("href")).toBe("/participant");
  });

  it("follows the mock's order and keeps events, demo rooms, staff and credits one click away", () => {
    stub();
    renderHome();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Plan an event", "Find my seat", "Three kinds of room, one way to seat it.", "Try choosing a seat.", "Start with a room you can visit.", "Every guest, in the right seat."]);
    // The header carries Federico's mark beside the name, and the glass "Sign in".
    const brand = screen.getByRole("link", { name: "SeatPlan, home" });
    expect(brand.querySelector("svg.wordmark-mark")).toBeTruthy();
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/account");
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Demo rooms" }).getAttribute("href")).toBe("/venues");
    expect(within(footer).getByRole("link", { name: "Live demo" }).getAttribute("href")).toBe("/demo");
    expect(within(footer).getByRole("link", { name: "Staff area" }).getAttribute("href")).toBe("/events/staff");
    expect(within(footer).getByRole("link", { name: "Photo credits" }).getAttribute("href")).toBe("/credits");
    expect(within(footer).getByRole("link", { name: /OpenStreetMap contributors/ }).getAttribute("href")).toBe("https://www.openstreetmap.org/copyright");
    expect(screen.getByRole("navigation", { name: "Main" }).querySelector('a[href="/events"]')).toBeTruthy();
  });
});
