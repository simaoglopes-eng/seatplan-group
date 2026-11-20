import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, clearSessionToken, getMe } from "../api/client";
import type { EventSummary } from "../api/events";
import { getListing } from "../api/venueDirectory";
import type { Listing } from "../api/venueDirectory";
import { PageShell } from "../design/components";
import { placeLine } from "./directory/directoryModel";
import "./organiser-dashboard.css";

type NewEvent = EventSummary & { public_id: string; venue_id: string };

export default function OrganiserDashboard() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<NewEvent[]>([]);
  const [name, setName] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  // Where it happens: filled from the directory listing, or typed for a place we do not list.
  const [placeName, setPlaceName] = useState("");
  const [placeAddress, setPlaceAddress] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<NewEvent | null>(null);
  // "Plan an event here" from the venue directory: ?at=<listing id> names the venue.
  const [params] = useSearchParams();
  const location = useLocation();
  const at = params.get("at");
  const [venue, setVenue] = useState<Listing | null>(null);
  useEffect(() => {
    if (!at) return;
    let active = true;
    getListing(at).then(
      (listing) => {
        if (!active) return;
        setVenue(listing);
        setName((current) => current || `Event at ${listing.name}`.slice(0, 120));
        setPlaceName((current) => current || listing.name.slice(0, 120));
        setPlaceAddress((current) => current || [listing.street, placeLine(listing)].filter(Boolean).join(", ").slice(0, 200));
      },
      () => undefined, // An unknown venue just means no banner.
    );
    return () => { active = false; };
  }, [at]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        await getMe();
        const list = await api.get<NewEvent[]>("/events");
        if (active) setEvents(list);
      } catch (caught) {
        if (!active) return;
        if (caught instanceof ApiError && caught.status === 401) navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
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
      const result = await api.post<NewEvent>("/events/create-with-venue", { name: name.trim(), starts_at: start.toISOString(), ends_at: end.toISOString(), venue_name: placeName.trim() || undefined, venue_address: placeAddress.trim() || undefined });
      setCreated(result); setEvents((previous) => [...previous, result]); setName(""); setStarts(""); setEnds(""); setPlaceName(""); setPlaceAddress("");
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "Your event could not be created. Please try again."); }
    finally { setBusy(false); }
  }

  return <PageShell title="Your organiser space" headerActions={<button className="btn btn-ghost dashboard-signout" onClick={() => { clearSessionToken(); navigate("/"); }}>Sign out</button>}>
    <section className="organiser-dashboard">
    <div className="dashboard-content"><p className="dashboard-kicker">YOUR ORGANISER SPACE</p><h1>Gather people <em>beautifully.</em></h1><p className="dashboard-intro">Create an event, arrange your tables and invite your guests.</p>
      {venue && <section className="dashboard-created dashboard-venue" aria-label="Chosen venue"><strong>Planning at {venue.name}</strong><p>{venue.kind_label} · {placeLine(venue)}. Create the event below, then draw this room’s tables in the floor plan.</p><Link to="/directory">Choose another venue →</Link></section>}
      {error && <p className="dashboard-error" role="alert">{error}</p>}
      {created && <section className="dashboard-created" aria-live="polite"><strong>“{created.name}” is ready to plan.</strong><p>Start by arranging your tables and seats.</p><Link to={`/editor/${encodeURIComponent(created.venue_id)}`}>Arrange the floor plan →</Link><Link to={`/organiser/${encodeURIComponent(created.public_id)}`}>Open event →</Link></section>}
      <div className="dashboard-grid"><section className="dashboard-card"><span className="dashboard-label">01 / NEW EVENT</span><h2>Let’s make a plan.</h2><p>Give your event a name, say where it is and choose when it takes place.</p><form onSubmit={create}><label>Event name<input value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="e.g. Emma & Alex’s wedding" required /></label><fieldset className="dashboard-place"><legend>Where</legend><p className="dashboard-hint">{venue ? "From the venue directory. You can change it." : <>Any place, even one that is not in <Link to="/directory">our directory</Link>: a house, a garden, a restaurant. It stays private and is not added to the public directory.</>}</p><label>Venue name<input value={placeName} onChange={e => setPlaceName(e.target.value)} maxLength={120} placeholder="e.g. Quinta do Vale, or Grandma’s garden" autoComplete="off" /></label><label>Address or town<input value={placeAddress} onChange={e => setPlaceAddress(e.target.value)} maxLength={200} placeholder="e.g. Rua das Flores 12, Sintra" autoComplete="off" /></label></fieldset><label>Starts<input type="datetime-local" value={starts} onChange={e => setStarts(e.target.value)} required /></label><label>Ends<input type="datetime-local" value={ends} onChange={e => setEnds(e.target.value)} required /></label><button type="submit" disabled={busy}>{busy ? "Creating…" : "Create event →"}</button></form></section>
      <section className="dashboard-card dashboard-list"><span className="dashboard-label">02 / YOUR EVENTS</span><h2>All your gatherings.</h2>{loading ? <p>Loading your events…</p> : events.length === 0 ? <p>Your events will appear here once you create one.</p> : <ul>{events.map(item => <li key={item.public_id}><div><strong>{item.name}</strong><small>{new Date(item.starts_at).toLocaleString()}</small></div><div><Link to={`/organiser/${encodeURIComponent(item.public_id)}`}>Open event →</Link><Link to={`/editor/${encodeURIComponent(item.venue_id)}`}>Edit floor plan →</Link></div></li>)}</ul>}</section></div></div>
    </section>
  </PageShell>;
}
