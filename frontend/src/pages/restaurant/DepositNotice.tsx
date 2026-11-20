// The deposit, shown before the diner confirms: how much, when it comes back, and one box to tick.
// The words come from the server (it knows the restaurant's time zone and the free-cancellation
// deadline), so this page and the confirmation email can never disagree.
import type { DepositTerms } from "../../api/restaurant";
import { Checkbox } from "../../design/components";
import { formatEuros } from "./money";

interface DepositNoticeProps {
  terms: DepositTerms;
  accepted: boolean;
  onChange: (accepted: boolean) => void;
  /** Shown under the box when the diner tried to book without ticking it. */
  error?: string | null;
  disabled?: boolean;
}

export function DepositNotice({ terms, accepted, onChange, error = null, disabled = false }: DepositNoticeProps) {
  return (
    <section className="rb-deposit" aria-label="Deposit">
      <h4 className="rb-deposit-title">A deposit holds this table</h4>
      <p className="rb-deposit-amount">
        <strong>{formatEuros(terms.total_cents)}</strong> paid now, taken off your bill
      </p>
      <p>{terms.text}</p>
      {terms.payments_mode === "demo" && (
        <p className="rb-deposit-demo" role="note">
          Demo payment: no real money moves.
        </p>
      )}
      <Checkbox
        id="rb-accept-deposit"
        label={terms.accept_text}
        checked={accepted}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {error && (
        <p className="rb-notice rb-notice-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
