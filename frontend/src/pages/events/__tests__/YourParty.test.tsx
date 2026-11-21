// "Your party" on the Done step: Edit, Move and Remove a person the guest
// booked a seat for, Add people, Add your details, and the release rule
// while people are still coming (design D6).
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../design/components";
import AttendeePage from "../AttendeePage";
import { callsTo, errorReply } from "./mockServer";
import { LINK, bookedView, memberRoutes, partyBackend, seat } from "./partyServer";

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

function setup() {
  const backend = partyBackend(LINK, bookedView());
  memberRoutes(backend, LINK, 4);
  renderLink();
  return backend;
}

async function partyList(): Promise<HTMLElement> {
  return screen.findByRole("list", { name: "People you booked seats for" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Your party", () => {
  it("lists each person with their seat and the actions, and never an age number", async () => {
    setup();
    const list = await partyList();
    const bea = within(list).getByRole("listitem");
    expect(within(bea).getByText("Bea Silva")).toBeTruthy();
    expect(within(bea).getByText("Table 1, seat 3")).toBeTruthy();
    expect(within(bea).getByText("Age saved")).toBeTruthy();
    for (const name of ["Edit Bea Silva", "Move Bea Silva", "Remove Bea Silva"]) expect(within(bea).getByRole("button", { name })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add people" })).toBeTruthy();
  });

  it("shows the party limit, and no Add people once the party is full", async () => {
    const view = bookedView();
    Object.assign(view.party as object, { max_party_size: 2, party_size_left: 0 });
    const backend = partyBackend(LINK, view);
    memberRoutes(backend, LINK, 4);
    renderLink();
    await partyList();
    expect(screen.getByText("You can book up to 2 seats, your own included.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add people" })).toBeNull();
    expect(screen.getByText("Your party has every seat one person can book here. Ask the organiser if you need more.")).toBeTruthy();
  });

  it("does not let the guest release their seat while their party is coming", async () => {
    const backend = setup();
    await partyList();
    fireEvent.click(screen.getByRole("button", { name: "Release my seat" }));
    const dialog = await screen.findByRole("dialog", { name: "Your party still has seats" });
    expect(within(dialog).getByText(/You booked seats for 1 other person\. Remove them in Your party first, or ask the organiser\./)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Release seat" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(callsTo(backend.server, "DELETE", `${LINK}/seat`)).toEqual([]);
  });

  it("Edit sends only what changed, and an age only when one is typed", async () => {
    const backend = setup();
    fireEvent.click(within(await partyList()).getByRole("button", { name: "Edit Bea Silva" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Bea Silva" });
    expect((within(dialog).getByLabelText("Age") as HTMLInputElement).value).toBe("");
    expect(within(dialog).getByText("Saved. Leave empty to keep it.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("First name"), { target: { value: "Beatriz " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(await partyList()).findByText("Beatriz Silva")).toBeTruthy();
    expect(callsTo(backend.server, "PATCH", `${LINK}/party/4`)).toEqual([{ first_name: "Beatriz" }]);

    fireEvent.click(within(await partyList()).getByRole("button", { name: "Edit Beatriz Silva" }));
    const again = await screen.findByRole("dialog", { name: "Edit Beatriz Silva" });
    fireEvent.change(within(again).getByLabelText("Age"), { target: { value: "130" } });
    fireEvent.click(within(again).getByRole("button", { name: "Save changes" }));
    expect(within(again).getByText("Enter an age from 0 to 120.")).toBeTruthy();
    fireEvent.change(within(again).getByLabelText("Age"), { target: { value: "10" } });
    fireEvent.click(within(again).getByRole("button", { name: "Save changes" }));
    await screen.findByRole("list", { name: "People you booked seats for" });
    expect(callsTo(backend.server, "PATCH", `${LINK}/party/4`)).toEqual([{ first_name: "Beatriz" }, { age: 10 }]);
    expect(backend.ages.get(4)).toBe(10);
    expect(document.body.textContent ?? "").not.toContain("10 ");
  });

  it("Move opens the map for that person and moves them to the seat picked", async () => {
    const backend = setup();
    fireEvent.click(within(await partyList()).getByRole("button", { name: "Move Bea Silva" }));
    expect(await screen.findByRole("heading", { name: "Choose a new seat for Bea Silva" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("option", { name: /^Table 1, seat 4, free/ }));
    const bar = screen.getByRole("region", { name: "Selected seat" });
    expect(within(bar).getByText("Table 1, seat 4")).toBeTruthy();
    fireEvent.click(within(bar).getByRole("button", { name: "Move Bea here" }));
    expect(await screen.findByRole("heading", { name: "You are all set" })).toBeTruthy();
    expect(callsTo(backend.server, "PUT", `${LINK}/party/4/seat`)).toEqual([{ seat_id: 14 }]);
    expect(within(await partyList()).getByText("Table 1, seat 4")).toBeTruthy();
  });

  it("Move and Add people go straight to the map, even for a guest who listed nobody they know", async () => {
    const view = bookedView();
    view.me.knows = [];
    const backend = partyBackend(LINK, view);
    memberRoutes(backend, LINK, 4);
    renderLink();
    fireEvent.click(within(await partyList()).getByRole("button", { name: "Move Bea Silva" }));
    expect(await screen.findByRole("heading", { name: "Choose a new seat for Bea Silva" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Who do you know here?" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep Bea's current seat" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add people" }));
    expect(await screen.findByRole("heading", { name: "Add people to your party" })).toBeTruthy();
  });

  it("Move can be left without a change", async () => {
    const backend = setup();
    fireEvent.click(within(await partyList()).getByRole("button", { name: "Move Bea Silva" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep Bea's current seat" }));
    expect(await screen.findByRole("heading", { name: "You are all set" })).toBeTruthy();
    expect(callsTo(backend.server, "PUT", `${LINK}/party/4/seat`)).toEqual([]);
  });

  it("Remove asks first, then deletes the person and frees the seat", async () => {
    const backend = setup();
    fireEvent.click(within(await partyList()).getByRole("button", { name: "Remove Bea Silva" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Bea Silva from your party?" });
    expect(within(dialog).getByText("Their seat becomes free for anyone, and their name and age are deleted. This cannot be undone.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText(/Bringing someone\?/)).toBeTruthy();
    expect(callsTo(backend.server, "DELETE", `${LINK}/party/4`)).toHaveLength(1);
    expect(screen.queryByRole("list", { name: "People you booked seats for" })).toBeNull();
  });

  it("a person who is no longer in the party gives a clear message, not a broken page", async () => {
    const backend = setup();
    backend.server.routes.set(`DELETE ${LINK}/party/4`, () => errorReply(404, "not_found", "This person is not in your party."));
    fireEvent.click(within(await partyList()).getByRole("button", { name: "Remove Bea Silva" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("This person is not in your party.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "You are all set" })).toBeTruthy();
  });

  it("Add people keeps the guest's own seat and sends only the new people", async () => {
    const backend = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Add people" }));
    expect(await screen.findByRole("heading", { name: "Add people to your party" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("option", { name: /^Table 1, seat 5, free/ }));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected seat" })).getByRole("button", { name: "Continue" }));
    const me = await screen.findByRole("group", { name: "You · Table 1, seat 1" });
    expect(within(me).getByText("Your seat stays Table 1, seat 1.")).toBeTruthy();
    expect(within(me).queryByLabelText("Seat")).toBeNull();
    const guest = screen.getByRole("group", { name: "Guest 1 · Table 1, seat 5" });
    fireEvent.change(within(guest).getByLabelText("First name"), { target: { value: "Rui" } });
    fireEvent.change(within(guest).getByLabelText("Last name"), { target: { value: "Silva" } });
    fireEvent.change(within(guest).getByLabelText("Age"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm 2 seats" }));
    expect(await screen.findByRole("heading", { name: "You are all set" })).toBeTruthy();
    expect(callsTo(backend.server, "POST", `${LINK}/party/confirm`)).toEqual([
      { me: { seat_id: 11, first_name: "Ana", last_name: "Silva" }, members: [{ seat_id: 15, first_name: "Rui", last_name: "Silva", age: 7 }] },
    ]);
    const list = await partyList();
    expect(within(list).getByText("Bea Silva")).toBeTruthy();
    expect(within(list).getByText("Rui Silva")).toBeTruthy();
  });

  it("Change seat books the guest's new seat through the party route and keeps the party", async () => {
    const backend = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Change seat" }));
    expect(await screen.findByRole("heading", { name: "Choose a new seat" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("option", { name: /^Table 1, seat 6, free/ }));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected seat" })).getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm 1 seat" }));
    expect(await screen.findByRole("heading", { name: "You are all set" })).toBeTruthy();
    expect(callsTo(backend.server, "POST", `${LINK}/party/confirm`)).toEqual([{ me: { seat_id: 16, first_name: "Ana", last_name: "Silva" }, members: [] }]);
    expect(within(await partyList()).getByText("Bea Silva")).toBeTruthy();
    expect(backend.view.map.seats.find((s) => s.id === 11)).toEqual(seat(11, "free"));
  });

  it("asks a seated guest without saved details for them, then saves through party/me", async () => {
    const view = bookedView();
    view.me.age_saved = false;
    view.me.details_complete = false;
    view.party = { ...view.party!, me: { ...view.party!.me, first_name: null, last_name: null, age_saved: false, details_complete: false }, members: [] };
    const backend = partyBackend(LINK, view);
    renderLink();
    const form = await screen.findByRole("form", { name: "Add your details" });
    expect((within(form).getByLabelText("First name") as HTMLInputElement).value).toBe("Ana");
    fireEvent.click(within(form).getByRole("button", { name: "Save my details" }));
    expect(within(form).getByText("Enter an age from 0 to 120.")).toBeTruthy();
    expect(callsTo(backend.server, "POST", `${LINK}/party/me`)).toEqual([]);
    fireEvent.change(within(form).getByLabelText("Age"), { target: { value: "41" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save my details" }));
    expect(await screen.findByText("Bringing someone?", { exact: false })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "You are all set" })).toBeTruthy();
    expect(callsTo(backend.server, "POST", `${LINK}/party/me`)).toEqual([{ first_name: "Ana", last_name: "Silva", age: 41 }]);
    expect(screen.queryByRole("form", { name: "Add your details" })).toBeNull();
  });
});
