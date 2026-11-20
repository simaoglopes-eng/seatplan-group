// Route /directory: real quintas, halls and conference centres in Portugal, Belgium and
// Italy. Country, kind and search live in the address (?country=PT&kind=estate&q=sintra),
// so the home page links straight to a filtered list. The server filters and pages.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getDirectory } from "../../api/venueDirectory";
import type { DirectoryCountry, DirectoryKind, Listing } from "../../api/venueDirectory";
import { Button, EmptyState, ErrorState, PageShell, Skeleton } from "../../design/components";
import { Chip, Chips } from "../discover/Chips";
import { PublicHeaderActions } from "../discover/PublicHeaderActions";
import { errorMessage } from "../restaurant/format";
import { useLoad } from "../restaurant/useLoad";
import { COUNTRIES, KINDS, countryFrom, kindFrom } from "./directoryModel";
import { Attribution, ListingCard } from "./ListingCard";
import { PageBand, countText } from "../events-public/PageBand";
import "../discover/discover.css";
import "../events-public/events-public.css";
import "./directory.css";

const PAGE = 24;

export default function DirectoryPage() {
  const [params, setParams] = useSearchParams();
  const country = countryFrom(params.get("country"));
  const kind = kindFrom(params.get("kind"));
  const q = (params.get("q") ?? "").slice(0, 60);
  const [text, setText] = useState(q);
  const [extra, setExtra] = useState<Listing[]>([]);
  const [moreBusy, setMoreBusy] = useState(false);
  const key = `${country ?? ""}|${kind ?? ""}|${q}`;
  const list = useLoad(() => getDirectory({ country, kind, q, limit: PAGE }), key);

  useEffect(() => setExtra([]), [key]);
  useEffect(() => setText(q), [q]);
  // Typing searches after a short pause, so each key press is not a request.
  useEffect(() => {
    if (text.trim() === q) return;
    const timer = window.setTimeout(() => set("q", text.trim() || null), 350);
    return () => window.clearTimeout(timer);
  }, [text]);

  function set(name: string, value: string | null): void {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  }

  const ready = list.state.status === "ready" ? list.state.data : null;
  const items = ready ? [...ready.items, ...extra] : [];
  async function more(): Promise<void> {
    setMoreBusy(true);
    try {
      const page = await getDirectory({ country, kind, q, limit: PAGE, offset: items.length });
      setExtra((current) => [...current, ...page.items]);
    } finally {
      setMoreBusy(false);
    }
  }

  return (
    <div className="discover-route pg-route dir-page">
      <PageShell title="Venue directory" headerActions={<PublicHeaderActions />}>
        <PageBand id="dir-heading" eyebrow="Portugal · Belgium · Italy" title="Venues in Portugal, Belgium and Italy" count={countText(ready ? ready.total : list.state.status === "error" ? undefined : null, "venue", "venues")}>
          Real quintas, event halls and conference centres. Pick one and plan your event there: draw its tables and invite your guests.
        </PageBand>
        <Link className="rp-back ep-back" to="/">
          ← Back to home
        </Link>
        <Chips label="Country">
          <Chip pressed={country === null} onClick={() => set("country", null)}>
            All countries
          </Chip>
          {COUNTRIES.map((c) => (
            <Chip key={c.key} pressed={country === c.key} onClick={() => set("country", c.key as DirectoryCountry)}>
              {c.label}
            </Chip>
          ))}
        </Chips>
        <Chips label="Kind of venue">
          <Chip pressed={kind === null} onClick={() => set("kind", null)}>
            Every kind
          </Chip>
          {KINDS.map((k) => (
            <Chip key={k.key} pressed={kind === k.key} onClick={() => set("kind", k.key as DirectoryKind)}>
              {k.label}
            </Chip>
          ))}
        </Chips>
        <div className="dir-search">
          <label htmlFor="dir-q">Search by name or town</label>
          <input id="dir-q" type="search" maxLength={60} value={text} placeholder="e.g. Lisboa, Quinta, Gent, Roma" onChange={(event) => setText(event.target.value)} />
        </div>
        <div className="discover-results-head ep-results-head">
          <h2 aria-live="polite">{ready ? `${ready.total.toLocaleString("en-GB")} ${ready.total === 1 ? "venue" : "venues"}` : "Finding venues"}</h2>
        </div>
        <section aria-label="Venues" aria-busy={list.state.status === "loading"}>
          {list.state.status === "loading" && <Skeleton lines={6} label="Finding venues" />}
          {list.state.status === "error" && <ErrorState message={errorMessage(list.state.error, "We could not load the venues. Please try again.")} onRetry={() => list.reload()} />}
          {ready &&
            (items.length === 0 ? (
              <EmptyState title="No venue matches" action={<Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>Show every venue</Button>}>
                <p>Try another town, country or kind of venue.</p>
              </EmptyState>
            ) : (
              <>
                <div className="dir-grid">
                  {items.map((listing) => (
                    <ListingCard key={listing.id} listing={listing} />
                  ))}
                </div>
                {items.length < ready.total && (
                  <p className="dir-more">
                    <Button onClick={() => void more()} disabled={moreBusy} aria-busy={moreBusy}>
                      {moreBusy ? "Loading…" : `Show more (${ready.total - items.length} left)`}
                    </Button>
                  </p>
                )}
              </>
            ))}
        </section>
        <Attribution />
      </PageShell>
    </div>
  );
}
