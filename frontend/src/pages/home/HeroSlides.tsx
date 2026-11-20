// The hero's background: three credited photos that cross-fade every 6.5 s with a
// slow zoom. The photos are decorative (the copy says what the page is), so their
// alt text is empty. Dots pick a slide; the timer stops while the tab is hidden and
// never runs under reduced motion.
import { useEffect, useState } from "react";
import { useReducedMotion } from "./useMotion";

/** Long tables and dinners (direction E). landing.css frames each one (object-position) for tall phones. */
export const HERO_SLIDES = [
  { src: "/images/photos/hero-terrace-assisi.jpg", width: 2000, height: 1333, label: "Terrace dinner in Assisi" },
  { src: "/images/photos/hero-dinner-giant.jpg", width: 2000, height: 824, label: "A long sit-down dinner" },
  { src: "/images/photos/hero-dining-hall.jpg", width: 2000, height: 1333, label: "Formal dining hall" },
] as const;

export const SLIDE_MS = 6500;

/** False while the tab is hidden, so the slide clocks stop. */
export function useTabVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const update = (): void => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export function useSlides(count: number): { index: number; go: (i: number) => void } {
  const reduced = useReducedMotion();
  const visible = useTabVisible();
  const [index, setIndex] = useState(0);
  // Re-armed on every change of slide, so picking a dot gives that photo its full time.
  useEffect(() => {
    if (reduced || !visible || count < 2) return undefined;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [index, reduced, visible, count]);
  return { index, go: (i: number) => setIndex(((i % count) + count) % count) };
}

export function HeroPhotos({ index }: { index: number }) {
  return (
    <div className="ld-slides" aria-hidden="true">
      {HERO_SLIDES.map((s, i) => (
        <img
          key={s.src}
          className={i === index ? "is-on" : undefined}
          src={s.src}
          width={s.width}
          height={s.height}
          alt=""
          loading={i === 0 ? undefined : "lazy"}
          decoding={i === 0 ? undefined : "async"}
        />
      ))}
    </div>
  );
}

export function HeroDots({ index, go }: { index: number; go: (i: number) => void }) {
  return (
    <div className="ld-dots" role="group" aria-label="Background photos">
      {HERO_SLIDES.map((s, i) => (
        <button key={s.src} type="button" aria-label={`Photo ${i + 1}: ${s.label}`} aria-pressed={i === index} onClick={() => go(i)} />
      ))}
    </div>
  );
}
