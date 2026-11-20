// Route /venues: every published hall and quinta, with a Halls | Quintas filter kept in
// the address (?type=hall). Each card opens the venue's own page.
import { Link, useSearchParams } from "react-router-dom";
import { getEventTypes, getEventVenues } from "../../api/eventsPublic";
import type { VenueType } from "../../api/eventsPublic";
import { Button, EmptyState, ErrorState, PageShell, Skeleton } from "../../design/components";
import { Chip, Chips } from "../discover/Chips";
import { PublicHeaderActions } from "../discover/PublicHeaderActions";
import { errorMessage } from "../restaurant/format";
import { useLoad } from "../restaurant/useLoad";
import { venueTypeFrom } from "./eventsModel";
import { VenueCard } from "./VenueCard";
import "../discover/discover.css";
import "./events-public.css";

const FILTERS: { key: VenueType | null; label: string }[] = [
  { key: null, label: "All" },
  { key: "hall", label: "Halls" },
  { key: "quinta", label: "Quintas" },
];

export default function VenuesPage() {
  const [params, setParams] = useSearchParams();
  const type = venueTypeFrom(params.get("type"));
  const venues = useLoad(() => getEventVenues(type), type ?? "all");
  const types = useLoad(getEventTypes, "event-types");
  const labels = new Map(types.state.status === "ready" ? types.state.data.map((t) => [t.key, t.label]) : []);
  const choose = (key: VenueType | null): void => {
    const next = new URLSearchParams(params);
    if (key) next.set("type", key);
    else next.delete("type");
    setParams(next, { replace: true });
  };
  const count = venues.state.status === "ready" ? venues.state.data.items.length : null;
  const noun = type === "hall" ? "hall" : type === "quinta" ? "quinta" : "venue";
  return (
    <div className="discover-route">
      <PageShell title="Halls and quintas" width="wide" headerActions={<PublicHeaderActions />}>
        <Link className="rp-back ep-back" to="/events">
          ← Back to events
        </Link>
        <section className="discover-top" aria-labelledby="venues-heading">
          <h1 id="venues-heading">Halls and quintas</h1>
          <p>City halls for conferences and dinners, quintas in the country for weddings and family days. Every room is drawn seat by seat.</p>
        </section>
        <Chips label="Kind of venue">
          {FILTERS.map((f) => (
            <Chip key={f.label} pressed={type === f.key} onClick={() => choose(f.key)}>
              {f.label}
            </Chip>
          ))}
        </Chips>
        <div className="discover-results-head ep-results-head">
          <h2>{count === null ? "Finding venues" : `${count} ${count === 1 ? noun : `${noun}s`}`}</h2>
        </div>
        <section aria-label="Venues" aria-busy={venues.state.status === "loading"}>
          {venues.state.status === "loading" && <Skeleton lines={6} label="Finding venues" />}
          {venues.state.status === "error" && <ErrorState message={errorMessage(venues.state.error, "We could not load the venues. Please try again.")} onRetry={() => venues.reload()} />}
          {venues.state.status === "ready" &&
            (venues.state.data.items.length === 0 ? (
              <EmptyState title="No venues here yet" action={type ? <Button onClick={() => choose(null)}>Show all venues</Button> : undefined}>
                <p>New halls and quintas appear here when they publish their page.</p>
              </EmptyState>
            ) : (
              <div className="ep-venue-grid">
                {venues.state.data.items.map((venue) => (
                  <VenueCard key={venue.slug} venue={venue} typeLabels={labels} />
                ))}
              </div>
            ))}
        </section>
      </PageShell>
    </div>
  );
}
