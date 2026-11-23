// Route /: the front door, direction E "relaxed + glass" of the approved mock. Every
// block fills one screen: the photo hero with two glass choice cards (organiser, guest),
// the three room tiles with the venue search in their header, six real venues from the
// directory, the organisers band on a photo, and the sample seat map to try. Glass only
// ever sits on a photograph. Every count is live data and every link lands on a page
// that honours what it says: the search and the room tiles open the directory with that
// country and kind; the guest card opens /participant with the code typed in; "Plan an
// event here" opens the organiser space with that venue named. Motion is gentle (one
// per block) and stops under reduced motion.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Legend, PageShell } from "../design/components";
import { SeatMap } from "../seatmap/SeatMap";
import { CREATE_EVENT_HREF, PublicHeaderActions } from "./discover/PublicHeaderActions";
import { getDirectoryCounts } from "../api/venueDirectory";
import type { DirectoryCountry, DirectoryCounts, DirectoryKind } from "../api/venueDirectory";
import { COUNTRIES, KINDS, countryFrom, directoryHref, kindFrom } from "./directory/directoryModel";
import { ROOM_TILES, SAMPLE_RECOMMENDED, buildSampleFloor, formatCount, guestHref } from "./homeSample";
import { useLoad } from "./restaurant/useLoad";
import type { Loaded } from "./restaurant/useLoad";
import { CountUp } from "./home/CountUp";
import { HeroDots, HeroPhotos, useSlides, HERO_SLIDES } from "./home/HeroSlides";
import { useReveal } from "./home/useMotion";
import { TileSlides, roomPhotos, useRoomSlides } from "./home/RoomSlides";
import { VenueStrip } from "./home/VenueStrip";
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
  const footerReveal = useFooterReveal();
  return (
    <div className="ld-route" ref={footerReveal}>
      <PageShell
        title="Seat plans for events of every size"
        width="wide"
        variant="overlay"
        headerActions={<PublicHeaderActions />}
        footerContent={
          <p className="ld-footer-links">
            <Link to="/venues">Demo rooms</Link>
            <Link to="/demo">Live demo</Link>
            <Link to="/events/staff">Staff area</Link>
            <Link to="/login">Organiser sign in</Link>
            <Link to="/limitations-and-solutions">Limitations and solutions</Link>
          </p>
        }
      >
        <Hero count={count} />
        <Rooms count={count} />
        <TrySeat />
        <Directory count={count} />
        <Organisers />
      </PageShell>
    </div>
  );
}

/** The footer belongs to PageShell; on this page its content drifts in like the blocks above. */
function useFooterReveal(): (route: HTMLDivElement | null) => void {
  const reveal = useReveal<HTMLElement>();
  return useCallback(
    (route: HTMLDivElement | null) => {
      const inner = route?.querySelector<HTMLElement>(".shell-footer .shell-inner") ?? null;
      inner?.classList.add("ld-drift");
      reveal(inner);
    },
    [reveal],
  );
}

function Hero({ count }: { count: CountFn }) {
  const { index, go } = useSlides(HERO_SLIDES.length);
  return (
    <section className="ld-hero ld-block" aria-labelledby="ld-hero-title">
      <HeroPhotos index={index} />
      <div className="ld-hero-copy">
        <div className="ld-wrap">
          <p className="ld-eyebrow">Dinners · Conferences · Parties</p>
          <h1 id="ld-hero-title">Long tables, good company, everyone seated.</h1>
          <p className="ld-lede">Seat plans for events of every size, up to 800 guests. Tell us who you are.</p>
          <div className="ld-choose">
            <OrganiserCard count={count} />
            <GuestCard />
          </div>
          <HeroDots index={index} go={go} />
        </div>
      </div>
    </section>
  );
}

function OrganiserCard({ count }: { count: CountFn }) {
  const total = count ? count(null, null) : 0;
  return (
    <section className="ld-pick glass-panel" aria-labelledby="ld-pick-organiser">
      <p className="ld-pick-cap glass-eyebrow">I am organising</p>
      <h2 className="ld-pick-title" id="ld-pick-organiser">Plan an event</h2>
      <p className="ld-pick-text glass-muted">Create your event at any place, set up the room as banquet, theatre or cocktail, and invite your guests.</p>
      <Link className="btn btn-glass-green ld-go" to={CREATE_EVENT_HREF}>
        Create your own event <span aria-hidden="true">→</span>
      </Link>
      <p className="ld-pick-sub glass-muted">
        <Link to="/directory">{total > 0 ? <>or browse <CountUp value={total} /> venues</> : "or browse the venues"}</Link>
      </p>
    </section>
  );
}

function GuestCard() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  // /participant reads ?code=, fills its field with it and opens the invitation.
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    navigate(guestHref(code));
  };
  return (
    <form className="ld-pick glass-panel" aria-labelledby="ld-pick-guest" onSubmit={submit}>
      <p className="ld-pick-cap glass-eyebrow">I am a guest</p>
      <h2 className="ld-pick-title" id="ld-pick-guest">Find my seat</h2>
      <p className="ld-pick-text glass-muted">Open your invitation, choose your seat and tell the organiser what you need.</p>
      <div className="ld-code">
        <label htmlFor="ld-code">Invitation code</label>
        <input
          id="ld-code"
          className="glass-field"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. 7KQ-24M"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </div>
      <button type="submit" className="btn btn-glass-brass ld-go">
        Open my invitation <span aria-hidden="true">→</span>
      </button>
    </form>
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
      <button type="submit" className="btn btn-primary ld-bar-submit">
        {count ? `Search ${formatCount(count(kind, country))} venues` : "Search venues"}
      </button>
    </form>
  );
}

const TILE_PHOTOS = ROOM_TILES.map((tile) => roomPhotos(tile.kind));
const PHOTOS_PER_TILE = Math.min(...TILE_PHOTOS.map((photos) => photos.length));

function Rooms({ count }: { count: CountFn }) {
  const reveal = useReveal<HTMLDivElement>();
  const shown = useRoomSlides(TILE_PHOTOS.length, PHOTOS_PER_TILE);
  return (
    <section className="ld-block ld-section ld-tone-bg ld-rooms" aria-labelledby="ld-rooms-title">
      <div className="ld-wrap ld-drift" ref={reveal}>
        <div className="ld-head ld-rooms-head">
          <div>
            <p className="ld-eyebrow">The rooms</p>
            <h2 id="ld-rooms-title">Three kinds of room, one way to seat it.</h2>
          </div>
          <p className="ld-head-note">Real venues from OpenStreetMap across three countries. Open one and start planning there.</p>
          <SearchBar count={count} />
        </div>
        <ul className="ld-tiles">
          {ROOM_TILES.map((tile, i) => {
            const label = KINDS.find((k) => k.key === tile.kind)?.label ?? tile.kind;
            const n = count ? count(tile.kind, null) : 0;
            return (
              <li key={tile.kind}>
                <Link className="ld-tile" to={directoryHref(null, tile.kind)}>
                  <TileSlides photos={TILE_PHOTOS[i]} index={shown[i] ?? 0} />
                  <span className="ld-tile-text glass-panel">
                    <span className="ld-tile-count">{n > 0 ? <><CountUp value={n} /> venues</> : "Venues"}</span>
                    <span className="ld-tile-title">{label}</span>
                    <span className="ld-tile-blurb">{tile.blurb}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="ld-swipe" aria-hidden="true">
          Swipe for more kinds →
        </p>
      </div>
    </section>
  );
}

function Directory({ count }: { count: CountFn }) {
  const reveal = useReveal<HTMLDivElement>();
  const total = count ? count(null, null) : 0;
  return (
    <section className="ld-block ld-section ld-tone-sunk" aria-labelledby="ld-find-title">
      <div className="ld-wrap ld-drift" ref={reveal}>
        <VenueStrip titleId="ld-find-title" total={total > 0 ? <>See all <CountUp value={total} /> venues</> : "See all venues"} />
      </div>
    </section>
  );
}

const STEPS = ["Choose the venue and draw the floor plan.", "Invite guests with a single link or code.", "Check guests in at the door on the day."];

/** For organisers: a photo band (the Palazzo Vecchio hall, slow Ken Burns) with the copy on glass. */
function Organisers() {
  const reveal = useReveal<HTMLDivElement>();
  return (
    <section className="ld-block photo-band ld-band" aria-labelledby="ld-band-title">
      <div className="photo-band-photo ld-band-photo">
        <img
          src="/images/photos/palazzo-hall.jpg"
          width={1400}
          height={933}
          alt="The grand hall of the Palazzo Vecchio, with a carved ceiling over rows of chairs"
          loading="lazy"
          decoding="async"
        />
      </div>
      <div className="photo-band-inner ld-wrap ld-drift" ref={reveal}>
        <div className="glass-panel ld-band-panel">
          <p className="ld-eyebrow glass-eyebrow">For organisers</p>
          <h2 id="ld-band-title">Every guest, in the right seat.</h2>
          <p className="ld-band-lede glass-muted">Draw the tables once. Send one link. Guests see the room, who is coming, and choose where they sit.</p>
          <ol className="ld-steps">
            {STEPS.map((step, i) => (
              <li key={step}>
                <span className="ld-step-n" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <Link className="btn btn-glass-green ld-go" to={CREATE_EVENT_HREF}>
            Create your own event
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * On the home page the sample map fills most of its block, so a plain mouse wheel over it
 * must scroll the page, not zoom the map (the shared map zooms on every wheel turn).
 * A capture listener on the map's box stops plain wheel events before they reach the map;
 * nothing calls preventDefault, so the browser scrolls the page. Ctrl or Cmd with the wheel,
 * and trackpad pinches (which arrive with ctrlKey), still zoom, as do the zoom buttons.
 */
function usePageWheel<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
    };
    el.addEventListener("wheel", onWheel, { capture: true });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, []);
  return ref;
}

/** "Try choosing a seat": the fixed sample floor (homeSample.ts) in a solid card, with its copy in glass over a
 *  dinner photo. The map stays on a solid surface so every seat state keeps its contrast. It never talks to the server. */
function TrySeat() {
  // A later threshold than the other blocks, so the seats light up where the visitor can see them.
  const reveal = useReveal<HTMLDivElement>(0.4);
  const floor = useMemo(buildSampleFloor, []);
  const [selected, setSelected] = useState<number | null>(null);
  const mapBox = usePageWheel<HTMLDivElement>();
  return (
    <section className="ld-block ld-section photo-band ld-try" aria-labelledby="ld-try-title">
      <div className="photo-band-photo ld-try-photo">
        <img src="/images/photos/hero-dining-hall.jpg" width={2000} height={1333} alt="" loading="lazy" decoding="async" />
      </div>
      <div className="photo-band-inner ld-wrap ld-try-grid ld-drift" ref={reveal}>
        <div className="glass-panel ld-try-copy">
          <p className="ld-eyebrow glass-eyebrow">Try it</p>
          <h2 id="ld-try-title">Try choosing a seat.</h2>
          <p className="ld-try-lede glass-muted">
            This is what a guest sees: the room as it is, live. Pick a free seat; the dashed rings mark the ones next to a friend.
          </p>
          <p className="ld-try-picked" aria-live="polite">
            {selected === null
              ? "No seat chosen yet."
              : `Seat ${selected % 100} at table ${Math.floor(selected / 100)} is yours in this sample.`}
          </p>
          <p className="ld-try-links">
            <Link className="btn btn-glass-green ld-btn" to="/demo">
              Open the live demo
            </Link>
            <Link className="ld-text-link" to="/participant">
              I have an invitation
            </Link>
          </p>
        </div>
        <div className="ld-try-card">
          <div className="ld-try-map" ref={mapBox}>
            <SeatMap
              label="Sample seat map, try choosing a seat"
              tables={floor.tables}
              seats={floor.seats}
              highlight={SAMPLE_RECOMMENDED}
              selectedId={selected}
              onSelect={setSelected}
            />
          </div>
          <Legend states={["free", "held", "taken", "friend", "blocked"]} showAccessible showRecommended />
        </div>
      </div>
    </section>
  );
}
