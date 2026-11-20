// Remembers, in this browser tab only, which booking a payment belongs to.
//
// The diner leaves SeatPlan to pay and comes back to /pay/return/<payment id>. That address
// carries the payment id and nothing else, on purpose: the secret manage link must never be
// sent to the payment provider. So the tab keeps the link meanwhile, and forgets it once the
// confirmation is on screen. If the storage is blocked (private windows), nothing breaks:
// the return page then says to use the link in the confirmation email.

export interface PendingBooking {
  /** "/b/<token>", the diner's manage link. */
  manageUrl: string;
  email: string;
}

const key = (paymentId: string): string => `seatplan.pendingBooking.${paymentId}`;

export function rememberPendingBooking(paymentId: string, booking: PendingBooking): void {
  try {
    sessionStorage.setItem(key(paymentId), JSON.stringify(booking));
  } catch {
    // Storage is blocked: the return page copes without it.
  }
}

export function recallPendingBooking(paymentId: string): PendingBooking | null {
  try {
    const raw = sessionStorage.getItem(key(paymentId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingBooking>;
    return typeof value.manageUrl === "string" && typeof value.email === "string" ? { manageUrl: value.manageUrl, email: value.email } : null;
  } catch {
    return null;
  }
}

export function forgetPendingBooking(paymentId: string): void {
  try {
    sessionStorage.removeItem(key(paymentId));
  } catch {
    // Nothing to forget.
  }
}

/** "/b/<token>" -> "<token>", or null when there is nothing after the last slash. */
export function manageToken(manageUrl: string): string | null {
  const last = manageUrl.split("/").filter(Boolean).pop();
  return last ? decodeURIComponent(last) : null;
}
