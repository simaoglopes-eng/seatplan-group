import { geometryLines } from "./vectorTile";
import type { MapLayer } from "./vectorTile";

/*
 * The names on the discovery map: main areas (districts and neighbourhoods), rivers and the sea, parks, and streets.
 * They are chosen across the whole view, not tile by tile, so a name is never cut in half where two tiles meet, and
 * two names never overlap. Everything here is plain geometry; discoveryLabels.ts fetches the tiles and draws.
 */
export interface Pt { x: number; y: number }
export type LabelKind = "area" | "water" | "park" | "place" | "waterway" | "street";
export interface LabelStyle { kind: LabelKind; rank: number; font: string; color: string; halo: string; haloWidth: number; spacing?: number; upper?: boolean; dot?: boolean }
export interface Candidate { text: string; style: LabelStyle; lines: Pt[][] }
export interface Placed { text: string; style: LabelStyle; x: number; y: number; angle: number; width: number; height: number }

/** The vector tile layers the names come from. */
export const LABEL_LAYERS: ReadonlySet<string> = new Set(["place", "water_name", "park", "poi", "waterway", "transportation_name"]);

const sans = "system-ui, -apple-system, 'Segoe UI', sans-serif";
// Names are drawn in soft tones with a halo in the colour of the land under them, so they read as part of the map.
const LAND_HALO = "rgba(228, 240, 245, 0.92)", ROAD_HALO = "rgba(251, 254, 255, 0.9)";
const AREA = "#7a7d99", WATER = "#5b9db8", PARK = "#4f8f6f", PLACE = "#9a7342", STREET = "#6c7580";

// [lowest zoom, highest zoom] in which a kind of place is named.
const PLACES: Record<string, { zooms: [number, number]; rank: number; size: number; weight: number; spacing: number; color: string }> = {
  city: { zooms: [3, 15], rank: 0, size: 14, weight: 700, spacing: 3, color: "#5f6283" },
  town: { zooms: [6, 16], rank: 1, size: 12.5, weight: 700, spacing: 2.2, color: "#656885" },
  village: { zooms: [9, 17], rank: 2, size: 11.5, weight: 600, spacing: 1.6, color: AREA },
  suburb: { zooms: [10, 16], rank: 3, size: 11, weight: 600, spacing: 2, color: AREA },
  quarter: { zooms: [12, 17], rank: 4, size: 10.5, weight: 600, spacing: 1.8, color: AREA },
  neighbourhood: { zooms: [13, 18], rank: 5, size: 10, weight: 600, spacing: 1.6, color: AREA },
  island: { zooms: [8, 19], rank: 3, size: 11, weight: 600, spacing: 1.6, color: AREA },
};
// The lowest zoom at which each class of street is named.
const STREETS: Record<string, { from: number; rank: number; size: number }> = {
  motorway: { from: 11, rank: 20, size: 11 }, trunk: { from: 11, rank: 21, size: 11 }, primary: { from: 12, rank: 22, size: 11 },
  secondary: { from: 13, rank: 23, size: 10.5 }, tertiary: { from: 14, rank: 24, size: 10 }, minor: { from: 15, rank: 25, size: 10 },
  pedestrian: { from: 16, rank: 26, size: 9.5 }, service: { from: 17, rank: 27, size: 9.5 }, path: { from: 17, rank: 28, size: 9.5 }, track: { from: 17, rank: 28, size: 9.5 },
};
// Places worth finding (the poi layer). Each class has a group; the group says how many of a tile's places show at each zoom
// (a place's rank is its importance within its tile, 1 being the most). Artworks, picnic sites and the like are left out.
const GREEN = new Set(["park", "garden", "dog_park", "playground"]);
const HERITAGE = new Set(["monument", "castle", "museum", "zoo", "aquarium", "viewpoint", "attraction"]);
const PUBLIC = new Set(["theatre", "stadium", "library", "cinema", "place_of_worship", "art_gallery", "university", "hospital", "railway"]);
const SKIP = new Set(["artwork", "picnic_site", "information", "gallery", "bench"]);
const ranked = (rank: number | undefined, zoom: number, limits: [number, number, number]) => zoom >= 17 || (rank ?? 99) <= (zoom >= 16 ? limits[2] : zoom >= 15 ? limits[1] : limits[0]);

function sightStyle(category: string, zoom: number, rank?: number, subclass?: string): LabelStyle | null {
  if (subclass && SKIP.has(subclass)) return null;
  const font = `600 10.5px ${sans}`;
  if (GREEN.has(category)) return zoom >= 14 && ranked(rank, zoom, [10, 40, 99]) ? { kind: "park", rank: 10, font, color: PARK, halo: LAND_HALO, haloWidth: 3, dot: true } : null;
  if (HERITAGE.has(category)) return zoom >= 14 && ranked(rank, zoom, [4, 8, 20]) ? { kind: "place", rank: 11, font, color: PLACE, halo: LAND_HALO, haloWidth: 3, dot: true } : null;
  if (PUBLIC.has(category)) return zoom >= 15 && ranked(rank, zoom, [0, 4, 10]) ? { kind: "place", rank: 12, font, color: PLACE, halo: LAND_HALO, haloWidth: 3, dot: true } : null;
  return null;
}

/** How a feature is named at this zoom, or null when it is not named (too small a thing for this zoom, or nothing to name). */
export function labelStyle(layer: string, category: string | undefined, zoom: number, extra: { rank?: number; subclass?: string } = {}): LabelStyle | null {
  const c = category ?? "";
  if (layer === "place") {
    const place = Object.hasOwn(PLACES, c) ? PLACES[c] : null;
    if (!place || zoom < place.zooms[0] || zoom > place.zooms[1]) return null;
    return { kind: "area", rank: place.rank, font: `${place.weight} ${place.size}px ${sans}`, color: place.color, halo: LAND_HALO, haloWidth: 3, spacing: place.spacing, upper: true };
  }
  if (layer === "water_name") return zoom >= 9 ? { kind: "water", rank: 8, font: `italic 500 12px ${sans}`, color: WATER, halo: LAND_HALO, haloWidth: 3, spacing: 1.4 } : null;
  if (layer === "waterway") return zoom >= (c === "river" ? 12 : 15) ? { kind: "waterway", rank: 9, font: `italic 500 11px ${sans}`, color: WATER, halo: LAND_HALO, haloWidth: 3, spacing: 1 } : null;
  if (layer === "park") return zoom >= 14 ? { kind: "park", rank: 10, font: `600 10.5px ${sans}`, color: PARK, halo: LAND_HALO, haloWidth: 3, dot: true } : null;
  if (layer === "poi") return sightStyle(c, zoom, extra.rank, extra.subclass);
  if (layer === "transportation_name") {
    const street = Object.hasOwn(STREETS, c) ? STREETS[c] : null;
    return street && zoom >= street.from ? { kind: "street", rank: street.rank, font: `500 ${street.size}px ${sans}`, color: STREET, halo: ROAD_HALO, haloWidth: 2.6, spacing: 0.4 } : null;
  }
  return null;
}

/** The names a tile offers, with their geometry in world pixels at `zoom` (a tile of the pyramid at `tile.z` is 256 px wide there at scale 1). */
export function tileCandidates(layers: ReadonlyMap<string, MapLayer>, tile: { x: number; y: number; z: number }, zoom: number): Candidate[] {
  const out: Candidate[] = [], span = 256 * 2 ** (zoom - tile.z);
  for (const [name, layer] of layers) {
    for (const feature of layer.features) {
      const full = feature.name?.trim();
      if (!full) continue;
      const style = labelStyle(name, feature.category, zoom, feature);
      if (!style) continue;
      const text = style.kind !== "street" && full.length > 30 ? `${full.slice(0, 28).trimEnd()}…` : full; // a long official name would cover half the map
      const k = span / layer.extent;
      const lines = geometryLines(feature.geometry, k).map(line => line.map(p => ({ x: tile.x * span + p.x, y: tile.y * span + p.y })));
      if (lines.length) out.push({ text, style, lines });
    }
  }
  return out;
}

const near = (a: Pt, b: Pt, tolerance: number) => Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;

/** Joins the pieces of one street that were cut apart where two tiles meet. */
export function stitch(lines: Pt[][], tolerance = 1.5): Pt[][] {
  const rest = lines.filter(l => l.length > 1).map(l => [...l]);
  const done: Pt[][] = [];
  while (rest.length) {
    let chain = rest.pop()!, joined = true;
    while (joined) {
      joined = false;
      for (let i = rest.length - 1; i >= 0; i--) {
        const other = rest[i], head = chain[0], tail = chain[chain.length - 1];
        if (near(tail, other[0], tolerance)) chain = [...chain, ...other.slice(1)];
        else if (near(tail, other[other.length - 1], tolerance)) chain = [...chain, ...other.slice(0, -1).reverse()];
        else if (near(head, other[other.length - 1], tolerance)) chain = [...other.slice(0, -1), ...chain];
        else if (near(head, other[0], tolerance)) chain = [...other.slice(1).reverse(), ...chain];
        else continue;
        rest.splice(i, 1); joined = true;
      }
    }
    done.push(chain);
  }
  return done;
}

interface Sample extends Pt { s: number }
function densify(line: Pt[], step = 3): Sample[] {
  const out: Sample[] = [{ ...line[0], s: 0 }];
  let length = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n, s: length + d * k / n });
    length += d;
  }
  return out;
}

/** Where along a line a name of `width` px fits inside `box`: its middle and the angle (degrees, upright), or null. */
export function alongLine(line: Pt[], width: number, box: { x0: number; y0: number; x1: number; y1: number }): { x: number; y: number; angle: number } | null {
  const samples = densify(line), inside = (p: Pt) => p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
  let best: Sample[] | null = null, run: Sample[] = [];
  const close = () => { if (run.length > 1 && (!best || run[run.length - 1].s - run[0].s > best[best.length - 1].s - best[0].s)) best = run; run = []; };
  for (const p of samples) { if (inside(p)) run.push(p); else close(); }
  close();
  const chosen = best as Sample[] | null;
  if (!chosen) return null;
  const length = chosen[chosen.length - 1].s - chosen[0].s;
  if (length < width + 6) return null;
  const mid = chosen[0].s + length / 2, at = (s: number) => chosen.reduce((a, b) => Math.abs(b.s - s) < Math.abs(a.s - s) ? b : a);
  const a = at(mid - width / 2), b = at(mid + width / 2), centre = at(mid);
  const chord = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  // A bend within the name would make it look wrong: skip a street that curves too much under it.
  const spread = chosen.filter(p => p.s >= a.s && p.s <= b.s).reduce((m, p) => Math.max(m, Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / chord), 0);
  if (spread > 0.14 * width + 2) return null;
  let angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  if (angle > 90) angle -= 180; else if (angle < -90) angle += 180; // never upside down
  return { x: centre.x, y: centre.y, angle };
}

const bboxOf = (lines: Pt[][]) => {
  const all = lines.flat();
  return { x0: Math.min(...all.map(p => p.x)), y0: Math.min(...all.map(p => p.y)), x1: Math.max(...all.map(p => p.x)), y1: Math.max(...all.map(p => p.y)) };
};
const half = (p: Placed) => {
  const a = Math.abs(p.angle * Math.PI / 180), w = p.width * (a ? 0.9 : 1);
  return { w: (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * p.height) / 2, h: (Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * p.height) / 2 };
};
const overlap = (a: Placed, b: Placed, gap = 3) => { const ha = half(a), hb = half(b); return Math.abs(a.x - b.x) < ha.w + hb.w + gap && Math.abs(a.y - b.y) < ha.h + hb.h + gap; };

/**
 * Chooses which names to draw and where. `box` is the drawable area, `measure` gives a name's width in px. Main areas come first,
 * then water, parks and streets by importance; a name that would cover a name already placed is dropped, and the same name is not
 * repeated within `apart` px.
 */
export function placeLabels(candidates: Candidate[], box: { x0: number; y0: number; x1: number; y1: number }, measure: (text: string, style: LabelStyle) => number, apart = 320): Placed[] {
  // The same thing named in several tiles is one thing: join the pieces of a street, merge the pieces of a park.
  const merged = new Map<string, Candidate>();
  for (const c of candidates) {
    const key = `${c.style.kind}|${c.style.rank}|${c.text}`, seen = merged.get(key);
    if (seen) seen.lines.push(...c.lines); else merged.set(key, { ...c, lines: [...c.lines] });
  }
  const ordered = [...merged.values()].sort((a, b) => a.style.rank - b.style.rank || b.lines.length - a.lines.length);
  const placed: Placed[] = [];
  for (const c of ordered) {
    const text = c.style.upper ? c.text.toUpperCase() : c.text;
    const width = measure(text, c.style) + (c.style.dot ? 10 : 0), height = 16;
    const lines = c.style.kind === "street" || c.style.kind === "waterway" ? stitch(c.lines) : c.lines;
    const spots: { x: number; y: number; angle: number }[] = [];
    if (c.style.kind === "street" || c.style.kind === "waterway") {
      for (const line of lines.sort((a, b) => b.length - a.length)) { const spot = alongLine(line, width, box); if (spot) spots.push(spot); }
    } else if (c.style.kind === "park") {
      const b = bboxOf(c.lines), x = (b.x0 + b.x1) / 2, y = (b.y0 + b.y1) / 2;
      if (b.x1 - b.x0 >= width * 0.6) spots.push({ x, y, angle: 0 });
    } else {
      const points = c.lines.flat(), x = points.reduce((s, p) => s + p.x, 0) / points.length, y = points.reduce((s, p) => s + p.y, 0) / points.length;
      spots.push({ x, y, angle: 0 });
    }
    for (const spot of spots) {
      if (spot.x < box.x0 || spot.x > box.x1 || spot.y < box.y0 || spot.y > box.y1) continue;
      const label: Placed = { text, style: c.style, ...spot, width, height };
      if (placed.some(p => p.text === text && Math.hypot(p.x - spot.x, p.y - spot.y) < apart)) continue;
      if (placed.some(p => overlap(p, label))) continue;
      placed.push(label);
    }
  }
  return placed;
}
