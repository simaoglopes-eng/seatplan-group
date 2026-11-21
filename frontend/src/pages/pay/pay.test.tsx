// The payment pages: the pretend demo page, and the page every payment sends the diner back to.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, callsTo, mockApi } from "../restaurant/__tests__/mockApi";
import { BOOKING } from "../restaurant/__tests__/fixtures";
import DemoCheckoutPage from "./DemoCheckoutPage";
import PaymentReturnPage from "./PaymentReturnPage";
import { forgetPendingBooking, manageToken, recallPendingBooking, rememberPendingBooking } from "./pendingBooking";

const FUTURE = new Date(Date.now() + 20 * 60 * 1000).toISOString();

function payment(over: Record<string, unknown> = {}) {
  return {
    status: "pending",
    booking_status: "pending",
    amount_cents: 4000,
    expires_at: FUTURE,
    restaurant: "Casa Linho",
    restaurant_slug: "casa-linho",
    mode: "demo",
    ...over,
  };
}

function open(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/pay/demo/:paymentId" element={<DemoCheckoutPage />} />
        <Route path="/pay/return/:paymentId" element={<PaymentReturnPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the demo payment page", () => {
  it("says plainly that no money moves, and shows the amount", async () => {
    mockApi({ "GET /api/payments/p1": () => payment() });
    open("/pay/demo/p1");
    expect(await screen.findByText(/No real money moves and no card is needed/)).toBeTruthy();
    expect(screen.getByText("€40")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pay €40 (demo)" })).toBeTruthy();
  });

  it("paying sends the outcome and goes back to the result page", async () => {
    // A server that remembers: once paid, every later answer says paid.
    let now = payment();
    const calls = mockApi({
      "GET /api/payments/p1": () => now,
      "POST /api/payments/demo/p1": () => {
        now = payment({ status: "paid", booking_status: "confirmed" });
        return { ...now, declined: false };
      },
    });
    open("/pay/demo/p1");
    fireEvent.click(await screen.findByRole("button", { name: "Pay €40 (demo)" }));
    expect(await screen.findByRole("heading", { name: "Deposit paid. Booking confirmed." })).toBeTruthy();
    expect(callsTo(calls, "POST", "/api/payments/demo/p1")[0]?.body).toEqual({ outcome: "ok" });
  });

  it("a declined card keeps the table and lets the diner try again", async () => {
    mockApi({
      "GET /api/payments/p1": () => payment(),
      "POST /api/payments/demo/p1": () => payment({ declined: true }),
    });
    open("/pay/demo/p1");
    fireEvent.click(await screen.findByRole("button", { name: "Simulate a declined card" }));
    expect(await screen.findByText(/The pretend card was declined/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pay €40 (demo)" })).toBeTruthy();
  });

  it("giving up releases the table and shows that it was not kept", async () => {
    let now = payment();
    const calls = mockApi({
      "GET /api/payments/p1": () => now,
      "POST /api/payments/p1/abandon": () => {
        now = payment({ status: "expired", booking_status: "cancelled" });
        return now;
      },
    });
    open("/pay/demo/p1");
    fireEvent.click(await screen.findByRole("button", { name: "Give up and release the table" }));
    expect(await screen.findByRole("heading", { name: "We did not keep your table" })).toBeTruthy();
    expect(callsTo(calls, "POST", "/api/payments/p1/abandon")).toHaveLength(1);
  });

  it("is not a payment page when real payments are on", async () => {
    mockApi({ "GET /api/payments/p1": () => payment({ mode: "stripe" }) });
    open("/pay/demo/p1");
    expect(await screen.findByText("This is not a demo payment")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Pay/ })).toBeNull();
  });

  it("an unknown payment says so", async () => {
    mockApi({ "GET /api/payments/nope": () => apiError(404, "not_found", "Payment not found.") });
    open("/pay/demo/nope");
    expect(await screen.findByText("We cannot find this payment")).toBeTruthy();
  });
});

describe("the return page", () => {
  it("shows the confirmation of a paid booking, using the link kept in this tab, and then forgets it", async () => {
    rememberPendingBooking("p1", { manageUrl: "/b/tok123", email: "ana@example.com" });
    mockApi({
      "GET /api/payments/p1": () => payment({ status: "paid", booking_status: "confirmed" }),
      "GET /api/b/tok123": () => ({ ...BOOKING, status: "confirmed" }),
    });
    open("/pay/return/p1");
    expect(await screen.findByRole("heading", { name: "Booking confirmed." })).toBeTruthy();
    expect(screen.getByText("ana@example.com")).toBeTruthy();
    expect(recallPendingBooking("p1")).toBeNull();
  });

  it("paid but without the link (another tab or blocked storage) still says it is confirmed", async () => {
    mockApi({ "GET /api/payments/p1": () => payment({ status: "paid", booking_status: "confirmed" }) });
    open("/pay/return/p1");
    expect(await screen.findByRole("heading", { name: "Deposit paid. Booking confirmed." })).toBeTruthy();
    expect(screen.getByText(/confirmation email/)).toBeTruthy();
  });

  it("while the provider has not confirmed yet, it keeps checking and says so", async () => {
    const calls = mockApi({ "GET /api/payments/p1": () => payment() });
    open("/pay/return/p1");
    expect(await screen.findByRole("heading", { name: "Confirming your payment…" })).toBeTruthy();
    expect(callsTo(calls, "GET", "/api/payments/p1").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("heading", { name: /Booking confirmed/ })).toBeNull();
  });

  it("an expired payment offers to book again at the same restaurant and never claims a booking", async () => {
    mockApi({ "GET /api/payments/p1": () => payment({ status: "expired", booking_status: "cancelled" }) });
    open("/pay/return/p1");
    expect(await screen.findByRole("heading", { name: "We did not keep your table" })).toBeTruthy();
    expect(screen.getByText(/Nothing was charged/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Book another table at Casa Linho" }).getAttribute("href")).toBe("/restaurants/casa-linho");
  });

  it("money that arrived too late is called a refund, not a booking", async () => {
    mockApi({ "GET /api/payments/p1": () => payment({ status: "refunded", booking_status: "cancelled" }) });
    open("/pay/return/p1");
    expect(await screen.findByText(/we gave the table back and are refunding your €40/)).toBeTruthy();
  });
});

describe("the tab's memory of a booking", () => {
  it("remembers and forgets", () => {
    expect(recallPendingBooking("x")).toBeNull();
    rememberPendingBooking("x", { manageUrl: "/b/abc", email: "a@b.pt" });
    expect(recallPendingBooking("x")).toEqual({ manageUrl: "/b/abc", email: "a@b.pt" });
    forgetPendingBooking("x");
    expect(recallPendingBooking("x")).toBeNull();
  });

  it("ignores something that is not a saved booking", () => {
    sessionStorage.setItem("seatplan.pendingBooking.y", JSON.stringify({ manageUrl: 5 }));
    expect(recallPendingBooking("y")).toBeNull();
    sessionStorage.setItem("seatplan.pendingBooking.z", "not json");
    expect(recallPendingBooking("z")).toBeNull();
  });

  it("copes when the browser blocks storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => rememberPendingBooking("w", { manageUrl: "/b/t", email: "e@e.pt" })).not.toThrow();
    expect(recallPendingBooking("w")).toBeNull();
    vi.restoreAllMocks();
  });

  it("reads the token out of the manage link", () => {
    expect(manageToken("/b/tok123")).toBe("tok123");
    expect(manageToken("/b/a%20b")).toBe("a b");
    expect(manageToken("")).toBeNull();
  });
});
