// The Layout tab inside the organiser page, against the fake backend: choose a
// setup (preview on the map), apply, confirm when guests are seated, and the
// result line. Shapes copy docs/api.md, "Event room layouts".
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventDetail, EventLayouts, LayoutPreset, OrganiserGuest } from "../../../api/events";
import { ToastProvider } from "../../../design/components";
import OrganiserPage from "../OrganiserPage";
import { callsTo, startFakeServer } from "./mockServer";
import type { FakeServer } from "./mockServer";

function guest(id: number, name: string, seatId: number | null): OrganiserGuest {
  return {
    id,
    name,
    email: `${name.toLowerCase()}@example.com`,
    group: null,
    rsvp: "yes",
    wants_anonymous: false,
    dietary_note: null,
    reserved_tag: null,
    needs_accessible: false,
    seat_id: seatId,
    source: "invited",
    has_account: false,
  };
}

const DETAIL: EventDetail = {
  event: {
    public_id: "ev1",
    name: "Spring Gala",
    starts_at: "2027-03-14T19:30:00Z",
    ends_at: "2027-03-14T23:30:00Z",
    privacy_mode: "full_name",
    change_deadline: null,
    deadline_passed: false,
    live_scope: "event-ev1",
    venue_name: "Quinta da Luz",
  },
  venue: { public_id: "copy1", name: "Quinta da Luz" },
  map: {
    width: 300,
    height: 120,
    zones: [],
    tables: [{ id: 1, label: "1", shape: "round", x: 20, y: 30, w: 80, h: 80, rotation: 0 }],
    seats: [
      { id: 11, table_id: 1, label: "1", x: 30, y: 30, state: "taken", accessible: false, occupant: "Ana" },
      { id: 12, table_id: 1, label: "2", x: 90, y: 30, state: "free", accessible: false, occupant: null },
    ],
  },
  not_chosen: [],
  counts: { guests: 2, seated: 1, chosen_by_self: 1 },
};

function preset(key: LayoutPreset["key"], label: string, capacity: number): LayoutPreset {
  const seats = Array.from({ length: Math.min(capacity, 3) }, (_, n) => ({ x: 120 + n * 60, y: 300 }));
  return {
    key,
    label,
    description: `${label} description.`,
    capacity,
    preview: {
      width: 1000,
      height: 600,
      zones: [{ kind: "stage", x: 300, y: 20, w: 400, h: 80 }],
      tables: capacity ? [{ shape: "row", x: 100, y: 280, w: 300, h: 40, rotation: 0, seats }] : [],
    },
  };
}

function layouts(current: EventLayouts["current"], ownLayout: boolean): EventLayouts {
  return {
    current,
    own_layout: ownLayout,
    venue_id: "copy1",
    capacity: 80,
    guests: 2,
    seated: 1,
    presets: [preset("banquet", "Banquet", 80), preset("theatre", "Theatre", 140), preset("boardroom", "Boardroom", 0)],
  };
}

function server(): FakeServer {
  const fake = startFakeServer();
  fake.routes.set("GET /events/ev1", () => ({ body: DETAIL }));
  fake.routes.set("GET /events/ev1/guests", () => ({ body: [guest(1, "Ana", 11), guest(2, "Bea", null)] }));
  fake.routes.set("GET /events/ev1/layouts", () => ({ body: layouts("banquet", true) }));
  fake.routes.set("POST /events/ev1/layout", (body) => {
    const sent = body as { preset: string; confirm?: boolean };
    if (!sent.confirm) {
      const message = "1 guest already has a seat. Applying the Theatre setup will re-seat them on the new layout and email anyone whose seat changes.";
      return { status: 409, body: { error: { code: "guests_seated", message, details: { seated: 1, capacity: 140, guests: 2 } } } };
    }
    return { body: { ...layouts("theatre", true), capacity: 140, applied: "theatre", reseated: 1, unseated: 0 } };
  });
  return fake;
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/organiser/ev1"]}>
      <ToastProvider>
        <Routes>
          <Route path="/organiser/:eventId" element={<OrganiserPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Layout tab", () => {
  it("shows each setup with its seats against the guests coming, and the one in use", async () => {
    server();
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Layout" }));
    const list = await screen.findByRole("list", { name: "Room setups" });
    const banquet = within(list).getByRole("button", { name: /^Banquet/ });
    expect(banquet.textContent).toContain("In use");
    expect(banquet.textContent).toContain("80 seats for 2 coming");
    expect(within(list).getByRole("button", { name: /^Theatre/ }).textContent).toContain("140 seats for 2 coming");
    // A setup the room cannot hold cannot be chosen.
    expect((within(list).getByRole("button", { name: /^Boardroom/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Banquet setup, 80 seats")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Fine-tune in the editor" }).getAttribute("href")).toBe("/editor/copy1");
  });

  it("previews on the first tap, asks before re-seating on the second, and applies on confirm", async () => {
    const fake = server();
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Layout" }));
    const theatre = await screen.findByRole("button", { name: /^Theatre/ });

    fireEvent.click(theatre);
    expect(theatre.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Preview of the Theatre setup, not applied.")).toBeTruthy();
    expect(callsTo(fake, "POST", "/events/ev1/layout")).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Apply Theatre setup" }));
    const dialog = await screen.findByRole("dialog", { name: "Apply the Theatre setup?" });
    expect(dialog.textContent).toContain("1 guest already has a seat. They will be re-seated automatically");
    expect(dialog.textContent).toContain("seat-change email");
    expect(callsTo(fake, "POST", "/events/ev1/layout")).toEqual([{ preset: "theatre" }]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Apply and re-seat guests" }));
    expect(await screen.findByText("Theatre setup applied. 1 guest re-seated.", { selector: ".ev-layout-result" })).toBeTruthy();
    expect(callsTo(fake, "POST", "/events/ev1/layout")).toEqual([{ preset: "theatre" }, { preset: "theatre", confirm: true }]);
    expect(screen.queryByRole("dialog")).toBeNull();
    // The real plan is back on the map, and the new setup is the one in use.
    expect(screen.queryByText("Preview of the Theatre setup, not applied.")).toBeNull();
    expect(screen.getByRole("button", { name: /^Theatre/ }).textContent).toContain("In use");
  });

  it("keeps everything as it was when the confirm is cancelled", async () => {
    const fake = server();
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Layout" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Theatre/ }));
    fireEvent.click(screen.getByRole("button", { name: "Apply Theatre setup" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep the current setup" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(callsTo(fake, "POST", "/events/ev1/layout")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^Banquet/ }).textContent).toContain("In use");
  });

  it("leaving the tab puts the real plan back on the map", async () => {
    server();
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Layout" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Theatre/ }));
    expect(screen.getByText("Preview of the Theatre setup, not applied.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Guests" }));
    expect(screen.queryByText("Preview of the Theatre setup, not applied.")).toBeNull();
  });

  it("offers fine-tuning only once the event has its own copy of the room", async () => {
    const fake = server();
    fake.routes.set("GET /events/ev1/layouts", () => ({ body: layouts("custom", false) }));
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Layout" }));
    expect(await screen.findByText("The venue's standard plan, 80 seats")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Fine-tune in the editor" })).toBeNull();
    expect(screen.getByText(/Apply a setup first/)).toBeTruthy();
  });
});
