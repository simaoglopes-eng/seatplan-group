// The short navy band at the top of /directory, /events and /venues: an eyebrow, the page
// title, one line of context and the live count, so these pages read as the same site as
// the landing. It bleeds to the window edges with a box-shadow (events-public.css), so it
// never widens the page.
import type { ReactNode } from "react";

export function PageBand({ id, eyebrow, title, children, count }: { id: string; eyebrow: string; title: string; children: ReactNode; count: ReactNode }) {
  return (
    <section className="pg-band" aria-labelledby={id}>
      <div className="pg-band-text">
        <p className="pg-eyebrow">{eyebrow}</p>
        <h1 id={id}>{title}</h1>
        <p className="pg-band-lede">{children}</p>
      </div>
      <p className="pg-band-count">{count}</p>
    </section>
  );
}

/** "1,835 venues" in the site's English, "Counting…" while loading (null), nothing after an error (undefined). */
export function countText(value: number | null | undefined, one: string, many: string): ReactNode {
  if (value === undefined) return null;
  if (value === null) return <span className="pg-band-wait">Counting…</span>;
  return (
    <>
      <strong>{value.toLocaleString("en-GB")}</strong> <span>{value === 1 ? one : many}</span>
    </>
  );
}
