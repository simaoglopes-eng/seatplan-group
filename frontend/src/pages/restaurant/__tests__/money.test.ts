import { describe, expect, it } from "vitest";
import type { PaymentSummary } from "../../../api/restaurant";
import { cancelNote, depositStatus, formatEuros, staffDepositLabel } from "../money";

function payment(over: Partial<PaymentSummary> = {}): PaymentSummary {
  return {
    kind: "deposit",
    status: "paid",
    amount_cents: 4000,
    per_person_cents: 2000,
    party: 2,
    refunded_cents: 0,
    cancel_hours: 24,
    cancel_deadline: "2026-11-20T19:30:00+00:00",
    cancel_outcome: "refund",
    expires_at: "2026-11-18T20:00:00+00:00",
    policy_text: "",
    mode: "demo",
    ...over,
  };
}

describe("formatEuros", () => {
  it.each([
    [0, "€0"],
    [1, "€0.01"],
    [50, "€0.50"],
    [2000, "€20"],
    [1250, "€12.50"],
    [-1250, "-€12.50"],
  ])("%i cents is %s", (cents, text) => {
    expect(formatEuros(cents)).toBe(text);
  });
});

describe("depositStatus", () => {
  it("says what each state means", () => {
    expect(depositStatus(payment({ status: "pending" }))).toBe("Waiting for the €40 deposit");
    expect(depositStatus(payment())).toBe("Deposit paid: €40");
    expect(depositStatus(payment({ status: "refunded", refunded_cents: 4000 }))).toBe("Deposit refunded: €40");
    expect(depositStatus(payment({ status: "kept" }))).toBe("Deposit kept by the restaurant: €40");
    expect(depositStatus(payment({ status: "expired" }))).toBe("Deposit not paid");
    expect(depositStatus(payment({ status: "refund_due", refunded_cents: 0 }))).toBe("Refund of €40 on its way");
  });
});

describe("cancelNote", () => {
  it("promises the money back inside the free window", () => {
    expect(cancelNote(payment())).toBe("You will get your €40 deposit back.");
  });
  it("is honest that the restaurant keeps it afterwards", () => {
    expect(cancelNote(payment({ cancel_outcome: "keep" }))).toContain("keeps your €40 deposit");
  });
  it("says nothing when there is no paid deposit", () => {
    expect(cancelNote(null)).toBeNull();
    expect(cancelNote(payment({ status: "pending", cancel_outcome: "none" }))).toBeNull();
  });
});

describe("staffDepositLabel", () => {
  it("is empty for a booking without a deposit", () => {
    expect(staffDepositLabel(null)).toBeNull();
    expect(staffDepositLabel(undefined)).toBeNull();
  });
  it("is short enough for a list", () => {
    expect(staffDepositLabel(payment({ status: "pending" }))).toBe("Waiting for deposit");
    expect(staffDepositLabel(payment())).toBe("Deposit paid €40");
  });
});
