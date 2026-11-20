// The owner's deposit rules: per service, how much each guest puts down and how long before the
// booking a cancellation is still free. Nothing here moves money: guests pay on the payment
// provider's page (or on a clearly labelled demo page while no provider is connected).
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getPaymentSettings, savePaymentSettings } from "../../api/payments";
import type { DepositRule, PaymentSettings } from "../../api/payments";
import { Button, ErrorState, Field, Select, Skeleton, useToast } from "../../design/components";
import { errorMessage } from "../restaurant/format";
import { formatEuros } from "../restaurant/money";
import { useLoad } from "../restaurant/useLoad";
import { OwnerShell } from "./OwnerShell";
import { euroCents } from "./menuPrice";
import "./owner.css";

interface Row {
  key: number;
  service_name: string;
  price: string;
  cancel_hours: number;
  min_party: number;
}

/** "12.50" for 1250, "20" for 2000: what the owner types, not what a guest reads. */
function priceText(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

function rowsOf(rules: DepositRule[]): Row[] {
  return rules.map((rule, key) => ({ key, service_name: rule.service_name, price: priceText(rule.per_person_cents), cancel_hours: rule.cancel_hours, min_party: rule.min_party }));
}

/** Why a row cannot be saved, in the owner's words; null when it can. */
export function rowProblem(row: Row, settings: Pick<PaymentSettings, "minimum_cents" | "max_per_person_cents">): string | null {
  const cents = euroCents(row.price);
  if (cents === null) return "Enter the deposit as an amount in euros, for example 20 or 12.50.";
  if (cents < settings.minimum_cents) return `The deposit must be at least ${formatEuros(settings.minimum_cents)} per person.`;
  if (cents > settings.max_per_person_cents) return `The deposit can be at most ${formatEuros(settings.max_per_person_cents)} per person.`;
  return null;
}

export default function PaymentsPage() {
  const { venueId = "" } = useParams();
  const { state, reload, setData } = useLoad(() => getPaymentSettings(venueId), venueId);
  return (
    <OwnerShell title="Deposits" venueId={venueId} current="payments">
      <div className="ow-page-head">
        <div>
          <h1 className="ow-title">Deposits</h1>
          <p className="rb-muted">Ask guests for a deposit that comes off their bill, to protect your tables from no-shows.</p>
        </div>
      </div>
      {state.status === "loading" && <Skeleton label="Loading your deposit rules" lines={4} />}
      {state.status === "error" && <ErrorState message="Could not open your deposit rules. Check your sign-in or retry." onRetry={() => reload()} />}
      {state.status === "ready" && <DepositForm key={venueId} venueId={venueId} settings={state.data} onSaved={setData} />}
    </OwnerShell>
  );
}

function ModeNotice({ settings }: { settings: PaymentSettings }) {
  if (!settings.available) {
    return (
      <p className="rb-notice rb-notice-warning" role="status">
        <strong>Deposits are not available yet.</strong> Online payments are not connected for this restaurant, so guests cannot be asked for a deposit. Once payments are connected,
        you will set the rules here.
      </p>
    );
  }
  if (settings.payments_mode === "demo") {
    return (
      <p className="rb-notice" role="status">
        <strong>Demo payments.</strong> Guests see a pretend payment page and no real money moves. Real payments are switched on separately, and this page stays the same.
      </p>
    );
  }
  if (settings.payments_mode === "test") {
    return (
      <p className="rb-notice" role="status">
        <strong>Test mode.</strong> Payments use test cards only, so no real money moves.
      </p>
    );
  }
  return null;
}

function DepositForm({ venueId, settings, onSaved }: { venueId: string; settings: PaymentSettings; onSaved: (settings: PaymentSettings) => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(() => rowsOf(settings.policies));
  const [next, setNext] = useState(settings.policies.length);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setRows(rowsOf(settings.policies));
  }, [settings.policies]);
  const change = (key: number, patch: Partial<Row>): void => setRows(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const taken = new Set(rows.map((row) => row.service_name));
  const add = (): void => {
    const free = ["", ...settings.services].find((name) => !taken.has(name));
    if (free === undefined) return;
    setRows([...rows, { key: next, service_name: free, price: "", cancel_hours: settings.cancel_hours.includes(24) ? 24 : (settings.cancel_hours[0] ?? 24), min_party: 1 }]);
    setNext(next + 1);
  };
  const save = async (): Promise<void> => {
    setShown(true);
    setProblem(null);
    if (rows.some((row) => rowProblem(row, settings))) return;
    setBusy(true);
    try {
      const rules: DepositRule[] = rows.map((row) => ({ service_name: row.service_name, per_person_cents: euroCents(row.price) ?? 0, cancel_hours: row.cancel_hours, min_party: row.min_party }));
      const saved = await savePaymentSettings(venueId, rules);
      onSaved(saved);
      setShown(false);
      toast.show(rules.length === 0 ? "Deposits are switched off." : "Deposit rules saved.", "success");
    } catch (error) {
      setProblem(errorMessage(error, "We could not save the deposit rules. Please try again."));
    } finally {
      setBusy(false);
    }
  };
  const serviceOptions = (current: string) => [
    { value: "", label: "All other services" },
    ...settings.services.map((name) => ({ value: name, label: name })),
  ].filter((option) => option.value === current || !taken.has(option.value));
  const canAdd = ["", ...settings.services].some((name) => !taken.has(name));
  return (
    <>
      <ModeNotice settings={settings} />
      <section className="owner-card" aria-label="Deposit rules">
        <div className="owner-card-body">
          {rows.length === 0 && <p>No deposit: guests book without paying anything up front.</p>}
          {rows.map((row, index) => {
            const error = shown ? rowProblem(row, settings) : null;
            return (
              <fieldset key={row.key} className="ow-rule" disabled={!settings.available}>
                <legend>Rule {index + 1}</legend>
                <Select label="Applies to" value={row.service_name} options={serviceOptions(row.service_name)} onChange={(event) => change(row.key, { service_name: event.target.value })} />
                <Field label="Deposit per person (€)" inputMode="decimal" value={row.price} error={error} placeholder="e.g. 10" onChange={(event) => change(row.key, { price: event.target.value })} />
                <Select
                  label="Free cancellation until"
                  value={String(row.cancel_hours)}
                  options={settings.cancel_hours.map((hours) => ({ value: String(hours), label: `${hours} hours before` }))}
                  onChange={(event) => change(row.key, { cancel_hours: Number(event.target.value) })}
                />
                <Field label="From a party of" type="number" min={1} max={20} value={String(row.min_party)} onChange={(event) => change(row.key, { min_party: Math.min(20, Math.max(1, Number(event.target.value) || 1)) })} />
                <Button variant="ghost" onClick={() => setRows(rows.filter((other) => other.key !== row.key))}>
                  Remove rule {index + 1}
                </Button>
              </fieldset>
            );
          })}
          {problem && (
            <p className="rb-notice rb-notice-error" role="alert">
              {problem}
            </p>
          )}
          <div className="rb-actions">
            <Button variant="secondary" disabled={!settings.available || !canAdd} onClick={add}>
              Add a rule
            </Button>
            <Button busy={busy} disabled={!settings.available} onClick={() => void save()}>
              Save deposit rules
            </Button>
          </div>
          <p className="rb-muted">
            A guest sees the rule before booking and ticks a box to accept it. If they cancel before the free-cancellation time they get everything back. After it, you keep the deposit.
            If you cancel, they always get it back.
          </p>
        </div>
      </section>
    </>
  );
}
