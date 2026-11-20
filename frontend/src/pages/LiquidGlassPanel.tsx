import type { ComponentPropsWithoutRef, PointerEvent as ReactPointerEvent } from "react";

type LiquidGlassPanelProps = Pick<
  ComponentPropsWithoutRef<"section">,
  "aria-labelledby" | "children" | "className"
>;

function reducedMotionRequested(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function moveGlass(event: ReactPointerEvent<HTMLElement>): void {
  if (event.pointerType === "touch" || reducedMotionRequested()) return;

  const panel = event.currentTarget;
  const bounds = panel.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) return;

  const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));

  panel.style.setProperty("--glass-pointer-x", `${(x * 100).toFixed(2)}%`);
  panel.style.setProperty("--glass-pointer-y", `${(y * 100).toFixed(2)}%`);
  panel.style.setProperty("--glass-tilt-x", `${((0.5 - y) * 0.7).toFixed(2)}deg`);
  panel.style.setProperty("--glass-tilt-y", `${((x - 0.5) * 0.9).toFixed(2)}deg`);
  panel.dataset.glassActive = "true";
}

function resetGlass(event: ReactPointerEvent<HTMLElement>): void {
  const panel = event.currentTarget;
  panel.dataset.glassActive = "false";
  panel.style.setProperty("--glass-pointer-x", "50%");
  panel.style.setProperty("--glass-pointer-y", "8%");
  panel.style.setProperty("--glass-tilt-x", "0deg");
  panel.style.setProperty("--glass-tilt-y", "0deg");
}

/** Lightweight, pointer-aware glass surface with a no-motion fallback. */
export default function LiquidGlassPanel({
  "aria-labelledby": labelledBy,
  children,
  className = "",
}: LiquidGlassPanelProps) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={`welcome-panel ${className}`.trim()}
      data-glass-active="false"
      onPointerMove={moveGlass}
      onPointerLeave={resetGlass}
    >
      <span className="welcome-panel-lens" aria-hidden="true" />
      <div className="welcome-panel-content">{children}</div>
    </section>
  );
}
