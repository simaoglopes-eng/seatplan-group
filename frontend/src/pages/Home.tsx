// Route /: the front door, in the order of the approved mock: photo hero with the
// search bar, the three photo tiles, three real venues, the organisers band, footer.
// Every count is live data and every link lands on a page that honours what it says:
// the search bar and the three room tiles open the real-venue directory with that
// country and kind; "See all" opens the directory; "Plan an event here" opens the
// organiser space with that venue named. Events, demo rooms, the live demo and the
// staff area stay one click away in the header and the footer.
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, ErrorState, PageShell, Skeleton } from "../design/components";
import { PublicHeaderActions } from "./discover/PublicHeaderActions";
import { getDirectory, getDirectoryCounts } from "../api/venueDirectory";
import type { DirectoryCountry, DirectoryCounts, DirectoryKind } from "../api/venueDirectory";
import { COUNTRIES, KINDS, countryFrom, directoryHref, kindFrom } from "./directory/directoryModel";
import { Attribution, ListingCard } from "./directory/ListingCard";
import { ROOM_TILES, formatCount } from "./homeSample";
import { errorMessage } from "./restaurant/format";
import { useLoad } from "./restaurant/useLoad";
import type { Loaded } from "./restaurant/useLoad";
import "./events-public/events-public.css";
import "./directory/directory.css";
import "./landing.css";

/** Live venue counts, or null while they load or when they failed (the copy then drops the number). */
type CountFn = ((kind: DirectoryKind | null, country: DirectoryCountry | null) => number) | null;

function counter(counts: Loaded<DirectoryCounts>): CountFn {
  if (counts.state.status !== "ready") return null;
  const rows = counts.state.data.items;
  if (rows.length === 0) return null;
  return (kind, country) =>
    rows.filter((r) => (kind === null || r.kind === kind) && (country === null || r.country === country)).reduce((sum, r) => sum + r.count, 0);
}

export default function Home() {
  const counts = useLoad(getDirectoryCounts, "directory-counts");
  const count = counter(counts);
  return (
    <div className="ld-route">
      <PageShell
        title="Venues for events that matter"
        width="wide"
        variant="overlay"
        headerActions={<PublicHeaderActions />}
        footerContent={
          <p className="ld-footer-links">
            <Link to="/venues">Demo rooms</Link>
            <Link to="/demo">Live demo</Link>
            <Link to="/events/staff">Staff area</Link>
            <Link to="/login">Organiser sign in</Link>
          </p>
        }
      >
        <Hero count={count} />
        <SearchBar count={count} />
        <Rooms count={count} />
        <FindVenue />
        <Organisers />
      </PageShell>
    </div>
  );
}

function Hero({ count }: { count: CountFn }) {
  const total = count ? count(null, null) : 0;
  return (
    <section className="ld-hero" aria-labelledby="ld-hero-title">
      <img className="ld-hero-photo" src="/images/photos/hero-auditorium.jpg" width={2000} height={1334} alt="A cinema hall with rows of red seats facing the stage" />
      <div className="ld-wrap ld-hero-copy">
        <p className="ld-eyebrow">Portugal · Belgium · Italy</p>
        <h1 id="ld-hero-title">Venues for events that matter.</h1>
        <p className="ld-lede">
          {total > 0 ? `${formatCount(total)} quintas, halls and conference centres.` : "Quintas, halls and conference centres."} Choose the room, draw the tables and let every guest choose a seat.
        </p>
        <div className="ld-hero-actions">
          <Link className="btn ld-btn-light" to="/directory">
            Find a venue
          </Link>
          <Link className="btn ld-btn-line" to="/participant">
            I have an invitation
          </Link>
        </div>
        <p className="ld-hero-note">
          Already organising? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </section>
  );
}

function SearchBar({ count }: { count: CountFn }) {
  const navigate = useNavigate();
  const [country, setCountry] = useState<DirectoryCountry | null>(null);
  const [kind, setKind] = useState<DirectoryKind | null>(null);
  const n = (k: DirectoryKind | null, c: DirectoryCountry | null): string => (count ? ` (${formatCount(count(k, c))})` : "");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    navigate(directoryHref(country, kind));
  };
  return (
    <div className="ld-wrap ld-search">
      <form className="ld-bar" role="search" aria-label="Find a venue" onSubmit={submit}>
        <div className="ld-field">
          <label htmlFor="ld-country">Country</label>
          <select id="ld-country" value={country ?? ""} onChange={(e) => setCountry(countryFrom(e.target.value))}>
            <option value="">All countries{n(kind, null)}</option>
            {COUNTRIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
                {n(kind, c.key)}
              </option>
            ))}
          </select>
        </div>
        <div className="ld-field">
          <label htmlFor="ld-kind">Kind of venue</label>
          <select id="ld-kind" value={kind ?? ""} onChange={(e) => setKind(kindFrom(e.target.value))}>
            <option value="">All kinds{n(null, country)}</option>
            {KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
                {n(k.key, country)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="ld-bar-submit">
          {count ? `Search ${formatCount(count(kind, country))} venues` : "Search venues"}
        </button>
      </form>
    </div>
  );
}

function Rooms({ count }: { count: CountFn }) {
  return (
    <section className="ld-wrap ld-section" aria-labelledby="ld-rooms-title">
      <div className="ld-head">
        <div>
          <p className="ld-eyebrow">The rooms</p>
          <h2 id="ld-rooms-title">Three kinds of room, one way to seat it.</h2>
        </div>
        <p>Real venues from OpenStreetMap across three countries. Open one and start planning there.</p>
      </div>
      <ul className="ld-tiles">
        {ROOM_TILES.map((tile) => {
          const label = KINDS.find((k) => k.key === tile.kind)?.label ?? tile.kind;
          return (
            <li key={tile.kind}>
              <Link className="ld-tile" to={directoryHref(null, tile.kind)}>
                <img src={tile.photo} width={1400} height={933} alt="" loading="lazy" decoding="async" />
                <span className="ld-tile-text">
                  <span className="ld-tile-count">{count ? `${formatCount(count(tile.kind, null))} venues` : "Venues"}</span>
                  <span className="ld-tile-title">{label}</span>
                  <span className="ld-tile-blurb">{tile.blurb}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Three real venues, as in the mock. The directory has no photos of them, so the cards stay text. */
function FindVenue() {
  const list = useLoad(() => getDirectory({ limit: 3 }), "landing-directory");
  const ready = list.state.status === "ready" ? list.state.data : null;

  return (
    <section className="ld-wrap ld-section ld-directory" aria-labelledby="ld-find-title">
      <div className="ld-head">
        <div>
          <p className="ld-eyebrow">In the directory</p>
          <h2 id="ld-find-title">Start with a room you can visit.</h2>
        </div>
        <p className="ld-more">
          <Link to="/directory">
            {ready && ready.total > 0 ? `See all ${formatCount(ready.total)} venues` : "See all venues"} <span aria-hidden="true">→</span>
          </Link>
        </p>
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
                {ready.items.slice(0, 3).map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>
              <Attribution />
            </>
          ))}
      </div>
    </section>
  );
}

const STEPS = ["Choose the venue and draw the floor plan.", "Invite guests with a single link or code.", "Check guests in at the door on the day."];

function Organisers() {
  return (
    <section className="ld-band" aria-labelledby="ld-band-title">
      <div className="ld-wrap ld-band-grid">
        <div className="ld-band-photo">
          <img
            src="/images/photos/palazzo-hall.jpg"
            width={1400}
            height={933}
            alt="The grand hall of the Palazzo Vecchio, with a carved ceiling over rows of chairs"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className="ld-band-copy">
          <p className="ld-eyebrow">For organisers</p>
          <h2 id="ld-band-title">Every guest, in the right seat.</h2>
          <p className="ld-band-lede">Draw the tables once. Send one link. Guests see the room, who is coming, and choose where they sit.</p>
          <ol className="ld-steps">
            {STEPS.map((step, i) => (
              <li key={step}>
                <span className="ld-step-n" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <Link className="btn ld-btn-light" to="/organiser/register">
            Plan an event
          </Link>
        </div>
      </div>
    </section>
  );
}
