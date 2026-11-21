// The photo band at the top of /directory, /events and /venues (direction E): a credited
// photograph runs to the window edges under a dark legibility gradient, and the eyebrow,
// title, one line of context and the live count sit in a glass panel over it. Glass only
// ever sits over a photograph. The band breaks out of the page column with negative
// margins; the page wrapper (.pg-route) clips the overflow, so it never widens the page.
import type { ReactNode } from "react";

export interface BandPhoto {
  /** Served path of a photo credited on /credits (photoCredits.ts or venuePhotos.ts). */
  src: string;
  /** CSS object-position, to keep the subject in frame on a wide band. */
  position?: string;
}

export function PageBand({ id, eyebrow, title, children, count, photo }: { id: string; eyebrow: string; title: string; children: ReactNode; count: ReactNode; photo: BandPhoto }) {
  return (
    <section className="pg-band photo-band" aria-labelledby={id}>
      {/* Decoration: the band's words carry the meaning, so the photo has empty alt text. */}
      <div className="photo-band-photo pg-band-photo">
        <img src={photo.src} alt="" style={photo.position ? { objectPosition: photo.position } : undefined} />
      </div>
      <div className="photo-band-inner pg-band-inner">
        <div className="pg-band-panel glass-panel">
          <div className="pg-band-text">
            <p className="pg-eyebrow glass-eyebrow">{eyebrow}</p>
            <h1 id={id}>{title}</h1>
            <p className="pg-band-lede glass-muted">{children}</p>
          </div>
          <p className="pg-band-count">{count}</p>
        </div>
      </div>
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
