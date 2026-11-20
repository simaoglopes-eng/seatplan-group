// Route /venues/:slug: the public page of a hall or quinta, laid out like a restaurant's
// page (restaurant-public/RestaurantPage.tsx): name and kind first, the photos beside the
// upcoming events (where "Choose your seat" lives), then About and "Find us" with the map.
import { lazy, Suspense } from "react";
import type { MouseEvent } from "react";
import { useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { getEventVenue } from "../../api/eventsPublic";
import type { EventVenue } from "../../api/eventsPublic";
import { EmptyState, ErrorState, PageShell, Skeleton } from "../../design/components";
import { MapCredits } from "../../maps/MapCredits";
import { PublicHeaderActions } from "../discover/PublicHeaderActions";
import { Gallery } from "../restaurant-public/Gallery";
import { instagramHref, telHref, websiteHref } from "../restaurant-public/pageModel";
import { errorMessage } from "../restaurant/format";
import { useLoad } from "../restaurant/useLoad";
import { EventCard } from "./EventCard";
import { areaOf, capacityText } from "./eventsModel";
import "../discover/discover.css";
import "../restaurant/restaurant.css";
import "../restaurant-public/restaurantPage.css";
import "./events-public.css";

const ResultsMap = lazy(() => import("../../maps/ResultsMap"));

export default function VenuePage() {
  const { slug = "" } = useParams();
  const { state, reload } = useLoad(() => getEventVenue(slug), slug);
  const title = state.status === "ready" ? state.data.name : "Venue";
  const hasMap = state.status === "ready" && state.data.lat !== null && state.data.lng !== null;
  return (
    <PageShell title={title} headerActions={<PublicHeaderActions />} footerContent={hasMap && <MapCredits />}>
      {state.status === "loading" && <Skeleton lines={6} label="Loading the venue" />}
      {state.status === "error" && <LoadError error={state.error} onRetry={() => reload()} />}
      {state.status === "ready" && <Page data={state.data} />}
    </PageShell>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (error instanceof ApiError && error.code === "not_found") {
    return (
      <EmptyState title="We cannot find this venue" action={<Link to="/venues">See all halls and quintas</Link>}>
        <p>It may have been unpublished, or the address may be mistyped.</p>
      </EmptyState>
    );
  }
  return <ErrorState title="We could not open this venue" message={errorMessage(error)} onRetry={onRetry} />;
}

function Page({ data }: { data: EventVenue }) {
  const events = useRef<HTMLElement>(null);
  const tel = telHref(data.phone);
  const site = websiteHref(data.website);
  const instagram = instagramHref(data.instagram);
  const area = areaOf(data.address);
  const goToEvents = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    events.current?.scrollIntoView?.({ block: "start" });
    events.current?.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true });
  };
  return (
    <article className="rp ep-venue-page">
      <Link className="rp-back" to="/venues">
        ← All halls and quintas
      </Link>
      <header className="rp-head">
        <div className="rp-head-main">
          <h1>{data.name}</h1>
          <p className="rp-line">{[data.venue_type_label, area, capacityText(data.capacity, data.tables)].filter(Boolean).join(" · ")}</p>
          {data.address && <p className="rp-line">{data.address}</p>}
        </div>
        {data.upcoming.length > 0 && (
          <a className="btn btn-primary rp-cta" href="#events" onClick={goToEvents}>
            See upcoming events
          </a>
        )}
      </header>
      <div className="rp-hero-layout">
        <aside className="rp-visit" aria-label="Photos">
          <Gallery photos={data.photos} name={data.name} />
        </aside>
        <section ref={events} id="events" className="rp-book ep-upcoming" aria-labelledby="ep-upcoming-title">
          <h2 id="ep-upcoming-title">Upcoming events</h2>
          {data.upcoming.length === 0 ? (
            <p className="rb-muted">No events are listed here right now. New ones appear as soon as the venue lists them.</p>
          ) : (
            <div className="discover-cards">
              {data.upcoming.map((event) => (
                <EventCard key={event.public_id} event={event} showVenue={false} />
              ))}
            </div>
          )}
          <p className="ep-note">Choosing a seat needs a SeatPlan account. You can make one on the next page, or sign in.</p>
        </section>
      </div>
      <div className="rp-columns">
        <div>
          {data.description && (
            <section aria-labelledby="ep-about">
              <h2 id="ep-about">About</h2>
              <p>{data.description}</p>
            </section>
          )}
          <section aria-labelledby="ep-capacity">
            <h2 id="ep-capacity">The room</h2>
            <p>{capacityText(data.capacity, data.tables)}.</p>
            {data.event_types.length > 0 && (
              <>
                <h3 className="ep-small-title">Events held here</h3>
                <ul className="ep-tags" aria-label="Events held here">
                  {data.event_types.map((t) => (
                    <li key={t.key}>
                      <Link to={`/events?type=${encodeURIComponent(t.key)}`}>{t.label}</Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
        <aside aria-label="Where and how to reach the venue">
          <h2>Find us</h2>
          {data.lat !== null && data.lng !== null && (
            <div className="rp-map">
              <Suspense fallback={<Skeleton label="Loading the map" lines={3} />}>
                <ResultsMap pins={[{ id: data.slug, name: data.name, lat: data.lat, lng: data.lng }]} showNames />
              </Suspense>
            </div>
          )}
          <p>
            <a href={data.maps_url} target="_blank" rel="noopener noreferrer">
              Open in Google Maps<span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </p>
          <ul className="rp-contact">
            {tel && (
              <li>
                <a href={tel}>{data.phone}</a>
              </li>
            )}
            {site && (
              <li>
                <a href={site} target="_blank" rel="noopener noreferrer">
                  Website<span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              </li>
            )}
            {instagram && (
              <li>
                <a href={instagram} target="_blank" rel="noopener noreferrer">
                  Instagram<span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              </li>
            )}
          </ul>
        </aside>
      </div>
    </article>
  );
}
