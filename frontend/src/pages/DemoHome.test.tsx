import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "./DemoHome";

function renderHome(): void {
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Home demo links", () => {
  it("shows exactly two entries and a browse link on each card, and hides every other demo link", async () => {
    // Shape of GET /demo/links in backend/app/routers/demo.py: name -> path. The old links are still sent.
    const links = {
      attendee_ana: "/a/demo-token",
      diner: "/r/demo-venue",
      editor_bistro: "/editor/demo-venue",
      restaurant_booking: "/r/casa",
      restaurant_staff: "/staff/casa",
      event_booking: "/events",
      event_staff: "/events/staff",
      showcase_venue_tagus_forum: "/venues/tagus-forum",
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ links }), { status: 200 })));
    renderHome();
    expect(screen.getByText("Loading demo links...")).toBeTruthy();
    // Events only in this project: the restaurant links are sent but never shown.
    expect((await screen.findByRole("link", { name: /Event booking/ })).getAttribute("href")).toBe("/events");
    expect(screen.getByRole("link", { name: /Event staff/ }).getAttribute("href")).toBe("/events/staff");
    expect(screen.queryByRole("link", { name: /Restaurant/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Restaurant" })).toBeNull();
    expect(screen.getByRole("link", { name: "Browse halls and quintas" }).getAttribute("href")).toBe("/venues");
    // Each card: its two entries and its browse link, nothing else.
    for (const title of ["Events"]) {
      const card = screen.getByRole("heading", { name: title }).closest("article") as HTMLElement;
      expect(within(card).getAllByRole("link")).toHaveLength(3);
    }
    expect(screen.queryByRole("link", { name: /Attendee Ana/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Diner/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Showcase Venue/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Venue tools" })).toBeNull();
  });

  it("describes each link in words instead of printing its path", async () => {
    // A real token is 43 characters with no place to break: printed, it pushed the page sideways on a phone.
    const token = "x".repeat(43);
    const links = { event_booking: `/j/${token}`, event_staff: "/events/staff" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ links }), { status: 200 })));
    renderHome();
    const booking = await screen.findByRole("link", { name: /Event booking/ });
    expect(booking.getAttribute("href")).toBe(`/j/${token}`);
    expect(booking.textContent).not.toContain(token);
    expect(screen.getByRole("link", { name: /Event staff/ }).getAttribute("href")).toBe("/events/staff");
  });

  it("shows an error with a working retry when the server is down", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHome();
    expect(await screen.findByText("The demo is not reachable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explains an empty demo instead of showing nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ links: {} }), { status: 200 })));
    renderHome();
    expect(await screen.findByText("The demo is switched off")).toBeTruthy();
  });
});

describe("Home header", () => {
  it("offers the one account and events, as every public page does, not the old organiser-only sign-in", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ links: {} }), { status: 200 })));
    renderHome();
    await screen.findByText("The demo is switched off");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/account");
    expect(within(nav).getByRole("link", { name: "Events" }).getAttribute("href")).toBe("/events");
    expect(within(nav).getByRole("link", { name: "Venues" }).getAttribute("href")).toBe("/directory");
    expect(screen.queryByRole("link", { name: "Organiser sign in" })).toBeNull();
  });
});
