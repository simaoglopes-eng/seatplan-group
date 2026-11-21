import { useState, type FormEvent } from "react";

export function AgeProfile({ birthDate, shareAge, busy, onSave }: {
  birthDate: string | null; shareAge: boolean; busy: boolean;
  onSave: (birthDate: string | null, shareAge: boolean) => void;
}) {
  const [date, setDate] = useState(birthDate ?? "");
  const [share, setShare] = useState(shareAge);
  const submit = (event: FormEvent) => { event.preventDefault(); onSave(date || null, date ? share : false); };
  return <details className="ev-card">
    <summary>Age and privacy preferences</summary>
    <p>Add your date of birth to get suggestions near people of a similar age. Your date of birth is never shown to other participants.</p>
    <form onSubmit={submit}>
      <label>Date of birth <input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={e => setDate(e.target.value)} /></label>
      <label style={{display: "block", margin: "1rem 0"}}><input type="checkbox" checked={share} disabled={!date} onChange={e => setShare(e.target.checked)} /> Show my age to other participants where event privacy allows it</label>
      <button className="btn btn-secondary" type="submit" disabled={busy}>Save preferences</button>
    </form>
  </details>;
}
