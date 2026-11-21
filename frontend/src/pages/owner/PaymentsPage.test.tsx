// The owner's deposit rules: what is shown in each mode, and what is sent on save.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaymentSettings } from "../../api/payments";
import { apiError, callsTo, mockApi } from "../restaurant/__tests__/mockApi";
import PaymentsPage, { rowProblem } from "./PaymentsPage";

const SETTINGS: PaymentSettings = {
  payments_mode: "demo",
  available: true,
  minimum_cents: 1,
  max_per_person_cents: 15000,
  cancel_hours: [2, 6, 12, 24, 48, 72],
  services: ["Dinner", "Lunch"],
  policies: [],
};

const URL = "/api/owner/restaurants/v1/payments";

function open(): void {
  render(
    <MemoryRouter initialEntries={["/owner/v1/payments"]}>
      <Routes>
        <Route path="/owner/:venueId/payments" element={<PaymentsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("rowProblem", () => {
  const limits = { minimum_cents: 50, max_per_person_cents: 15000 };
  const row = (price: string) => ({ key: 0, service_name: "", price, cancel_hours: 24, min_party: 1 });
  it("accepts euros with a dot or a comma", () => {
    expect(rowProblem(row("20"), limits)).toBeNull();
    expect(rowProblem(row("12,50"), limits)).toBeNull();
    expect(rowProblem(row("0.50"), limits)).toBeNull();
  });
  it("explains what is wrong", () => {
    expect(rowProblem(row(""), limits)).toContain("amount in euros");
    expect(rowProblem(row("abc"), limits)).toContain("amount in euros");
    expect(rowProblem(row("0.49"), limits)).toBe("The deposit must be at least €0.50 per person.");
    expect(rowProblem(row("151"), limits)).toBe("The deposit can be at most €150 per person.");
  });
});

describe("the deposits page", () => {
  it("starts with no deposit and says what the demo mode means", async () => {
    mockApi({ [`GET ${URL}`]: () => SETTINGS });
    open();
    expect(await screen.findByText(/guests book without paying anything up front/)).toBeTruthy();
    expect(screen.getByText(/Demo payments\./)).toBeTruthy();
  });

  it("adds a rule and saves it as cents", async () => {
    const calls = mockApi({
      [`GET ${URL}`]: () => SETTINGS,
      [`PUT ${URL}`]: () => ({ ...SETTINGS, policies: [{ service_name: "Dinner", per_person_cents: 1250, cancel_hours: 24, min_party: 2 }] }),
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Add a rule" }));
    const rule = screen.getByRole("group", { name: "Rule 1" });
    fireEvent.change(within(rule).getByLabelText("Applies to"), { target: { value: "Dinner" } });
    fireEvent.change(within(rule).getByLabelText("Deposit per person (€)"), { target: { value: "12.50" } });
    fireEvent.change(within(rule).getByLabelText("From a party of"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save deposit rules" }));
    expect(await screen.findByDisplayValue("12.50")).toBeTruthy();
    const body = callsTo(calls, "PUT", URL)[0]?.body;
    expect(body).toEqual({ policies: [{ service_name: "Dinner", per_person_cents: 1250, cancel_hours: 24, min_party: 2 }] });
  });

  it("does not send a rule with a bad amount, and says why next to it", async () => {
    const calls = mockApi({ [`GET ${URL}`]: () => SETTINGS });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Add a rule" }));
    fireEvent.change(screen.getByLabelText("Deposit per person (€)"), { target: { value: "lots" } });
    fireEvent.click(screen.getByRole("button", { name: "Save deposit rules" }));
    expect(await screen.findByText(/Enter the deposit as an amount in euros/)).toBeTruthy();
    expect(callsTo(calls, "PUT", URL)).toHaveLength(0);
  });

  it("saving with no rules switches deposits off", async () => {
    const calls = mockApi({
      [`GET ${URL}`]: () => ({ ...SETTINGS, policies: [{ service_name: "", per_person_cents: 1000, cancel_hours: 24, min_party: 1 }] }),
      [`PUT ${URL}`]: () => SETTINGS,
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Remove rule 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save deposit rules" }));
    expect(await screen.findByText(/guests book without paying anything up front/)).toBeTruthy();
    expect(callsTo(calls, "PUT", URL)[0]?.body).toEqual({ policies: [] });
  });

  it("shows the server's refusal", async () => {
    mockApi({
      [`GET ${URL}`]: () => SETTINGS,
      [`PUT ${URL}`]: () => apiError(422, "validation", "Choose one of the free-cancellation windows offered."),
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Add a rule" }));
    fireEvent.change(screen.getByLabelText("Deposit per person (€)"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save deposit rules" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Choose one of the free-cancellation windows offered.")).toBeTruthy();
  });

  it("is switched off, with the reason, until online payments are connected", async () => {
    mockApi({ [`GET ${URL}`]: () => ({ ...SETTINGS, available: false }) });
    open();
    expect(await screen.findByText("Deposits are not available yet.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add a rule" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save deposit rules" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not offer a second rule for a service that already has one", async () => {
    mockApi({
      [`GET ${URL}`]: () => ({
        ...SETTINGS,
        services: ["Dinner"],
        policies: [
          { service_name: "", per_person_cents: 500, cancel_hours: 24, min_party: 1 },
          { service_name: "Dinner", per_person_cents: 1000, cancel_hours: 24, min_party: 1 },
        ],
      }),
    });
    open();
    const add = await screen.findByRole("button", { name: "Add a rule" });
    expect((add as HTMLButtonElement).disabled).toBe(true);
  });
});
