import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, clearSessionToken, getMe } from "../api/client";
import type { EventSummary } from "../api/events";
import { PageShell } from "../design/components";
import "./organiser-dashboard.css";

type NewEvent = EventSummary & { public_id: string; venue_id: string };

export default function OrganiserDashboard() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<NewEvent[]>([]);
  const [name, setName] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<NewEvent | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        await getMe();
        const list = await api.get<NewEvent[]>("/events");
        if (active) setEvents(list);
      } catch (caught) {
        if (!active) return;
        if (caught instanceof ApiError && caught.status === 401) navigate("/login?next=%2Forganiser", { replace: true });
        else setError("Your events could not be loaded. Please try again later.");
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [navigate]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const start = new Date(starts), end = new Date(ends);
    if (!name.trim() || !Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) || end <= start) {
      setError("Enter a name and an end time later than the start time."); return;
    }
    setBusy(true); setError("");
    try {
      const result = await api.post<NewEvent>("/events/create-with-venue", { name: name.trim(), starts_at: start.toISOString(), ends_at: end.toISOString() });
      setCreated(result); setEvents((previous) => [...previous, result]); setName(""); setStarts(""); setEnds("");
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "Your event could not be created. Please try again."); }
    finally { setBusy(false); }
  }

  return <PageShell title="Your organiser space" headerActions={<button className="btn btn-ghost dashboard-signout" onClick={() => { clearSessionToken(); navigate("/"); }}>Sign out</button>}>
    <section className="organiser-dashboard">
    <div className="dashboard-content"><p className="dashboard-kicker">YOUR ORGANISER SPACE</p><h1>Gather people <em>beautifully.</em></h1><p className="dashboard-intro">Create an event, arrange your tables and invite your guests.</p>
      {error && <p className="dashboard-error" role="alert">{error}</p>}
      {created && <section className="dashboard-created" aria-live="polite"><strong>“{created.name}” is ready to plan.</strong><p>Start by arranging your tables and seats.</p><Link to={`/editor/${encodeURIComponent(created.venue_id)}`}>Arrange the floor plan →</Link><Link to={`/organiser/${encodeURIComponent(created.public_id)}`}>Open event →</Link></section>}
      <div className="dashboard-grid"><section className="dashboard-card"><span className="dashboard-label">01 / NEW EVENT</span><h2>Let’s make a plan.</h2><p>Give your event a name and choose when it takes place.</p><form onSubmit={create}><label>Event name<input value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="e.g. Emma & Alex’s wedding" required /></label><label>Starts<input type="datetime-local" value={starts} onChange={e => setStarts(e.target.value)} required /></label><label>Ends<input type="datetime-local" value={ends} onChange={e => setEnds(e.target.value)} required /></label><button type="submit" disabled={busy}>{busy ? "Creating…" : "Create event →"}</button></form></section>
      <section className="dashboard-card dashboard-list"><span className="dashboard-label">02 / YOUR EVENTS</span><h2>All your gatherings.</h2>{loading ? <p>Loading your events…</p> : events.length === 0 ? <p>Your events will appear here once you create one.</p> : <ul>{events.map(item => <li key={item.public_id}><div><strong>{item.name}</strong><small>{new Date(item.starts_at).toLocaleString()}</small></div><div><Link to={`/organiser/${encodeURIComponent(item.public_id)}`}>Open event →</Link><Link to={`/editor/${encodeURIComponent(item.venue_id)}`}>Edit floor plan →</Link></div></li>)}</ul>}</section></div></div>
    </section>
  </PageShell>;
}
