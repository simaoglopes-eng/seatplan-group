// Home: explain SeatPlan in one screen and offer one-click demo entry points.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, getDemoLinks } from "../api/client";
import { EmptyState, ErrorState, Legend, PageShell, Skeleton } from "../design/components";
import { SeatMap } from "../seatmap/SeatMap";
import { PublicHeaderActions } from "./discover/PublicHeaderActions";
import { demoCards } from "./demoLinks";
import type { DemoCard as DemoCardKey, DemoCardLink } from "./demoLinks";
import { SAMPLE_RECOMMENDED, buildSampleFloor } from "./homeSample";
import "./demo-home.css";

type Cards = Record<DemoCardKey, DemoCardLink[]>;
type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; links: Record<string, string> };

function useDemoLinks(): { state: LoadState; reload: () => void } {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const load = useCallback(() => {
    setState({ kind: "loading" });
    getDemoLinks()
      .then((data) => setState({ kind: "ready", links: data.links ?? {} }))
      .catch((error: unknown) => {
        // The backend answers 404 when DEMO_MODE is off: that is "no demo", not a failure.
        if (error instanceof ApiError && error.code === "not_found") {
          setState({ kind: "ready", links: {} });
          return;
        }
        const message = error instanceof ApiError ? error.message : "The demo links could not be loaded.";
        setState({ kind: "error", message });
      });
  }, []);
  useEffect(load, [load]);
  return { state, reload: load };
}

export default function DemoHome() {
  const { state, reload } = useDemoLinks();
  return (
    <PageShell title="Choose your seat" headerActions={<PublicHeaderActions />}>
      <Hero />
      <section className="home-demo" aria-labelledby="demo-heading">
        <h2 id="demo-heading">Open the live demo</h2>
        <p className="home-muted">Each link opens the demo as a different person. Open two in separate windows to watch seats change live.</p>
        <DemoLinks state={state} reload={reload} />
      </section>
      <HowItWorks />
    </PageShell>
  );
}

function Hero() {
  const floor = useMemo(buildSampleFloor, []);
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <section className="home-hero" aria-labelledby="hero-heading">
      <div className="home-hero-text">
        <p className="home-eyebrow">Weddings, dinners and conferences</p>
        <h1 id="hero-heading">Pick your own seat, next to the people you know.</h1>
        <p className="home-lede">
          SeatPlan shows the room as it really is, live. Guests choose a seat or a table themselves; a planner suggests the best
          spots and explains why; and the database makes sure no seat is ever given out twice.
        </p>
        <Legend states={["free", "held", "taken", "friend", "blocked"]} showAccessible showRecommended />
      </div>
      <div className="home-hero-map">
        <SeatMap
          label="Sample seat map, try choosing a seat"
          tables={floor.tables}
          seats={floor.seats}
          highlight={SAMPLE_RECOMMENDED}
          selectedId={selected}
          onSelect={setSelected}
        />
      </div>
    </section>
  );
}

// Events only in this project. Each card starts with two people to be (plan 2026-11-18, "Later decisions"), then a small
// link to browse. The other demo links stay in the backend and are hidden by demoCards().
const CARDS: { key: DemoCardKey; title: string; blurb: string; browse: { to: string; label: string } }[] = [
  {
    key: "events",
    title: "Events",
    blurb: "Pick an event and choose your seat, or plan the room for an event you run.",
    browse: { to: "/venues", label: "Browse halls and quintas" },
  },
];

function DemoLinks({ state, reload }: { state: LoadState; reload: () => void }) {
  if (state.kind === "loading") return <Skeleton lines={4} label="Loading demo links" />;
  if (state.kind === "error") return <ErrorState title="The demo is not reachable" message={state.message} onRetry={reload} />;
  if (Object.keys(state.links).length === 0) {
    return (
      <EmptyState title="The demo is switched off">
        <p>This server runs without demo data. Ask an organiser to sign in and create a venue.</p>
      </EmptyState>
    );
  }
  const cards: Cards = demoCards(state.links);
  return (
    <div className="home-cards">
      {CARDS.map((card) => (
        <DemoCard key={card.key} title={card.title} blurb={card.blurb} links={cards[card.key]} browse={card.browse} />
      ))}
    </div>
  );
}

// The path itself is never printed: personal links end in a 43-character secret
// token, which is unreadable and has no place to wrap on a phone.
function DemoCard({ title, blurb, links, browse }: { title: string; blurb: string; links: DemoCardLink[]; browse: { to: string; label: string } }) {
  return (
    <article className="home-card">
      <h3>{title}</h3>
      <p className="home-muted">{blurb}</p>
      {links.length === 0 ? (
        <p className="home-muted">No demo links for this part yet.</p>
      ) : (
        <ul className="home-links">
          {links.map((link) => (
            <li key={link.name}>
              <Link to={link.path} className="home-link">
                <span className="home-link-label">{link.label}</span>
                <span className="home-link-desc">{link.description}</span>
                <span className="home-link-arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="home-browse">
        <Link to={browse.to}>{browse.label}</Link>
      </p>
    </article>
  );
}

const STEPS = [
  { title: "See the room", body: "A live map of tables and seats. Changes from other people appear within a second or two." },
  { title: "Get a suggestion", body: "The planner recommends seats near people you know, and tells you why in plain words." },
  { title: "Confirm, and it is yours", body: "Choosing a seat reserves nothing: the first person to confirm gets it, and the database never gives a seat out twice." },
];

function HowItWorks() {
  return (
    <section className="home-how" aria-labelledby="how-heading">
      <h2 id="how-heading">How it works</h2>
      <ol className="home-steps">
        {STEPS.map((step) => (
          <li key={step.title}>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
