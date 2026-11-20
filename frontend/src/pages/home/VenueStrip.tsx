// "In the directory": six real venues (FEATURED_VENUES), each loaded live from the
// directory and shown with its own credited photo. A venue that fails to load is
// left out. Three are visible on a desktop, with arrows that page through the rest;
// on a phone the row is a swipe strip.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Link } from "react-router-dom";
import { getListing } from "../../api/venueDirectory";
import type { Listing } from "../../api/venueDirectory";
import { FEATURED_VENUES, venuePhoto } from "../../data/venuePhotos";
import { planHref, placeLine, safeWebsite } from "../directory/directoryModel";
import { Skeleton } from "../../design/components";

type State = { status: "loading" } | { status: "ready"; items: Listing[] };

/** Loads every featured id in parallel and keeps the ones that answered, in their order. */
export function useFeaturedVenues(ids: readonly string[] = FEATURED_VENUES): State {
  const [state, setState] = useState<State>({ status: "loading" });
  const key = ids.join(",");
  useEffect(() => {
    let live = true;
    void Promise.allSettled(key.split(",").map((id) => getListing(id))).then((results) => {
      if (!live) return;
      const items = results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
      setState({ status: "ready", items });
    });
    return () => {
      live = false;
    };
  }, [key]);
  return state;
}

/** Arrow state for a horizontal scroller: disabled at either end. */
function useEnds(scroller: RefObject<HTMLElement | null>, deps: unknown[]): { atStart: boolean; atEnd: boolean; update: () => void } {
  const [ends, setEnds] = useState({ atStart: true, atEnd: true });
  const update = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const atStart = el.scrollLeft < 8;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
    setEnds((prev) => (prev.atStart === atStart && prev.atEnd === atEnd ? prev : { atStart, atEnd }));
  }, [scroller]);
  useEffect(() => {
    update();
    const el = scroller.current;
    window.addEventListener("resize", update);
    const ro = typeof ResizeObserver === "function" && el ? new ResizeObserver(update) : null;
    if (ro && el) ro.observe(el);
    // Images and fonts can change widths after the first paint.
    const late = window.setTimeout(update, 400);
    return () => {
      window.removeEventListener("resize", update);
      ro?.disconnect();
      window.clearTimeout(late);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, ...deps]);
  return { ...ends, update };
}

export function VenueStrip({ total, titleId }: { total: ReactNode; titleId: string }) {
  const state = useFeaturedVenues();
  const items = state.status === "ready" ? state.items : [];
  const scroller = useRef<HTMLUListElement>(null);
  const { atStart, atEnd, update } = useEnds(scroller, [items.length]);

  const page = (dir: -1 | 1): void => {
    const el = scroller.current;
    if (!el) return;
    const left = dir * (el.clientWidth + 24);
    if (typeof el.scrollBy === "function") el.scrollBy({ left });
    else el.scrollLeft += left;
    update();
  };

  return (
    <>
      <div className="ld-head">
        <div>
          <p className="ld-eyebrow">In the directory</p>
          <h2 id={titleId}>Start with a room you can visit.</h2>
        </div>
        <div className="ld-strip-nav">
          <Link className="ld-all" to="/directory">
            <span>{total}</span> <span aria-hidden="true">→</span>
          </Link>
          {items.length > 0 && (
            <>
              <button type="button" className="ld-arrow" aria-label="Previous venues" disabled={atStart} onClick={() => page(-1)}>
                <span aria-hidden="true">←</span>
              </button>
              <button type="button" className="ld-arrow" aria-label="Next venues" disabled={atEnd} onClick={() => page(1)}>
                <span aria-hidden="true">→</span>
              </button>
            </>
          )}
        </div>
      </div>
      <div aria-live="polite" aria-busy={state.status === "loading"}>
        {state.status === "loading" && <Skeleton lines={4} label="Finding venues" />}
        {state.status === "ready" && items.length === 0 && (
          <p className="ld-strip-empty">
            The featured venues could not be loaded just now. <Link to="/directory">Open the directory</Link> to see every venue.
          </p>
        )}
        {items.length > 0 && (
          <>
            <ul className="ld-strip" ref={scroller} onScroll={update} aria-label="Featured venues">
              {items.map((listing) => (
                <VenueCard key={listing.id} listing={listing} />
              ))}
            </ul>
            <p className="ld-swipe" aria-hidden="true">
              Swipe for more venues →
            </p>
          </>
        )}
      </div>
    </>
  );
}

function VenueCard({ listing }: { listing: Listing }) {
  const photo = venuePhoto(listing.id);
  const website = safeWebsite(listing.website);
  const out = website ?? safeWebsite(listing.source_url);
  return (
    <li className="ld-card">
      <article aria-labelledby={`ld-card-${listing.id}`}>
        <div className="ld-card-photo">
          {photo && <img src={photo.src} alt={photo.alt} width={960} height={720} loading="lazy" decoding="async" />}
        </div>
        <p className="ld-card-eyebrow">
          {listing.kind_label} · {listing.country_label}
        </p>
        <h3 id={`ld-card-${listing.id}`}>{listing.name}</h3>
        <p className="ld-card-place">{placeLine(listing)}</p>
        <p className="ld-card-links">
          <Link to={planHref(listing)}>
            Plan an event here<span className="visually-hidden">: {listing.name}</span>
          </Link>
          {out && (
            <a href={out} target="_blank" rel="noopener noreferrer">
              {website ? "Website" : "Map"} <span aria-hidden="true">↗</span>
              <span className="visually-hidden"> of {listing.name} (opens in a new tab)</span>
            </a>
          )}
        </p>
      </article>
    </li>
  );
}
