import { useState, type FormEvent } from "react";

export function NameProfile({ firstName, lastName, currentName, busy, onSave }: {
  firstName: string; lastName: string; currentName: string; busy: boolean;
  onSave: (firstName: string, lastName: string) => void;
}) {
  const [first, setFirst] = useState(firstName);
  const [last, setLast] = useState(lastName);
  const submit = (event: FormEvent) => { event.preventDefault(); onSave(first, last); };
  return <details className="ev-card">
    <summary>Your name for this event</summary>
    <p>Your current name is {currentName}. Other people see it according to the event privacy settings.</p>
    <form onSubmit={submit}>
      <label>First name <input required maxLength={60} value={first} onChange={e => setFirst(e.target.value)} autoComplete="given-name" /></label>
      <label>Last name <input required maxLength={59} value={last} onChange={e => setLast(e.target.value)} autoComplete="family-name" /></label>
      <button className="btn btn-secondary" type="submit" disabled={busy}>Save name</button>
    </form>
  </details>;
}
