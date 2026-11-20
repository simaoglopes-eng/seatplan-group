// Route /: the front door. It reads the same public data as /venues and /events, so every
// tile, count and card is live, and every link lands on a page that honours what it says:
// a kind tile filters here and its "See all" opens /venues with the same filter; an
// occasion opens /events?type=; an event card opens its shared link (/j/<token>).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getEventTypes, getEventVenues, getPublicEvents } from "../api/eventsPublic";
import type { EventType, EventVenueCard, PublicEvent } from "../api/eventsPublic";
import { EmptyState, ErrorState, PageShell, Skeleton } from "../design/components";
import { SeatMap } from "../seatmap/SeatMap";
import { PublicHeaderActions } from "./discover/PublicHeaderActions";
import { EventCard } from "./events-public/EventCard";
import { VenueCard } from "./events-public/VenueCard";
import { matchesKind, VENUE_KINDS, venuesHref } from "./events-public/eventsModel";
import type { VenueKind } from "./events-public/eventsModel";
import { SAMPLE_RECOMMENDED, buildSampleFloor } from "./homeSample";
import { errorMessage } from "./restaurant/format";
import { useLoad } from "./restaurant/useLoad";
import type { Loaded } from "./restaurant/useLoad";
import "./discover/discover.css";
import "./events-public/events-public.css";
import "./landing.css";

type EventsPage = { items: PublicEvent[]; total: number };

/** Guest counts offered on the slider; 0 means "any size". */
const GUEST_MAX = 200;
const GUEST_STEP = 10;

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
        <FindVenue venues={venues} types={types} />
        <Occasions types={types} events={events} />
        <ComingUp events={events} />
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

function FindVenue({ venues, types }: { venues: Loaded<{ items: EventVenueCard[] }>; types: Loaded<EventType[]> }) {
  const [kind, setKind] = useState<VenueKind | null>(null);
  const [guests, setGuests] = useState(0);
  const labels = new Map(types.state.status === "ready" ? types.state.data.map((t) => [t.key, t.label]) : []);
  const all = venues.state.status === "ready" ? venues.state.data.items : [];
  const fits = all.filter((venue) => guests === 0 || venue.capacity >= guests);
  const shown = fits.filter((venue) => matchesKind(venue, kind));
  const href = venuesHref(kind, guests || null);
  const kindLabel = VENUE_KINDS.find((k) => k.key === kind)?.label.toLowerCase() ?? "venues";

  return (
    <section className="ld-section" aria-labelledby="ld-find-title">
      <div className="ld-section-head">
        <h2 id="ld-find-title">Find the room</h2>
        <p>Pick a kind of venue and the size of your party. The list changes as you go.</p>
      </div>
      <div className="ld-kinds" role="group" aria-label="Kind of venue">
        {VENUE_KINDS.map((k) => {
          const count = venues.state.status === "ready" ? fits.filter((venue) => matchesKind(venue, k.key)).length : null;
          return (
            <button key={k.key} type="button" className="ld-kind" aria-pressed={kind === k.key} onClick={() => setKind(kind === k.key ? null : k.key)}>
              <span className="ld-kind-label">{k.label}</span>
              <span className="ld-kind-blurb">{k.blurb}</span>
              <span className="ld-kind-count">{count === null ? "…" : `${count} ${count === 1 ? "venue" : "venues"}`}</span>
            </button>
          );
        })}
      </div>
      <div className="ld-guests">
        <label htmlFor="ld-guests-range">Guests</label>
        <input
          id="ld-guests-range"
          type="range"
          min={0}
          max={GUEST_MAX}
          step={GUEST_STEP}
          value={guests}
          aria-valuetext={guests === 0 ? "Any number" : `${guests} or more`}
          onChange={(event) => setGuests(Number(event.target.value))}
        />
        <output htmlFor="ld-guests-range">{guests === 0 ? "Any number" : `${guests} or more`}</output>
      </div>
      <div aria-live="polite" aria-busy={venues.state.status === "loading"}>
        {venues.state.status === "loading" && <Skeleton lines={4} label="Finding venues" />}
        {venues.state.status === "error" && <ErrorState message={errorMessage(venues.state.error, "We could not load the venues. Please try again.")} onRetry={() => venues.reload()} />}
        {venues.state.status === "ready" &&
          (shown.length === 0 ? (
            <EmptyState title={all.length === 0 ? "No venues published yet" : "Nothing that size here yet"}>
              <p>{all.length === 0 ? "Run a quinta or a hall? Create an account and publish your room." : "Try fewer guests or another kind of venue."}</p>
              {all.length === 0 && (
                <Link className="btn btn-primary" to="/organiser/register">
                  Add your venue
                </Link>
              )}
            </EmptyState>
          ) : (
            <>
              <div className="ep-venue-grid">
                {shown.slice(0, 3).map((venue) => (
                  <VenueCard key={venue.slug} venue={venue} typeLabels={labels} />
                ))}
              </div>
              <p className="ld-more">
                <Link to={href}>
                  See all {shown.length} {kind ? kindLabel : shown.length === 1 ? "venue" : "venues"}
                  {guests ? ` for ${guests} guests or more` : ""} <span aria-hidden="true">→</span>
                </Link>
              </p>
            </>
          ))}
      </div>
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
