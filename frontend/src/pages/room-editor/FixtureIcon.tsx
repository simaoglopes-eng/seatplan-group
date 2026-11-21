import type { FixtureKind } from "./roomModel";

/** Everything that can wear an icon: a fixed element, or one of the two zones the owner can add. */
export type IconKind = FixtureKind | "terrace" | "quiet" | "round_table" | "square_table" | "long_table" | "counter_table";

/** Line icons on a 24 x 24 grid, one per kind of fixed element (older plans can hold all of them). */
const PATHS: Record<IconKind, string> = {
  round_table: "M12 8a4 4 0 1 0 0.01 0z M12 2v2 M12 20v2 M2 12h2 M20 12h2",
  square_table: "M7 7h10v10H7z M10 3h4 M10 21h4 M3 10v4 M21 10v4",
  long_table: "M4 8h16v8H4z M7 4h3 M14 4h3 M7 20h3 M14 20h3",
  counter_table: "M3 9h18v5H3z M6 19v-3 M12 19v-3 M18 19v-3",
  terrace: "M3 11a9 9 0 0 1 18 0z M12 11v10 M9 21h6",
  quiet: "M20 14a8 8 0 1 1-10-10 6.5 6.5 0 0 0 10 10z",
  bar: "M4 5h16l-8 9z M12 14v6 M8 20h8",
  wc: "M8 3h8v5H8z M6 10h12c0 4-2 7-6 7s-6-3-6-7z M10 17v4h4v-4",
  stairs: "M3 20h5v-5h5v-5h5V5h3",
  tv: "M3 5h18v12H3z M8 21h8 M12 17v4",
  kitchen: "M5 10h14v9H5z M3 10h18 M9 6c0-2 3-2 3-4 M15 6c0-2 3-2 3-4",
  column: "M12 4a8 8 0 1 0 0.01 0z",
  plant: "M12 21v-9 M12 13c-4 0-6-3-6-6 4 0 6 3 6 6z M12 13c4 0 6-3 6-6-4 0-6 3-6 6z",
  stage: "M3 19h18 M6 19V9h12v10",
  fireplace: "M4 20h16 M6 20V7h12v13 M12 18c-3 0-3-4 0-6 3 2 3 6 0 6z",
  host_stand: "M7 10h10v10H7z M10 10V6h4v4",
  awning: "M3 9l2-5h14l2 5z M3 9c0 2 4 2 4 0 0 2 5 2 5 0 0 2 5 2 5 0 0 2 4 2 4 0z",
};

/** The icon for a kind of fixed element, centred on (0, 0) in a square of `size` units. Draw it inside an svg. */
export function FixtureIcon({ kind, size }: { kind: IconKind; size: number }) {
  return <g className="room-fixture-icon" aria-hidden="true" transform={`translate(${-size / 2} ${-size / 2}) scale(${size / 24})`}>
    <path d={PATHS[kind]} />
  </g>;
}
