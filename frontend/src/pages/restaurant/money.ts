// Deposit words and amounts, as plain functions so the diner's pages, the staff floor and the
// tests all say the same thing. Amounts are whole cents; the euro sign comes first, like the
// sentences the server writes ("€20 per person").
import type { PaymentSummary } from "../../api/restaurant";

/** 1250 -> "€12.50", 2000 -> "€20", 1 -> "€0.01". */
export function formatEuros(cents: number): string {
  const euros = Math.floor(Math.abs(cents) / 100);
  const rest = Math.abs(cents) % 100;
  const sign = cents < 0 ? "-" : "";
  return rest === 0 ? `${sign}€${euros}` : `${sign}€${euros}.${String(rest).padStart(2, "0")}`;
}

/** One line about a deposit, for the staff card and the manage page. */
export function depositStatus(payment: PaymentSummary): string {
  switch (payment.status) {
    case "pending":
      return `Waiting for the ${formatEuros(payment.amount_cents)} deposit`;
    case "paid":
      return `Deposit paid: ${formatEuros(payment.amount_cents)}`;
    case "refunded":
      return `Deposit refunded: ${formatEuros(payment.refunded_cents)}`;
    case "refund_due":
      return `Refund of ${formatEuros(payment.amount_cents - payment.refunded_cents)} on its way`;
    case "kept":
      return `Deposit kept by the restaurant: ${formatEuros(payment.amount_cents)}`;
    case "expired":
      return "Deposit not paid";
  }
}

/** What cancelling does to a paid deposit, in the diner's words. Null when there is nothing to say. */
export function cancelNote(payment: PaymentSummary | null | undefined): string | null {
  if (!payment || payment.status !== "paid") return null;
  const amount = formatEuros(payment.amount_cents);
  return payment.cancel_outcome === "refund"
    ? `You will get your ${amount} deposit back.`
    : `The free cancellation period has ended, so the restaurant keeps your ${amount} deposit.`;
}

/** A short label for the staff list: nothing when the booking never had a deposit. */
export function staffDepositLabel(payment: PaymentSummary | null | undefined): string | null {
  if (!payment) return null;
  switch (payment.status) {
    case "pending":
      return "Waiting for deposit";
    case "paid":
      return `Deposit paid ${formatEuros(payment.amount_cents)}`;
    case "refunded":
      return `Deposit refunded ${formatEuros(payment.refunded_cents)}`;
    case "kept":
      return `Deposit kept ${formatEuros(payment.amount_cents)}`;
    default:
      return null;
  }
}
