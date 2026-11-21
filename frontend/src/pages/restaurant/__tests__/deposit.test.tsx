// The deposit in the booking flow: the terms appear beside the form, must be accepted, and a
// booking that needs a deposit sends the diner to the payment page instead of "confirmed".
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BookingPage from "../BookingPage";
import { CONFIRMATION, INFO, SLOTS, VENUE, dinerMap, heldTable } from "./fixtures";
import { apiError, callsTo, mockApi } from "./mockApi";

const API = `/api/r/${VENUE}`;

const TERMS = {
  mode: "deposit",
  per_person_cents: 1000,
  total_cents: 4000,
  cancel_hours: 24,
  cancel_deadline: "2030-05-01T18:30:00+00:00",
  text: "A deposit of €10 per person (€40 for your party of 4) is paid now and comes off your bill. You can cancel for free until Wed 1 May, 19:30. After that, the restaurant keeps the deposit.",
  accept_text: "I agree to pay the deposit and to the cancellation rule.",
  payments_mode: "demo",
};

const SEATS = { tables: [], seats: [] };

const WITH_PAYMENT = {
  ...CONFIRMATION,
  booking: { ...CONFIRMATION.booking, status: "pending" },
  payment: { required: true, payment_id: "pay-1", next_url: "/pay/demo/pay-1", amount_cents: 4000, expires_at: "2030-05-01T12:30:00+00:00" },
};

function routes(extra: Record<string, () => unknown> = {}) {
  return {
    [`GET ${API}`]: () => INFO,
    [`GET ${API}/slots`]: () => SLOTS,
    [`GET ${API}/map`]: () => dinerMap(),
    [`POST ${API}/hold`]: () => heldTable(7, "7"),
    [`GET ${API}/seats`]: () => SEATS,
    [`GET ${API}/policy`]: () => TERMS,
    [`POST ${API}/bookings`]: () => WITH_PAYMENT,
    ...extra,
  };
}

function renderBooking(): void {
  render(
    <MemoryRouter initialEntries={[`/r/${VENUE}`]}>
      <Routes>
        <Route path="/r/:venueId" element={<BookingPage />} />
        <Route path="/pay/demo/:paymentId" element={<p>The demo payment page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function holdTable7(): Promise<HTMLElement> {
  renderBooking();
  fireEvent.click(await screen.findByRole("button", { name: "See free times" }));
  fireEvent.click(await screen.findByRole("button", { name: /19:30/ }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a table at 19:30" }));
  await screen.findByRole("heading", { name: "Choose your table" });
  fireEvent.click(screen.getByRole("button", { name: "Hold 7 & continue" }));
  await screen.findByRole("timer");
  return screen.getByRole("form", { name: "Your details" });
}

function fillIn(panel: HTMLElement): void {
  fireEvent.change(within(panel).getByLabelText("Name for the booking"), { target: { value: "Ana Pereira" } });
  fireEvent.change(within(panel).getByLabelText("Email"), { target: { value: "ana@example.com" } });
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("The deposit terms", () => {
  it("are shown beside the form, with the amount on the button", async () => {
    mockApi(routes());
    const panel = await holdTable7();
    const notice = await within(panel).findByRole("region", { name: "Deposit" });
    expect(within(notice).getByText("€40")).toBeTruthy();
    expect(within(notice).getByText(/keeps the deposit/)).toBeTruthy();
    expect(within(notice).getByText("Demo payment: no real money moves.")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: /Pay €40 deposit/ })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: /Confirm booking/ })).toBeNull();
  });

  it("must be accepted: booking without ticking the box sends nothing and focuses the box", async () => {
    const calls = mockApi(routes());
    const panel = await holdTable7();
    await within(panel).findByRole("region", { name: "Deposit" });
    fillIn(panel);
    fireEvent.click(within(panel).getByRole("button", { name: /Pay €40 deposit/ }));
    expect(await within(panel).findByText("Please accept the deposit terms to book this table.")).toBeTruthy();
    expect(callsTo(calls, "POST", `${API}/bookings`)).toHaveLength(0);
    expect(document.activeElement).toBe(within(panel).getByRole("checkbox"));
  });

  it("accepted: the booking asks for the deposit and the diner is taken to the payment page", async () => {
    const calls = mockApi(routes());
    const panel = await holdTable7();
    await within(panel).findByRole("region", { name: "Deposit" });
    fillIn(panel);
    fireEvent.click(within(panel).getByRole("checkbox"));
    fireEvent.click(within(panel).getByRole("button", { name: /Pay €40 deposit/ }));
    expect(await screen.findByText("The demo payment page")).toBeTruthy();
    const body = callsTo(calls, "POST", `${API}/bookings`)[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ hold_id: "hold-token-41", accept_policy: true });
    // The manage link waits in this tab, never in the payment page's address.
    const kept = JSON.parse(sessionStorage.getItem("seatplan.pendingBooking.pay-1") ?? "null") as { manageUrl: string; email: string };
    expect(kept).toEqual({ manageUrl: "/b/tok123", email: "ana@example.com" });
  });

  it("a restaurant without a deposit books exactly as before", async () => {
    const calls = mockApi(routes({ [`GET ${API}/policy`]: () => ({ mode: "none" }), [`POST ${API}/bookings`]: () => CONFIRMATION }));
    const panel = await holdTable7();
    expect(within(panel).queryByRole("region", { name: "Deposit" })).toBeNull();
    fillIn(panel);
    fireEvent.click(within(panel).getByRole("button", { name: "Confirm booking" }));
    expect(await screen.findByRole("heading", { name: "Booking confirmed." })).toBeTruthy();
    const body = callsTo(calls, "POST", `${API}/bookings`)[0]?.body as Record<string, unknown>;
    expect(body.accept_policy).toBeUndefined();
  });

  it("if the terms could not be loaded, the server's refusal brings them back and keeps the hold", async () => {
    let asked = 0;
    const calls = mockApi(
      routes({
        [`GET ${API}/policy`]: () => {
          asked += 1;
          return asked === 1 ? apiError(500, "internal", "later") : TERMS;
        },
        [`POST ${API}/bookings`]: () => apiError(422, "policy_not_accepted", "Please accept the deposit terms to book this table."),
      }),
    );
    const panel = await holdTable7();
    fillIn(panel);
    // No terms on screen yet, so the diner books; the server says a deposit applies.
    fireEvent.click(within(panel).getByRole("button", { name: "Confirm booking" }));
    expect(await within(panel).findByRole("region", { name: "Deposit" })).toBeTruthy();
    await waitFor(() => expect(callsTo(calls, "GET", `${API}/policy`).length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText(/Your hold on table 7 ended/)).toBeNull();
  });
});
