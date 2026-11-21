// The party booking on the attendee page: several seats on the map, then
// "Who is sitting where?" with one card per seat (the booker first), Confirm
// only once everyone has a first name, a last name and an age. Both doors:
// the personal link (/e/:token) and a guest account (/guest/events/{eid}).
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMemo } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../design/components";
import { accountApi } from "../attendeeApi";
import AttendeePage, { AttendeeJourney } from "../AttendeePage";
import { useAttendee } from "../useAttendee";
import { callsTo, errorReply } from "./mockServer";
import { ACCOUNT, LINK, partyBackend, partyView, seat } from "./partyServer";

function renderLink(): void {
  render(
    <MemoryRouter initialEntries={["/e/tok"]}>
      <ToastProvider>
        <Routes>
          <Route path="/e/:token" element={<AttendeePage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** The guest account's seat page without its sign-in guard: the same journey on accountApi. */
function AccountJourney() {
  const attendeeApi = useMemo(() => accountApi("ev1"), []);
  const state = useAttendee(attendeeApi);
  return <AttendeeJourney state={state} />;
}

function renderAccount(): void {
  render(
    <MemoryRouter>
      <ToastProvider>
        <AccountJourney />
      </ToastProvider>
    </MemoryRouter>,
  );
}

async function tapSeat(n: number): Promise<void> {
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(`^Table 1, seat ${n}, free`) }));
}

/** Taps the seats, then Continue in the bar. */
async function chooseSeats(...seats: number[]): Promise<void> {
  for (const n of seats) await tapSeat(n);
  const bar = screen.getByRole("region", { name: "Selected seat" });
  fireEvent.click(within(bar).getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Who is sitting where?" });
}

function fill(cardName: string, values: { first?: string; last?: string; age?: string }): void {
  const card = screen.getByRole("group", { name: cardName });
  if (values.first !== undefined) fireEvent.change(within(card).getByLabelText("First name"), { target: { value: values.first } });
  if (values.last !== undefined) fireEvent.change(within(card).getByLabelText("Last name"), { target: { value: values.last } });
  if (values.age !== undefined) fireEvent.change(within(card).getByLabelText("Age"), { target: { value: values.age } });
}

function confirmButton(count: number): HTMLElement {
  const footer = screen.getByRole("region", { name: "Confirm your seats" });
  return within(footer).getByRole("button", { name: `Confirm ${count} ${count === 1 ? "seat" : "seats"}` });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Who is sitting where?", () => {
  it("books three seats, the booker first, with a name and an age for everyone", async () => {
    const backend = partyBackend();
    renderLink();
    await chooseSeats(1, 3, 4);

    // One card per seat, in the order tapped; the booker's card is filled from the invitation.
    const cards = screen.getAllByRole("group").filter((g) => g.classList.contains("party-card"));
    expect(cards.map((c) => c.querySelector("legend")?.textContent)).toEqual([
      "You · Table 1, seat 1",
      "Guest 1 · Table 1, seat 3",
      "Guest 2 · Table 1, seat 4",
    ]);
    expect((within(cards[0]).getByLabelText("First name") as HTMLInputElement).value).toBe("Ana");
    expect((within(cards[0]).getByLabelText("Last name") as HTMLInputElement).value).toBe("Silva");
    expect(screen.getByText("Other guests see names the way the organiser chose. Ages are only seen by the organiser.")).toBeTruthy();

    // Unavailable until complete, with the count beside it.
    expect(confirmButton(3).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("0 of 3 people complete.")).toBeTruthy();
    fill("You · Table 1, seat 1", { age: "109" });
    fill("Guest 1 · Table 1, seat 3", { first: "Bea", last: "Silva", age: "113" });
    expect(screen.getByText("2 of 3 people complete.")).toBeTruthy();
    expect(confirmButton(3).getAttribute("aria-disabled")).toBe("true");
    fill("Guest 2 · Table 1, seat 4", { first: "Rui", last: "Silva", age: "117" });
    expect(screen.getByText("All 3 people are complete.")).toBeTruthy();
    expect(confirmButton(3).getAttribute("aria-disabled")).toBeNull();
    expect(confirmButton(3).getAttribute("aria-describedby")).toBe(screen.getByText("All 3 people are complete.").id);
    fireEvent.click(confirmButton(3));

    expect(await screen.findByRole("heading", { name: "You are all set" })).toBeTruthy();
    expect(callsTo(backend.server, "POST", `${LINK}/party/confirm`)).toEqual([
      {
        me: { seat_id: 11, first_name: "Ana", last_name: "Silva", age: 109 },
        members: [
          { seat_id: 13, first_name: "Bea", last_name: "Silva", age: 113 },
          { seat_id: 14, first_name: "Rui", last_name: "Silva", age: 117 },
        ],
      },
    ]);
    expect(callsTo(backend.server, "POST", `${LINK}/confirm`)).toEqual([]);
    expect(callsTo(backend.server, "POST", `${LINK}/hold`)).toEqual([]);

    // Done shows the party; the page never shows an age number back.
    const list = await screen.findByRole("list", { name: "People you booked seats for" });
    expect(within(list).getByText("Bea Silva")).toBeTruthy();
    expect(within(list).getByText("Table 1, seat 4")).toBeTruthy();
    expect(within(list).getAllByText("Age saved")).toHaveLength(2);
    const text = document.body.textContent ?? "";
    for (const age of ["109", "113", "117"]) expect(text).not.toContain(age);
  });

  it("marks every chosen seat as selected on the map and lists them in the bar", async () => {
    partyBackend();
    renderLink();
    await tapSeat(1);
    await tapSeat(3);
    const one = screen.getByRole("option", { name: /^Table 1, seat 1, / });
    const three = screen.getByRole("option", { name: /^Table 1, seat 3, / });
    expect(one.getAttribute("aria-selected")).toBe("true");
    expect(three.getAttribute("aria-selected")).toBe("true");
    expect(three.getAttribute("aria-label")).toMatch(/selected/);
    expect(screen.getByRole("option", { name: /^Table 1, seat 4, / }).getAttribute("aria-selected")).toBe("false");
    const bar = screen.getByRole("region", { name: "Selected seat" });
    expect(within(bar).getByText("2 seats selected")).toBeTruthy();
    expect(within(bar).getByText("Table 1, seat 1 · Table 1, seat 3")).toBeTruthy();
    expect(within(bar).getByText("Available until someone confirms it.")).toBeTruthy();
    // Tapping a chosen seat again gives it back.
    fireEvent.click(three);
    expect(screen.getByRole("option", { name: /^Table 1, seat 3, / }).getAttribute("aria-selected")).toBe("false");
  });

  it("pressing Confirm early shows every missing field and moves the focus to the first", async () => {
    const backend = partyBackend();
    renderLink();
    await chooseSeats(1, 3);
    fireEvent.click(confirmButton(2));

    expect(callsTo(backend.server, "POST", `${LINK}/party/confirm`)).toEqual([]);
    const me = screen.getByRole("group", { name: "You · Table 1, seat 1" });
    const guest = screen.getByRole("group", { name: "Guest 1 · Table 1, seat 3" });
    expect(within(me).getByText("Enter an age from 0 to 120.")).toBeTruthy();
    expect(within(guest).getByText("Enter a first name.")).toBeTruthy();
    expect(within(guest).getByText("Enter a last name.")).toBeTruthy();
    expect(within(guest).getByText("Enter an age from 0 to 120.")).toBeTruthy();
    // The booker's names were filled in, so the first missing field is their age.
    expect(document.activeElement).toBe(within(me).getByLabelText("Age"));
    expect(within(me).getByLabelText("Age").getAttribute("aria-invalid")).toBe("true");
  });

  it("shows a field's problem as soon as the guest leaves it, and refuses ages outside 0 to 120", async () => {
    partyBackend();
    renderLink();
    await chooseSeats(1, 3);
    const guest = screen.getByRole("group", { name: "Guest 1 · Table 1, seat 3" });
    expect(within(guest).queryByText("Enter a first name.")).toBeNull();
    fireEvent.blur(within(guest).getByLabelText("First name"));
    expect(within(guest).getByText("Enter a first name.")).toBeTruthy();
    for (const bad of ["121", "7.5", "-1", "abc"]) {
      fill("Guest 1 · Table 1, seat 3", { first: "Bea", last: "Silva", age: bad });
      fireEvent.blur(within(guest).getByLabelText("Age"));
      expect(within(guest).getByText("Enter an age from 0 to 120.")).toBeTruthy();
      expect(confirmButton(2).getAttribute("aria-disabled")).toBe("true");
    }
    fill("Guest 1 · Table 1, seat 3", { age: "0" });
    expect(within(guest).queryByText("Enter an age from 0 to 120.")).toBeNull();
  });

  it("removes a person from the cards; their seat is given back and the count follows", async () => {
    partyBackend();
    renderLink();
    await chooseSeats(1, 3, 4);
    const guest = screen.getByRole("group", { name: "Guest 1 · Table 1, seat 3" });
    const remove = within(guest).getByRole("button", { name: "Remove from your party: Guest 1" });
    expect(remove.textContent).toBe("Remove from your party");
    expect(within(screen.getByRole("group", { name: "You · Table 1, seat 1" })).queryByRole("button", { name: /^Remove/ })).toBeNull();
    fireEvent.click(remove);
    expect(screen.queryByRole("group", { name: /seat 3$/ })).toBeNull();
    // The cards are counted again: the person on seat 4 is now Guest 1.
    expect(screen.getByRole("group", { name: "Guest 1 · Table 1, seat 4" })).toBeTruthy();
    expect(confirmButton(2)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to the map" }));
    expect((await screen.findByRole("option", { name: /^Table 1, seat 3, / })).getAttribute("aria-selected")).toBe("false");
  });

  it("swaps two people's seats from the Seat list", async () => {
    partyBackend();
    renderLink();
    await chooseSeats(1, 3);
    const guest = screen.getByRole("group", { name: "Guest 1 · Table 1, seat 3" });
    fireEvent.change(within(guest).getByLabelText("Seat"), { target: { value: "11" } });
    expect(screen.getByRole("group", { name: "You · Table 1, seat 3" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Guest 1 · Table 1, seat 1" })).toBeTruthy();
  });

  it("keeps every card when going back to the map, and a seat tapped again is given back", async () => {
    partyBackend();
    renderLink();
    await chooseSeats(1, 3);
    fill("Guest 1 · Table 1, seat 3", { first: "Bea", last: "Silva", age: "9" });
    fireEvent.click(screen.getByRole("button", { name: "Back to the map" }));
    expect(await screen.findByRole("heading", { name: "Choose your seat" })).toBeTruthy();
    const chosen = screen.getByRole("list", { name: "Seats you chose" });
    expect(within(chosen).getByRole("button", { name: "Bea · Table 1, seat 3: remove from your selection" })).toBeTruthy();
    // Bea's seat given back: her card stays with her details, without a seat; the next tap fills it.
    fireEvent.click(within(chosen).getByRole("button", { name: "Bea · Table 1, seat 3: remove from your selection" }));
    expect(within(screen.getByRole("region", { name: "Selected seat" })).getByText("Table 1, seat 1")).toBeTruthy();
    await tapSeat(5);
    fireEvent.click(within(screen.getByRole("region", { name: "Selected seat" })).getByRole("button", { name: "Continue" }));
    const bea = await screen.findByRole("group", { name: "Guest 1 · Table 1, seat 5" });
    expect((within(bea).getByLabelText("First name") as HTMLInputElement).value).toBe("Bea");
    expect((within(bea).getByLabelText("Age") as HTMLInputElement).value).toBe("9");
  });

  it("when a seat is taken first, only that person loses it; every name stays and the next tap fills it", async () => {
    const backend = partyBackend();
    renderLink();
    await chooseSeats(1, 3, 4);
    fill("You · Table 1, seat 1", { age: "40" });
    fill("Guest 1 · Table 1, seat 3", { first: "Bea", last: "Silva", age: "9" });
    fill("Guest 2 · Table 1, seat 4", { first: "Rui", last: "Silva", age: "7" });
    // Someone else confirms seat 4 a moment earlier.
    backend.view.map.seats = backend.view.map.seats.map((s) => (s.id === 14 ? seat(14, "taken", "Joana C.") : s));
    fireEvent.click(confirmButton(3));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("A seat was just taken")).toBeTruthy();
    expect(within(alert).getByText("Table 1, seat 4 was just taken. Choose another seat for Rui.")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Choose your seat" })).toBeTruthy();
    expect(backend.view.party?.members).toEqual([]); // nothing was written

    await tapSeat(5);
    fireEvent.click(within(screen.getByRole("region", { name: "Selected seat" })).getByRole("button", { name: "Continue" }));
    const rui = await screen.findByRole("group", { name: "Guest 2 · Table 1, seat 5" });
    expect((within(rui).getByLabelText("First name") as HTMLInputElement).value).toBe("Rui");
    fireEvent.click(confirmButton(3));
    expect(await screen.findByRole("heading", { name: "You are all set" })).toBeTruthy();
    const sent = callsTo(backend.server, "POST", `${LINK}/party/confirm`);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({
      me: { seat_id: 11, first_name: "Ana", last_name: "Silva", age: 40 },
      members: [
        { seat_id: 13, first_name: "Bea", last_name: "Silva", age: 9 },
        { seat_id: 15, first_name: "Rui", last_name: "Silva", age: 7 },
      ],
    });
  });

  it("a live update that takes a chosen seat sends the guest back to the map, names kept", async () => {
    const backend = partyBackend();
    renderLink();
    await chooseSeats(1, 3);
    fill("Guest 1 · Table 1, seat 3", { first: "Bea", last: "Silva", age: "9" });
    backend.view.map.seats = backend.view.map.seats.map((s) => (s.id === 13 ? seat(13, "taken", "Joana C.") : s));
    backend.server.version += 1;
    const alert = await screen.findByRole("alert", {}, { timeout: 4000 });
    expect(within(alert).getByText("Table 1, seat 3 was just taken. Choose another seat for Bea.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Choose your seat" })).toBeTruthy();
    await tapSeat(4);
    fireEvent.click(within(screen.getByRole("region", { name: "Selected seat" })).getByRole("button", { name: "Continue" }));
    expect((within(await screen.findByRole("group", { name: "Guest 1 · Table 1, seat 4" })).getByLabelText("Last name") as HTMLInputElement).value).toBe("Silva");
  });

  it("stops at the places the event has left, and still explains a refusal from the server", async () => {
    const view = partyView();
    (view.party as { places_left: number }).places_left = 1;
    const backend = partyBackend(LINK, view);
    renderLink();
    await tapSeat(1);
    await tapSeat(3);
    await tapSeat(4);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("No more places")).toBeTruthy();
    expect(within(alert).getByText(/room for 1 more person besides you/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Selected seat" })).getByText("2 seats selected")).toBeTruthy();

    // Someone joined meanwhile: the server says the event is full.
    backend.server.routes.set(`POST ${LINK}/party/confirm`, () => errorReply(409, "event_full", "This event is full. Every place has a guest.", { places_left: 0 }));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected seat" })).getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Who is sitting where?" });
    fill("You · Table 1, seat 1", { age: "40" });
    fill("Guest 1 · Table 1, seat 3", { first: "Bea", last: "Silva", age: "9" });
    fireEvent.click(confirmButton(2));
    expect(await screen.findByText("This event is full. Every place has a guest.")).toBeTruthy();
    // Still on the cards, with everything typed.
    expect((within(screen.getByRole("group", { name: "Guest 1 · Table 1, seat 3" })).getByLabelText("First name") as HTMLInputElement).value).toBe("Bea");
  });

  it("shows the party limit and stops at it with a friendly message, then explains the server's refusal", async () => {
    const view = partyView();
    Object.assign(view.party as object, { max_party_size: 2, party_size_left: 1 });
    const backend = partyBackend(LINK, view);
    renderLink();
    expect(await screen.findByText(/You can book up to 2 seats, your own included\./)).toBeTruthy();
    await tapSeat(1);
    await tapSeat(3);
    await tapSeat(4);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("You can book up to 2 seats for this event, your own included, so you cannot choose more seats.")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Selected seat" })).getByText("2 seats selected")).toBeTruthy();

    // The organiser lowered the limit meanwhile: the server refuses and says why.
    const refusal = "You can book up to 1 seat for this event, your own included. Ask the organiser if you need more.";
    backend.server.routes.set(`POST ${LINK}/party/confirm`, () => errorReply(409, "party_too_large", refusal, { max_party_size: 1, party_size_left: 0 }));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected seat" })).getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Who is sitting where?" });
    fill("You · Table 1, seat 1", { age: "40" });
    fill("Guest 1 · Table 1, seat 3", { first: "Bea", last: "Silva", age: "9" });
    fireEvent.click(confirmButton(2));
    expect(await screen.findByText(refusal)).toBeTruthy();
    expect((within(screen.getByRole("group", { name: "Guest 1 · Table 1, seat 3" })).getByLabelText("First name") as HTMLInputElement).value).toBe("Bea");
  });

  it("works the same through a guest account, on /guest/events/{eid}", async () => {
    const backend = partyBackend(ACCOUNT);
    renderAccount();
    await chooseSeats(1, 3);
    fill("You · Table 1, seat 1", { age: "40" });
    fill("Guest 1 · Table 1, seat 3", { first: "Bea", last: "Silva", age: "9" });
    fireEvent.click(confirmButton(2));
    expect(await screen.findByRole("heading", { name: "You are all set" })).toBeTruthy();
    expect(callsTo(backend.server, "POST", `${ACCOUNT}/party/confirm`)).toEqual([
      { me: { seat_id: 11, first_name: "Ana", last_name: "Silva", age: 40 }, members: [{ seat_id: 13, first_name: "Bea", last_name: "Silva", age: 9 }] },
    ]);
    expect(backend.server.calls.some((c) => c.path.startsWith("/a/"))).toBe(false);
  });

  it("with an age already saved, the booker may leave it empty and it is not sent", async () => {
    const view = partyView();
    view.me.age_saved = true;
    (view.party as { me: { age_saved: boolean } }).me.age_saved = true;
    const backend = partyBackend(LINK, view);
    renderLink();
    await chooseSeats(1);
    const me = screen.getByRole("group", { name: "You · Table 1, seat 1" });
    expect(within(me).getByText("Saved. Leave empty to keep it.")).toBeTruthy();
    expect(screen.getByText("Your details are complete.")).toBeTruthy();
    fireEvent.click(confirmButton(1));
    expect(await screen.findByRole("heading", { name: "You are all set" })).toBeTruthy();
    expect(callsTo(backend.server, "POST", `${LINK}/party/confirm`)).toEqual([{ me: { seat_id: 11, first_name: "Ana", last_name: "Silva" }, members: [] }]);
  });
});

describe("Who is sitting where? when the answer comes late or is lost", () => {
  it("a second Confirm after a lost answer that had worked is a success, not a taken seat", async () => {
    const backend = partyBackend();
    const real = backend.server.routes.get(`POST ${LINK}/party/confirm`);
    if (!real) throw new Error("no confirm route");
    let calls = 0;
    backend.server.routes.set(`POST ${LINK}/party/confirm`, async (body) => {
      calls += 1;
      const reply = await real(body);
      // The first booking is saved, but its answer never reaches the page.
      return calls === 1 ? errorReply(502, "bad_gateway", "The server did not answer.") : reply;
    });
    renderLink();
    await chooseSeats(1, 3);
    fill("You · Table 1, seat 1", { age: "40" });
    fill("Guest 1 · Table 1, seat 3", { first: "Bea", last: "Silva", age: "9" });
    fireEvent.click(confirmButton(2));
    await waitFor(() => expect(calls).toBe(1));
    fireEvent.click(await waitFor(() => confirmButton(2)));

    expect(await screen.findByRole("heading", { name: "You are all set" })).toBeTruthy();
    expect(calls).toBe(2);
    expect(document.body.textContent).not.toMatch(/was just taken/);
    expect(backend.view.party?.members.map((m) => [m.first_name, m.seat_id])).toEqual([["Bea", 13]]);
  });

  it("a seat taken while Confirm waits keeps the named notice when the refusal arrives", async () => {
    const backend = partyBackend();
    const real = backend.server.routes.get(`POST ${LINK}/party/confirm`);
    if (!real) throw new Error("no confirm route");
    let release: () => void = () => undefined;
    const answer = new Promise<void>((resolve) => {
      release = resolve;
    });
    backend.server.routes.set(`POST ${LINK}/party/confirm`, async (body) => {
      // Someone else confirms seat 4 and the live update reaches the page first.
      backend.view.map.seats = backend.view.map.seats.map((s) => (s.id === 14 ? seat(14, "taken", "Joana C.") : s));
      backend.server.version += 1;
      await answer;
      return real(body);
    });
    renderLink();
    await chooseSeats(1, 3, 4);
    fill("You · Table 1, seat 1", { age: "40" });
    fill("Guest 1 · Table 1, seat 3", { first: "Bea", last: "Silva", age: "9" });
    fill("Guest 2 · Table 1, seat 4", { first: "Rui", last: "Silva", age: "7" });
    fireEvent.click(confirmButton(3));

    const RUI = "Table 1, seat 4 was just taken. Choose another seat for Rui.";
    const live = await screen.findByRole("alert", {}, { timeout: 4000 });
    expect(within(live).getByText(RUI)).toBeTruthy();
    release(); // now the 409 seat_taken for seat 14 arrives
    await waitFor(() => expect(callsTo(backend.server, "GET", LINK).length).toBeGreaterThan(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("A seat was just taken")).toBeTruthy();
    expect(within(alert).getByText(RUI)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Choose your seat" })).toBeTruthy();
    expect(backend.view.party?.members).toEqual([]);
  });
});
