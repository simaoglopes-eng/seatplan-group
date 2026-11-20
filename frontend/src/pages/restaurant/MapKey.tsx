// A legend with words chosen by the page. The shared <Legend> uses the
// events wording ("Closed by the organiser"); diners and staff need their own
// words for the same glyphs. We still draw the glyphs with the shared
// SeatGlyph, so the key can never show a different symbol than the map.
import { useId } from "react";
import type { SeatState } from "../../api/types";
import { SEAT_RADIUS } from "../../seatmap/geometry";
import { PatternDefs, SeatGlyph, safeId } from "../../seatmap/glyphs";
import { RoomDefs } from "../../seatmap/RoomLayers";

export interface KeyEntry {
  state: SeatState;
  name: string;
  hint: string;
  accessible?: boolean;
  /** Draws the brass "recommended" halo around the glyph. */
  halo?: boolean;
}

/** What the room layers add to the map: sun, darkness and a window with a view. */
export interface SceneEntry {
  scene: "sun" | "night" | "view";
  name: string;
  hint: string;
}

function SceneSwatch({ scene, id }: { scene: SceneEntry["scene"]; id: string }) {
  if (scene === "sun") {
    return (
      <svg className="legend-swatch" viewBox="-14 -14 28 28" aria-hidden="true">
        <RoomDefs prefix={id} />
        <rect x="-12" y="-12" width="24" height="24" rx="3" fill={`url(#${id}-sun)`} className="legend-scene-sun" />
      </svg>
    );
  }
  if (scene === "night") {
    return (
      <svg className="legend-swatch" viewBox="-14 -14 28 28" aria-hidden="true">
        <rect x="-12" y="-12" width="24" height="24" rx="3" className="legend-scene-floor" />
        <rect x="-12" y="-12" width="24" height="24" rx="3" className="legend-scene-night" />
      </svg>
    );
  }
  return (
    <svg className="legend-swatch" viewBox="-14 -14 28 28" aria-hidden="true">
      <g className="room-view-icon">
        <circle r="11" />
        <path d="M-7 0Q0 -6 7 0Q0 6 -7 0Z" />
        <circle r="2.2" className="room-view-pupil" />
      </g>
    </svg>
  );
}

/** The diner's floor plan (FloorPlan.tsx) draws tables, not glyphs: its key shows the same three looks. */
function PlanSwatch({ state, id }: { state: SeatState; id: string }) {
  const look = state === "free" ? "is-free" : state === "mine" ? "is-selected" : "is-off";
  return (
    <svg className="legend-swatch fp" viewBox="-15 -12 30 24" aria-hidden="true">
      <defs>
        <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect className="fp-hatch-bg" width="6" height="6" />
          <path className="fp-hatch-line" d="M0 0v6" />
        </pattern>
      </defs>
      <g className={`fp-table ${look}`} style={{ ["--fp-hatch" as string]: `url(#${id}-hatch)` }}>
        <rect className="fp-top" x="-12" y="-9" width="24" height="18" rx="5" />
      </g>
    </svg>
  );
}

export function MapKey({ entries, scenes = [], label = "Map key", look = "glyph" }: { entries: KeyEntry[]; scenes?: SceneEntry[]; label?: string; look?: "glyph" | "plan" }) {
  const prefix = safeId(useId());
  const half = SEAT_RADIUS + 6;
  return (
    <ul className="legend" aria-label={label}>
      {entries.map((entry) => {
        const id = `${prefix}-${entry.state}-${entry.accessible ? "a" : "n"}-${entry.halo ? "h" : "n"}`;
        return (
          <li key={id} className="legend-item">
            {look === "plan" ? (
              <PlanSwatch state={entry.state} id={id} />
            ) : (
              <svg className="legend-swatch" viewBox={`${-half} ${-half} ${half * 2} ${half * 2}`} aria-hidden="true">
                <PatternDefs prefix={id} />
                {entry.halo && <circle r={SEAT_RADIUS + 5} className="ring-highlight legend-static" />}
                <SeatGlyph state={entry.state} accessible={entry.accessible ?? false} prefix={id} />
              </svg>
            )}
            <span>
              <strong className="legend-name">{entry.name}</strong>
              <span className="legend-hint">{entry.hint}</span>
            </span>
          </li>
        );
      })}
      {scenes.map((entry) => {
        const id = `${prefix}-scene-${entry.scene}`;
        return (
          <li key={id} className="legend-item">
            <SceneSwatch scene={entry.scene} id={id} />
            <span>
              <strong className="legend-name">{entry.name}</strong>
              <span className="legend-hint">{entry.hint}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The key for the diner's table map: three looks and no more ("Selected" while exploring, "Held for you" after the hold). The wheelchair badge sits on the
 * tables that are accessible and needs no entry of its own; why a table is unavailable is said in its
 * card and to screen readers.
 */
export const DINER_KEY: KeyEntry[] = [
  { state: "free", name: "Available", hint: "Tap a table to see what it is like" },
  { state: "mine", name: "Selected", hint: "The table you are looking at" },
  { state: "taken", name: "Unavailable", hint: "Booked, or not right for your party" },
];

/** The same key once a table is held: the middle look now means the table is reserved for the diner. */
export const DINER_KEY_HELD: KeyEntry[] = [
  DINER_KEY[0],
  { state: "mine", name: "Held for you", hint: "Reserved for you while you finish the booking" },
  DINER_KEY[2],
];

/** What the sun, the night and the view icon mean; said once, next to the light preview, not in the key. */
export const SCENE_NOTE = "On the plan, yellow is where the sun reaches the floor, a dark floor with candles is after sunset, and the band beyond the glass is the view.";

/** Kept for the staff and owner screens that still list the room layers in a key. */
export const ROOM_KEY: SceneEntry[] = [
  { scene: "sun", name: "Direct sun", hint: "Striped areas: the sun reaches the floor" },
  { scene: "night", name: "After dark", hint: "The room is shaded dark blue once the sun has set" },
  { scene: "view", name: "View", hint: "A window with a view worth looking at" },
];
