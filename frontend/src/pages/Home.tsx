// Route /: the front door. Every tile, count and card is live data, and every link lands on
// a page that honours what it says: country and kind filter the real-venue directory here,
// and "See all" opens /directory with the same filter; "Plan an event here" opens the
// organiser space with that venue named; an occasion opens /events?type=; an event card
// opens its shared link (/j/<token>); a demo room opens its page with a seat map.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getEventTypes, getEventVenues, getPublicEvents } from "../api/eventsPublic";
import type { EventType, EventVenueCard, PublicEvent } from "../api/eventsPublic";
import { EmptyState, ErrorState, PageShell, Skeleton } from "../design/components";
import { SeatMap } from "../seatmap/SeatMap";
import { PublicHeaderActions } from "./discover/PublicHeaderActions";
import { EventCard } from "./events-public/EventCard";
import { VenueCard } from "./events-public/VenueCard";
import { getDirectory, getDirectoryCounts } from "../api/venueDirectory";
import type { DirectoryCountry, DirectoryKind } from "../api/venueDirectory";
import { Chip, Chips } from "./discover/Chips";
import { COUNTRIES, KINDS, directoryHref } from "./directory/directoryModel";
import { Attribution, ListingCard } from "./directory/ListingCard";
import { SAMPLE_RECOMMENDED, buildSampleFloor } from "./homeSample";
import { errorMessage } from "./restaurant/format";
import { useLoad } from "./restaurant/useLoad";
import type { Loaded } from "./restaurant/useLoad";
import "./discover/discover.css";
import "./events-public/events-public.css";
import "./directory/directory.css";
import "./landing.css";

type EventsPage = { items: PublicEvent[]; total: number };

export default function Home() {
  // Three reads, once each: the sections below share them (the public reads share one rate limit).
  const venues = useLoad(() => getEventVenues(null), "landing-venues");
  const types = useLoad(getEventTypes, "event-types");
  const events = useLoad(() => getPublicEvents({ limit: 50 }), "landing-events");
  return (
    <div className="discover-route">
      <PageShell
        title="Find the room, seat every guest"
        width="wide"
        headerActions={<PublicHeaderActions />}
        footerContent={
          <p className="ld-footer-links">
            <Link to="/events/staff">Staff area</Link>
            <Link to="/demo">Live demo</Link>
            <Link to="/login">Organiser sign in</Link>
          </p>
        }
      >
        <Hero />
        <FindVenue />
        <Occasions types={types} events={events} />
        <ComingUp events={events} />
        <DemoRooms venues={venues} types={types} />
        <WaysIn />
      </PageShell>
    </div>
  );
}

function Hero() {
  const floor = useMemo(buildSampleFloor, []);
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <section className="ld-hero" aria-labelledby="ld-hero-title">
      <div className="ld-hero-text">
        <p className="ld-eyebrow">Quintas · Event halls · Conference rooms</p>
        <h1 id="ld-hero-title">Find the room. Seat every guest.</h1>
        <p className="ld-lede">
          Choose a quinta, a hall or a conference room, draw the tables, and send one link. Guests open it and pick their own seat, next to the people they know.
        </p>
        <div className="ld-hero-actions">
          <Link className="btn btn-primary" to="/organiser/register">
            Plan an event
          </Link>
          <Link className="btn btn-secondary" to="/participant">
            I have an invitation
          </Link>
        </div>
        <p className="ld-hero-note">
          Already organising? <Link to="/login">Sign in</Link>
        </p>
      </div>
      <div className="ld-hero-map">
        <SeatMap
          label="Sample room, try choosing a seat"
          tables={floor.tables}
          seats={floor.seats}
          highlight={SAMPLE_RECOMMENDED}
          selectedId={selected}
          onSelect={setSelected}
        />
        <p className="ld-map-note" aria-live="polite">
          {selected === null ? "Try it: tap a free seat. The dashed rings are the planner's suggestions." : "Seat chosen. In a real event, confirming makes it yours."}
        </p>
      </div>
    </section>
  );
}

function FindVenue() {
  const [country, setCountry] = useState<DirectoryCountry | null>(null);
  const [kind, setKind] = useState<DirectoryKind | null>(null);
  const counts = useLoad(getDirectoryCounts, "directory-counts");
  const list = useLoad(() => getDirectory({ country, kind, limit: 6 }), `${country ?? ""}|${kind ?? ""}`);
  const rows = counts.state.status === "ready" ? counts.state.data.items : [];
  const count = (k: DirectoryKind | null, c: DirectoryCountry | null): number =>
    rows.filter((r) => (k === null || r.kind === k) && (c === null || r.country === c)).reduce((sum, r) => sum + r.count, 0);
  const ready = list.state.status === "ready" ? list.state.data : null;
  const where = COUNTRIES.find((c) => c.key === country)?.label;
  const what = KINDS.find((k) => k.key === kind)?.label.toLowerCase() ?? "venues";

  return (
    <section className="ld-section" aria-labelledby="ld-find-title">
      <div className="ld-section-head">
        <h2 id="ld-find-title">Find the room</h2>
        <p>Real quintas, event halls and conference centres in Portugal, Belgium and Italy. Choose one and plan your event there.</p>
      </div>
      <Chips label="Country">
        <Chip pressed={country === null} onClick={() => setCountry(null)}>
          All countries{counts.state.status === "ready" ? ` · ${count(null, null)}` : ""}
        </Chip>
        {COUNTRIES.map((c) => (
          <Chip key={c.key} pressed={country === c.key} onClick={() => setCountry(c.key)}>
            {c.label}
            {counts.state.status === "ready" ? ` · ${count(null, c.key)}` : ""}
          </Chip>
        ))}
      </Chips>
      <div className="ld-kinds" role="group" aria-label="Kind of venue">
        {KINDS.map((k) => (
          <button key={k.key} type="button" className="ld-kind" aria-pressed={kind === k.key} onClick={() => setKind(kind === k.key ? null : k.key)}>
            <span className="ld-kind-label">{k.label}</span>
            <span className="ld-kind-blurb">{k.blurb}</span>
            <span className="ld-kind-count">{counts.state.status === "ready" ? `${count(k.key, country)} ${where ? `in ${where}` : "venues"}` : "…"}</span>
          </button>
        ))}
      </div>
      <div aria-live="polite" aria-busy={list.state.status === "loading"}>
        {list.state.status === "loading" && <Skeleton lines={4} label="Finding venues" />}
        {list.state.status === "error" && <ErrorState message={errorMessage(list.state.error, "We could not load the venues. Please try again.")} onRetry={() => list.reload()} />}
        {ready &&
          (ready.items.length === 0 ? (
            <EmptyState title="No venues listed here yet">
              <p>Run a quinta or a hall? Create an account and draw your room.</p>
              <Link className="btn btn-primary" to="/organiser/register">
                Add your venue
              </Link>
            </EmptyState>
          ) : (
            <>
              <div className="dir-grid">
                {ready.items.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>
              <p className="ld-more">
                <Link to={directoryHref(country, kind)}>
                  See all {ready.total} {what}
                  {where ? ` in ${where}` : ""} <span aria-hidden="true">→</span>
                </Link>
              </p>
              <Attribution />
            </>
          ))}
      </div>
    </section>
  );
}

function DemoRooms({ venues, types }: { venues: Loaded<{ items: EventVenueCard[] }>; types: Loaded<EventType[]> }) {
  if (venues.state.status !== "ready" || venues.state.data.items.length === 0) return null;
  const labels = new Map(types.state.status === "ready" ? types.state.data.map((t) => [t.key, t.label]) : []);
  return (
    <section className="ld-section" aria-labelledby="ld-demo-title">
      <div className="ld-section-head">
        <h2 id="ld-demo-title">Try a room that is already drawn</h2>
        <p>Demo venues with every table and seat in place. Open one to see its events and choose a seat.</p>
      </div>
      <div className="ep-venue-grid">
        {venues.state.data.items.slice(0, 3).map((venue) => (
          <VenueCard key={venue.slug} venue={venue} typeLabels={labels} />
        ))}
      </div>
      <p className="ld-more">
        <Link to="/venues">
          All {venues.state.data.items.length} demo rooms <span aria-hidden="true">→</span>
        </Link>
      </p>
    </section>
  );
}

function Occasions({ types, events }: { types: Loaded<EventType[]>; events: Loaded<EventsPage> }) {
  if (types.state.status !== "ready") return null;
  const counts = new Map<string, number>();
  if (events.state.status === "ready") for (const e of events.state.data.items) if (e.event_type) counts.set(e.event_type, (counts.get(e.event_type) ?? 0) + 1);
  return (
    <section className="ld-section" aria-labelledby="ld-occasions-title">
      <div className="ld-section-head">
        <h2 id="ld-occasions-title">What are you planning?</h2>
        <p>Open events of each kind, with a seat still free for you.</p>
      </div>
      <ul className="ld-occasions">
        {types.state.data.map((type) => {
          const n = counts.get(type.key) ?? 0;
          return (
            <li key={type.key}>
              <Link className="ld-occasion" to={`/events?type=${encodeURIComponent(type.key)}`}>
                <span className="ld-occasion-label">{type.label}</span>
                <span className="ld-occasion-count">{events.state.status === "ready" ? (n === 0 ? "None open now" : `${n} open`) : " "}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ComingUp({ events }: { events: Loaded<EventsPage> }) {
  if (events.state.status === "error") return null;
  const next = events.state.status === "ready" ? events.state.data.items.slice(0, 3) : [];
  if (events.state.status === "ready" && next.length === 0) return null;
  return (
    <section className="ld-section" aria-labelledby="ld-next-title">
      <div className="ld-section-head">
        <h2 id="ld-next-title">Coming up</h2>
        <p>Open the link, see the room and choose where you sit.</p>
      </div>
      {events.state.status === "loading" ? (
        <Skeleton lines={3} label="Loading events" />
      ) : (
        <>
          <div className="ld-events">
            {next.map((event) => (
              <EventCard key={event.public_id} event={event} />
            ))}
          </div>
          <p className="ld-more">
            <Link to="/events">
              All upcoming events <span aria-hidden="true">→</span>
            </Link>
          </p>
        </>
      )}
    </section>
  );
}

const WAYS = [
  { title: "Organisers", body: "Choose the venue, draw the tables, invite guests with one link and watch the room fill.", to: "/organiser/register", action: "Create an event" },
  { title: "Guests", body: "Have a code or a link? Open it, see who is coming and pick your seat.", to: "/participant", action: "Open an invitation" },
  { title: "Staff on the day", body: "Check guests in at the door and see every table as it fills.", to: "/events/staff", action: "Open the staff area" },
];

function WaysIn() {
  return (
    <section className="ld-section" aria-labelledby="ld-ways-title">
      <div className="ld-section-head">
        <h2 id="ld-ways-title">Three ways in</h2>
      </div>
      <ul className="ld-ways">
        {WAYS.map((way) => (
          <li key={way.title} className="ld-way">
            <h3>{way.title}</h3>
            <p>{way.body}</p>
            <Link className="btn btn-secondary" to={way.to}>
              {way.action}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
