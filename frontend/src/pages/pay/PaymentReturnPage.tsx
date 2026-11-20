// Route /pay/return/:paymentId: where the diner lands after the payment page (the demo one, or
// the payment provider's), whatever the result was. It never trusts the address: it asks the
// server where the payment stands, and keeps asking for a little while, because a provider can
// take a moment to confirm. The booking is only shown as confirmed once the server says so.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { getPayment, retryPayment } from "../../api/payments";
import type { PaymentState } from "../../api/payments";
import { getBooking } from "../../api/restaurant";
import { Button, EmptyState, ErrorState, PageShell, Skeleton } from "../../design/components";
import { Confirmation } from "../restaurant/Confirmation";
import { errorMessage } from "../restaurant/format";
import { formatEuros } from "../restaurant/money";
import { useLoad } from "../restaurant/useLoad";
import { forgetPendingBooking, manageToken, recallPendingBooking } from "./pendingBooking";
import "../restaurant/restaurant.css";
import "../restaurant/booking-v5.css";

const POLL_MS = 2500;
// About a minute of asking before we say "still waiting" and offer a button.
const MAX_CHECKS = 24;

type View = { status: "loading" } | { status: "error"; error: unknown } | { status: "ready"; payment: PaymentState };

export default function PaymentReturnPage() {
  const { paymentId = "" } = useParams();
  const [view, setView] = useState<View>({ status: "loading" });
  const [round, setRound] = useState(0);
  const [stillPending, setStillPending] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    setStillPending(false);
    const check = async (count: number): Promise<void> => {
      try {
        const payment = await getPayment(paymentId);
        if (stopped) return;
        setView({ status: "ready", payment });
        if (payment.status !== "pending") return;
        if (count + 1 >= MAX_CHECKS) {
          setStillPending(true);
          return;
        }
        timer = window.setTimeout(() => void check(count + 1), POLL_MS);
      } catch (error) {
        if (!stopped) setView({ status: "error", error });
      }
    };
    void check(0);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [paymentId, round]);

  return (
    <PageShell title="Your payment">
      <div className="rb-page">
        {view.status === "loading" && <Skeleton lines={4} label="Checking your payment" />}
        {view.status === "error" && <PaymentLoadError error={view.error} onRetry={() => setRound(round + 1)} />}
        {view.status === "ready" && <Outcome paymentId={paymentId} payment={view.payment} stillPending={stillPending} onCheckAgain={() => setRound(round + 1)} />}
      </div>
    </PageShell>
  );
}

function PaymentLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (error instanceof ApiError && error.code === "not_found") {
    return (
      <EmptyState title="We cannot find this payment">
        <p>The link may be old or mistyped. If you paid a deposit, your confirmation email has the link to your booking.</p>
      </EmptyState>
    );
  }
  return <ErrorState title="We could not check your payment" message={errorMessage(error)} onRetry={onRetry} />;
}

interface OutcomeProps {
  paymentId: string;
  payment: PaymentState;
  stillPending: boolean;
  onCheckAgain: () => void;
}

function Outcome({ paymentId, payment, stillPending, onCheckAgain }: OutcomeProps) {
  const again = payment.restaurant_slug ? `/restaurants/${encodeURIComponent(payment.restaurant_slug)}` : "/";
  if (payment.status === "paid" || (payment.status === "refund_due" && payment.booking_status === "confirmed")) {
    return <Paid paymentId={paymentId} payment={payment} />;
  }
  if (payment.status === "pending") {
    return <Waiting paymentId={paymentId} payment={payment} stillPending={stillPending} onCheckAgain={onCheckAgain} />;
  }
  const refunded = payment.status === "refunded" || payment.status === "refund_due";
  return (
    <section className="rb-card" aria-label="Payment result">
      <h1 className="rb-title">We did not keep your table</h1>
      <p>
        {refunded
          ? `Your payment arrived after the time to pay had ended, so we gave the table back and are refunding your ${formatEuros(payment.amount_cents)}.`
          : "The time to pay ran out, or you gave it up, so the table went back to the restaurant. Nothing was charged."}
      </p>
      <p>
        <Link className="btn btn-primary" to={again}>
          Book another table at {payment.restaurant}
        </Link>
      </p>
    </section>
  );
}

function Waiting({ paymentId, payment, stillPending, onCheckAgain }: OutcomeProps) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pay = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      const { next_url: next } = await retryPayment(paymentId);
      window.location.assign(next);
    } catch (error) {
      setProblem(errorMessage(error, "We could not reopen the payment page."));
      setBusy(false);
    }
  };
  return (
    <section className="rb-card" aria-label="Payment result">
      <h1 className="rb-title">{stillPending ? "Still waiting for the payment" : "Confirming your payment…"}</h1>
      <p role="status">
        {stillPending
          ? `We have not heard back about your ${formatEuros(payment.amount_cents)} deposit for ${payment.restaurant} yet. If you paid, it can take a moment.`
          : `We are checking your ${formatEuros(payment.amount_cents)} deposit for ${payment.restaurant}.`}
      </p>
      {problem && (
        <p className="rb-notice rb-notice-error" role="alert">
          {problem}
        </p>
      )}
      {stillPending && (
        <div className="rb-actions">
          <Button onClick={onCheckAgain}>Check again</Button>
          <Button variant="secondary" busy={busy} onClick={() => void pay()}>
            Go back to the payment page
          </Button>
        </div>
      )}
    </section>
  );
}

/** Paid: show the confirmation. The manage link was kept in this tab while the diner paid. */
function Paid({ paymentId, payment }: { paymentId: string; payment: PaymentState }) {
  const [pending] = useState(() => recallPendingBooking(paymentId));
  const token = pending ? manageToken(pending.manageUrl) : null;
  const { state } = useLoad(() => (token ? getBooking(token) : Promise.reject(new Error("no link"))), token ?? "none");
  useEffect(() => {
    if (state.status === "ready") forgetPendingBooking(paymentId);
  }, [state.status, paymentId]);
  if (pending && state.status === "ready") {
    return <Confirmation confirmation={{ booking: state.data, manage_url: pending.manageUrl, email: pending.email }} />;
  }
  if (pending && state.status === "loading") return <Skeleton lines={4} label="Loading your booking" />;
  return (
    <section className="rb-card" aria-label="Payment result">
      <h1 className="rb-title">Deposit paid. Booking confirmed.</h1>
      <p>
        Your {formatEuros(payment.amount_cents)} deposit for {payment.restaurant} is paid and your table is reserved. We are sending the confirmation
        email, with the link to manage your booking.
      </p>
    </section>
  );
}
