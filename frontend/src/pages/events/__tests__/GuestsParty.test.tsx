// The organiser's guest list with party bookings: members right under the
// guest who booked them, "Booked by", "Party of n", the age (the organiser is
// the only one who sees it), no link for a member, and the delete question.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventDetail, OrganiserGuest } from "../../../api/events";
import type { MapSeat, SeatState } from "../../../api/types";
import { ToastProvider } from "../../../design/components";
import { partyOrder } from "../guestParty";
import OrganiserPage from "../OrganiserPage";
import { errorReply, startFakeServer } from "./mockServer";

function seat(id: number, state: SeatState, occupant: string | null = null): MapSeat {
  return { id, table_id: 1, label: String(id - 10), x: 40 * (id - 10), y: 50, state, accessible: false, occupant };
}

function guest(id: number, name: string, seatId: number | null, extra: Partial<OrganiserGuest> = {}): OrganiserGuest {
  return {
    id,
    name,
    email: `${name.split(" ")[0].toLowerCase()}@example.com`,
    group: null,
    rsvp: "yes",
    wants_anonymous: false,
    dietary_note: null,
    reserved_tag: null,
    needs_accessible: false,
    seat_id: seatId,
    source: "invited",
    has_account: false,
    first_name: null,
    last_name: null,
    age: null,
    booked_by_guest_id: null,
    ...extra,
  };
}

function member(id: number, name: string, seatId: number, bookerId: number, age: number): OrganiserGuest {
  const [first, last] = name.split(" ");
  return guest(id, name, seatId, { email: null, source: "companion", first_name: first, last_name: last, age, booked_by_guest_id: bookerId });
}

// Ana booked seats for Bea (113) and Rui (117); Carl has nothing to do with it.
function guests(): OrganiserGuest[] {
  return [
    guest(1, "Ana Silva", 11, { first_name: "Ana", last_name: "Silva", age: 41 }),
    guest(3, "Carl Mendes", null),
    member(4, "Bea Silva", 12, 1, 113),
    member(5, "Rui Silva", 13, 1, 117),
  ];
}

function detail(): EventDetail {
  return {
    event: {
      public_id: "spring",
      name: "Spring Gala",
      starts_at: "2027-03-14T19:30:00Z",
      ends_at: "2027-03-14T23:30:00Z",
      privacy_mode: "full_name",
      change_deadline: null,
      deadline_passed: false,
      live_scope: "event-spring",
    },
    venue: { public_id: "v1", name: "Quinta da Luz" },
    map: {
      width: 300,
      height: 120,
      zones: [],
      tables: [{ id: 1, label: "1", shape: "rect", x: 20, y: 30, w: 180, h: 40, rotation: 0 }],
      seats: [seat(11, "taken", "Ana Silva"), seat(12, "taken", "Bea Silva"), seat(13, "taken", "Rui Silva"), seat(14, "free")],
    },
    not_chosen: [{ guest_id: 3, name: "Carl Mendes", has_seat: false }],
    counts: { guests: 4, seated: 3, chosen_by_self: 3 },
  };
}

function organiserServer(list: OrganiserGuest[]) {
  const server = startFakeServer();
  const data = { guests: list };
  server.routes.set("GET /events/ev1", () => ({ body: detail() }));
  server.routes.set("GET /events/ev1/guests", () => ({ body: data.guests }));
  server.routes.set("GET /events/ev1/scenarios", () => ({ body: [] }));
  server.routes.set("DELETE /events/ev1/guests/1", () => {
    const call = server.calls[server.calls.length - 1];
    const choice = new URL(`http://x${call.url ?? ""}`).searchParams.get("party");
    if (choice === null) return errorReply(409, "has_party", "Ana Silva booked seats for 2 other people. Choose whether to delete them too.", { party_size: 2, member_ids: [4, 5] });
    data.guests = data.guests.filter((g) => g.id !== 1 && (choice === "keep" || g.booked_by_guest_id !== 1));
    return { body: { erased: true, guest_id: 1, party_erased: choice === "erase" ? [4, 5] : [] } };
  });
  return { server, data };
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

async function everyone(): Promise<HTMLElement> {
  fireEvent.change(await screen.findByLabelText("Show"), { target: { value: "all" } });
  return screen.findByRole("list", { name: "Guests" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("partyOrder", () => {
  it("puts each member straight after the guest who booked them, one step in", () => {
    const rows = partyOrder(guests());
    expect(rows.map((r) => [r.guest.id, r.depth, r.booker?.id ?? null])).toEqual([
      [1, 0, null],
      [4, 1, 1],
      [5, 1, 1],
      [3, 0, null],
    ]);
    expect(rows[0].members.map((m) => m.id)).toEqual([4, 5]);
  });

  it("keeps a member whose booker was deleted as a normal row, and never drops anyone", () => {
    const rows = partyOrder(guests().filter((g) => g.id !== 1));
    expect(rows.map((r) => [r.guest.id, r.depth, r.booker])).toEqual([
      [3, 0, null],
      [4, 0, null],
      [5, 0, null],
    ]);
    const odd = [guest(7, "Loop A", null, { booked_by_guest_id: 8, source: "companion" }), guest(8, "Loop B", null, { booked_by_guest_id: 7, source: "companion" })];
    expect(partyOrder(odd).map((r) => r.guest.id).sort()).toEqual([7, 8]);
  });
});

describe("Organiser guest list with parties", () => {
  it("shows members under their booker with their age and no link buttons", async () => {
    organiserServer(guests());
    renderPage();
    const list = await everyone();
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector(".ev-guest-name")?.textContent)).toEqual(["Ana Silva", "Bea Silva", "Rui Silva", "Carl Mendes"]);
    expect(within(rows[0]).getByText("Party of 3")).toBeTruthy();
    expect(within(rows[0]).getByText("Age 41")).toBeTruthy();
    expect(within(rows[1]).getByText("Booked by Ana Silva")).toBeTruthy();
    expect(within(rows[1]).getByText("Age 113")).toBeTruthy();
    expect(rows[1].classList.contains("ev-guest--member")).toBe(true);
    expect(within(rows[1]).queryByRole("button", { name: /link for Bea Silva/ })).toBeNull();
    expect(within(rows[0]).getByRole("button", { name: "New link for Ana Silva" })).toBeTruthy();
    expect(within(rows[3]).queryByText(/Age/)).toBeNull();
  });

  it("asks what happens to the party when the booker is deleted, and sends that choice", async () => {
    const { server } = organiserServer(guests());
    renderPage();
    const list = await everyone();
    fireEvent.click(within(list).getByRole("button", { name: "Delete data of Ana Silva" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Ana Silva's data?" });
    expect(within(dialog).getByText("Ana Silva booked seats for 2 other people: Bea Silva, Rui Silva.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Keep guest" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Delete only Ana Silva" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete all 3" }));
    await screen.findAllByText("Ana Silva's data and the data of the 2 people they booked were deleted.");
    const deletes = server.calls.filter((c) => c.method === "DELETE");
    expect(deletes.map((c) => c.url)).toEqual(["/events/ev1/guests/1?party=erase"]);
    const after = await screen.findByRole("list", { name: "Guests" });
    expect(within(after).queryByText("Bea Silva")).toBeNull();
    expect(within(after).getByText("Carl Mendes")).toBeTruthy();
  });

  it("Delete only the booker sends party=keep and the members stay, marked as party members", async () => {
    const { server } = organiserServer(guests());
    renderPage();
    const list = await everyone();
    fireEvent.click(within(list).getByRole("button", { name: "Delete data of Ana Silva" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete only Ana Silva" }));
    const bea = await within(await screen.findByRole("list", { name: "Guests" })).findByText("Bea Silva");
    expect(server.calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/events/ev1/guests/1?party=keep"]);
    const row = bea.closest("li") as HTMLElement;
    expect(within(row).getByText("Party member")).toBeTruthy();
    expect(row.classList.contains("ev-guest--member")).toBe(false);
  });

  it("a guest without a party is deleted as before, with no party in the address", async () => {
    const { server } = organiserServer(guests());
    server.routes.set("DELETE /events/ev1/guests/3", () => ({ body: { erased: true, guest_id: 3 } }));
    renderPage();
    const list = await everyone();
    fireEvent.click(within(list).getByRole("button", { name: "Delete data of Carl Mendes" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Carl Mendes's data?" });
    expect(within(dialog).queryByRole("button", { name: /Delete all/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete for good" }));
    await screen.findAllByText("Carl Mendes's data was deleted.", { exact: false });
    expect(server.calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/events/ev1/guests/3"]);
  });
});
