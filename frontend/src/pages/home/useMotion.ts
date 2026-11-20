// Small motion helpers for the home page. Every one of them starts from the final,
// readable state (text visible, numbers at their value) and only animates when the
// browser can observe the element and the visitor has not asked for reduced motion.
import { useCallback, useEffect, useRef, useState } from "react";

const REDUCE = "(prefers-reduced-motion: reduce)";

/** True when the visitor asked the system for less motion; follows changes live. */
export function useReducedMotion(): boolean {
  const query = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(REDUCE) : null;
  const [reduced, setReduced] = useState<boolean>(() => query?.matches ?? false);
  useEffect(() => {
    if (!query) return undefined;
    const update = (): void => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
    // The query object is recreated per render; its media string never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return reduced;
}

function canObserve(): boolean {
  return typeof window !== "undefined" && typeof window.IntersectionObserver === "function";
}

/**
 * Drift in: a block that starts below the fold is nudged down and slightly faded
 * (never invisible) and settles when it enters the screen. Returns a ref callback.
 */
export function useReveal<T extends HTMLElement>(): (el: T | null) => void {
  const reduced = useReducedMotion();
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback(
    (el: T | null) => {
      cleanup.current?.();
      cleanup.current = null;
      if (!el || reduced || !canObserve()) return;
      if (el.getBoundingClientRect().top <= window.innerHeight) return;
      el.classList.add("ld-pre");
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            el.classList.remove("ld-pre");
            io.disconnect();
          }
        },
        { threshold: 0.12 },
      );
      io.observe(el);
      cleanup.current = () => {
        io.disconnect();
        el.classList.remove("ld-pre");
      };
    },
    [reduced],
  );
}

/**
 * A number that counts up from zero the first time it enters the screen. It shows
 * its final value until then, and always under reduced motion or without an observer.
 */
export function useCountUp<T extends HTMLElement>(value: number): { ref: (el: T | null) => void; shown: number } {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const [el, setEl] = useState<T | null>(null);
  const played = useRef(false);

  useEffect(() => {
    setShown(value);
  }, [value]);

  useEffect(() => {
    if (!el || reduced || played.current || value <= 0 || !canObserve() || typeof window.requestAnimationFrame !== "function") return undefined;
    let frame = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        played.current = true;
        const t0 = performance.now();
        const step = (t: number): void => {
          const p = Math.min(1, (t - t0) / 1200);
          setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
          if (p < 1) frame = window.requestAnimationFrame(step);
        };
        frame = window.requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.cancelAnimationFrame(frame);
      setShown(value);
    };
  }, [el, reduced, value]);

  return { ref: setEl, shown };
}
