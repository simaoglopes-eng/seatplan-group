// Route /events, "Event booking" (plan 2026-11-18, decision 2): pick an event type, see the
// upcoming listed events of that type at the sample halls and quintas, and open one to choose
// a seat. The type lives in the address (?type=wedding), so Back and a shared link keep it.
// Built from the discovery pieces (chips, card frame, states) so it feels like finding a table.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getEventTypes, getEventVenues, getPublicEvents } from "../../api/eventsPublic";
import type { PublicEvent } from "../../api/eventsPublic";
import { Button, EmptyState, ErrorState, PageShell, Skeleton } from "../../design/components";
import { Chip, Chips } from "../discover/Chips";
import { PublicHeaderActions } from "../discover/PublicHeaderActions";
import { errorMessage } from "../restaurant/format";
import { useLoad } from "../restaurant/useLoad";
import { EventCard } from "./EventCard";
import { eventTypeFrom } from "./eventsModel";
import { PageBand, countText } from "./PageBand";
import { VenueCard } from "./VenueCard";
import "../discover/discover.css";
import "./events-public.css";

const PAGE = 20;
type Results = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: PublicEvent[]; total: number };

export default function EventsPage() {
  const [params, setParams] = useSearchParams();
  const types = useLoad(getEventTypes, "event-types");
  const typeList = types.state.status === "ready" ? types.state.data : [];
  const asked = params.get("type");
  // The list waits for the types, so an unknown ?type= is dropped instead of being refused by the server (422).
  const typesSettled = types.state.status !== "loading";
  const type = types.state.status === "ready" ? eventTypeFrom(asked, typeList) : null;
  const typeLabel = typeList.find((t) => t.key === type)?.label ?? null;

  const [results, setResults] = useState<Results>({ status: "loading" });
  const [more, setMore] = useState({ busy: false, error: "" });
  const request = useRef(0);
  const search = useCallback(() => {
    const id = ++request.current;
    setResults({ status: "loading" });
    if (!typesSettled) return;
    getPublicEvents({ type, limit: PAGE, offset: 0 }).then(
      (answer) => id === request.current && setResults({ status: "ready", items: answer.items, total: answer.total }),
      (error: unknown) => id === request.current && setResults({ status: "error", message: errorMessage(error, "We could not load the events. Please try again.") }),
    );
  }, [type, typesSettled]);
  useEffect(search, [search]);

  const showMore = async (): Promise<void> => {
    if (results.status !== "ready" || more.busy) return;
    const id = ++request.current;
    setMore({ busy: true, error: "" });
    try {
      const answer = await getPublicEvents({ type, limit: PAGE, offset: results.items.length });
      if (id === request.current) setResults({ status: "ready", items: [...results.items, ...answer.items], total: answer.total });
      setMore({ busy: false, error: "" });
    } catch (error) {
      setMore({ busy: false, error: errorMessage(error, "We could not load more. Please try again.") });
    }
  };

  const choose = (key: string | null): void => {
    const next = new URLSearchParams(params);
    if (key) next.set("type", key);
    else next.delete("type");
    setParams(next, { replace: true });
  };

  const heading =
    results.status === "ready"
      ? `${results.total} upcoming ${typeLabel ? typeLabel.toLowerCase() : ""}${typeLabel ? " " : ""}${results.total === 1 ? "event" : "events"}`
      : "Finding events";

  return (
    <div className="discover-route pg-route">
      <PageShell title="Event booking" headerActions={<PublicHeaderActions />}>
        <PageBand
          id="events-heading"
          eyebrow="Upcoming events"
          title="Choose your seat at an event."
          count={countText(results.status === "ready" ? results.total : results.status === "error" ? undefined : null, "upcoming event", "upcoming events")}
        >
          Weddings, conferences and dinners at halls and quintas. Pick an event, see the room and choose where you’ll sit.
        </PageBand>
        {types.state.status === "error" && <ErrorState title="We could not load the event types" message={errorMessage(types.state.error)} onRetry={() => types.reload()} />}
        {types.state.status === "loading" && <Skeleton lines={1} label="Loading event types" />}
        {types.state.status === "ready" && (
          <Chips label="Event type">
            <Chip pressed={type === null} onClick={() => choose(null)}>
              All
            </Chip>
            {typeList.map((t) => (
              <Chip key={t.key} pressed={type === t.key} onClick={() => choose(t.key)}>
                {t.label}
              </Chip>
            ))}
          </Chips>
        )}
        <div className="discover-results-head ep-results-head">
          <h2 id="events-results-title">{heading}</h2>
        </div>
        <section className="ep-list" aria-label="Upcoming events" aria-busy={results.status === "loading"}>
          {results.status === "loading" && <Skeleton lines={6} label="Finding events" />}
          {results.status === "error" && <ErrorState message={results.message} onRetry={search} />}
          {results.status === "ready" &&
            (results.items.length === 0 ? (
              <EmptyState
                title={typeLabel ? `No upcoming ${typeLabel.toLowerCase()} events` : "No upcoming events"}
                action={type ? <Button onClick={() => choose(null)}>Show all events</Button> : undefined}
              >
                <p>{type ? "Try another kind of event." : "New events appear here as soon as a venue lists them."}</p>
              </EmptyState>
            ) : (
              <div className="discover-cards">
                {results.items.map((event) => (
                  <EventCard key={event.public_id} event={event} />
                ))}
              </div>
            ))}
          {more.error && <p role="alert">{more.error}</p>}
          {results.status === "ready" && results.items.length < results.total && (
            <Button className="discover-load-more" variant="secondary" busy={more.busy} onClick={() => void showMore()}>
              Show more
            </Button>
          )}
        </section>
        <VenuesTeaser typeLabels={new Map(typeList.map((t) => [t.key, t.label]))} />
      </PageShell>
    </div>
  );
}

/** "Halls and quintas": the venues behind the events, with a link to all of them. */
function VenuesTeaser({ typeLabels }: { typeLabels: Map<string, string> }) {
  const venues = useLoad(() => getEventVenues(null), "event-venues");
  const items = useMemo(() => (venues.state.status === "ready" ? venues.state.data.items.slice(0, 3) : []), [venues.state]);
  return (
    <section className="ep-teaser" aria-labelledby="ep-venues-title">
      <div className="ep-section-head">
        <h2 id="ep-venues-title">Halls and quintas</h2>
        <Link to="/venues">See all halls and quintas</Link>
      </div>
      <p className="ep-muted">The places where these events happen: city halls for conferences and dinners, quintas in the country for weddings and family days.</p>
      {venues.state.status === "loading" && <Skeleton lines={3} label="Loading halls and quintas" />}
      {venues.state.status === "error" && <ErrorState title="We could not load the venues" message={errorMessage(venues.state.error)} onRetry={() => venues.reload()} />}
      {items.length > 0 && (
        <div className="ep-venue-grid">
          {items.map((venue) => (
            <VenueCard key={venue.slug} venue={venue} typeLabels={typeLabels} />
          ))}
        </div>
      )}
    </section>
  );
}
