// Route /venues: every published quinta, hall and conference room. The kind and the guest
// count live in the address (?type=quinta, ?occasion=conference, ?guests=80), so the home
// page links straight to a filtered list and Back keeps it. Each card opens the venue's page.
import { Link, useSearchParams } from "react-router-dom";
import { getEventTypes, getEventVenues } from "../../api/eventsPublic";
import { Button, EmptyState, ErrorState, PageShell, Skeleton } from "../../design/components";
import { Chip, Chips } from "../discover/Chips";
import { PublicHeaderActions } from "../discover/PublicHeaderActions";
import { errorMessage } from "../restaurant/format";
import { useLoad } from "../restaurant/useLoad";
import { guestsFrom, kindFrom, matchesKind, VENUE_KINDS } from "./eventsModel";
import type { VenueKind } from "./eventsModel";
import { VenueCard } from "./VenueCard";
import "../discover/discover.css";
import "./events-public.css";

const NOUNS: Record<VenueKind, [string, string]> = {
  quinta: ["quinta", "quintas"],
  hall: ["event hall", "event halls"],
  conference: ["conference room", "conference rooms"],
};

export default function VenuesPage() {
  const [params, setParams] = useSearchParams();
  const kind = kindFrom(params.get("type"), params.get("occasion"));
  const guests = guestsFrom(params.get("guests"));
  // One list for every kind: the filters are applied here, so switching is instant.
  const venues = useLoad(() => getEventVenues(null), "all");
  const types = useLoad(getEventTypes, "event-types");
  const labels = new Map(types.state.status === "ready" ? types.state.data.map((t) => [t.key, t.label]) : []);

  const update = (change: (next: URLSearchParams) => void): void => {
    const next = new URLSearchParams(params);
    change(next);
    setParams(next, { replace: true });
  };
  const choose = (key: VenueKind | null): void =>
    update((next) => {
      next.delete("type");
      next.delete("occasion");
      const query = VENUE_KINDS.find((k) => k.key === key)?.query ?? {};
      for (const [name, value] of Object.entries(query)) next.set(name, value);
    });
  const setGuests = (value: number | null): void =>
    update((next) => {
      if (value) next.set("guests", String(value));
      else next.delete("guests");
    });

  const shown =
    venues.state.status === "ready"
      ? venues.state.data.items.filter((venue) => matchesKind(venue, kind) && (guests === null || venue.capacity >= guests))
      : [];
  const [one, many] = kind ? NOUNS[kind] : ["venue", "venues"];
  const heading = venues.state.status === "ready" ? `${shown.length} ${shown.length === 1 ? one : many}${guests ? ` for ${guests} guests or more` : ""}` : "Finding venues";
  const filtered = kind !== null || guests !== null;

  return (
    <div className="discover-route">
      <PageShell title="Venues" width="wide" headerActions={<PublicHeaderActions />}>
        <Link className="rp-back ep-back" to="/">
          ← Back to home
        </Link>
        <section className="discover-top" aria-labelledby="venues-heading">
          <h1 id="venues-heading">Quintas, halls and conference rooms</h1>
          <p>Quintas in the country for weddings and family days, halls in the city for dinners and galas, rooms for talks and training. Every room is drawn seat by seat.</p>
        </section>
        <Chips label="Kind of venue">
          <Chip pressed={kind === null} onClick={() => choose(null)}>
            All
          </Chip>
          {VENUE_KINDS.map((k) => (
            <Chip key={k.key} pressed={kind === k.key} onClick={() => choose(k.key)}>
              {k.label}
            </Chip>
          ))}
        </Chips>
        <div className="ep-guests">
          <label htmlFor="venues-guests">Guests</label>
          <input
            id="venues-guests"
            type="number"
            inputMode="numeric"
            min={1}
            max={2000}
            placeholder="Any"
            value={guests ?? ""}
            onChange={(event) => setGuests(guestsFrom(event.target.value))}
          />
        </div>
        <div className="discover-results-head ep-results-head">
          <h2>{heading}</h2>
        </div>
        <section aria-label="Venues" aria-busy={venues.state.status === "loading"}>
          {venues.state.status === "loading" && <Skeleton lines={6} label="Finding venues" />}
          {venues.state.status === "error" && <ErrorState message={errorMessage(venues.state.error, "We could not load the venues. Please try again.")} onRetry={() => venues.reload()} />}
          {venues.state.status === "ready" &&
            (shown.length === 0 ? (
              <EmptyState title="No venues here yet" action={filtered ? <Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>Show all venues</Button> : undefined}>
                <p>{filtered ? "None of the published venues matches these filters." : "New venues appear here when they publish their page."}</p>
              </EmptyState>
            ) : (
              <div className="ep-venue-grid">
                {shown.map((venue) => (
                  <VenueCard key={venue.slug} venue={venue} typeLabels={labels} />
                ))}
              </div>
            ))}
        </section>
      </PageShell>
    </div>
  );
}
