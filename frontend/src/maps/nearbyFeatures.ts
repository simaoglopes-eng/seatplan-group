import { TILE_URL } from "./tileSource";
import { readMapLayers, traceGeometry } from "./vectorTile";

/** What the map shows near a place that an owner may want on a plan: the sea, a river or a park. */
export type NearKind = "sea" | "river" | "park";
export interface NearFeature { kind: NearKind; metres: number; bearing: number | null }
export interface Pt { x: number; y: number }
/** Shapes in metres from the place: x towards the east, y towards the south. */
export interface Shape { kind: NearKind; polygon: boolean; rings: Pt[][] }

const ZOOM = 14;
export const SEARCH_METRES = 600;
const LAYERS = new Set(["water", "waterway", "park"]);

export function tileAt(lat: number, lng: number, zoom = ZOOM): { x: number; y: number; fx: number; fy: number } {
  const n = 2 ** zoom, x = (lng + 180) / 360 * n, rad = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n;
  return { x: Math.floor(x), y: Math.floor(y), fx: x - Math.floor(x), fy: y - Math.floor(y) };
}
export const tileMetres = (lat: number, zoom = ZOOM): number => 40075016.686 * Math.cos(lat * Math.PI / 180) / 2 ** zoom;

function classify(layer: string, category: string | undefined): NearKind | null {
  if (layer === "water") return category === "ocean" ? "sea" : category === "river" ? "river" : null;
  if (layer === "waterway") return category === "river" ? "river" : null;
  return layer === "park" ? "park" : null;
}

/** The water and parks of one tile, placed by where the tile's top-left corner lies from the place, in metres. */
export function readShapes(bytes: Uint8Array, origin: Pt, metresPerTile: number): Shape[] {
  const shapes: Shape[] = [];
  for (const [name, layer] of readMapLayers(bytes, LAYERS)) {
    const scale = metresPerTile / layer.extent;
    for (const feature of layer.features) {
      const kind = classify(name, feature.category);
      if (!kind) continue;
      const rings: Pt[][] = [];
      let ring: Pt[] = [];
      const at = (x: number, y: number): Pt => ({ x: origin.x + x * scale, y: origin.y + y * scale });
      traceGeometry({
        moveTo: (x, y) => { if (ring.length) rings.push(ring); ring = [at(x, y)]; },
        lineTo: (x, y) => { ring.push(at(x, y)); },
        closePath: () => { if (ring.length) { ring.push({ ...ring[0] }); rings.push(ring); ring = []; } },
      }, feature.geometry, 1);
      if (ring.length) rings.push(ring);
      shapes.push({ kind, polygon: feature.kind === 3, rings });
    }
  }
  return shapes;
}

function closest(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}
function inside(rings: Pt[][]): boolean {
  let odd = false;
  for (const ring of rings) for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i], b = ring[i + 1];
    if ((a.y > 0) !== (b.y > 0) && 0 < a.x + (0 - a.y) / (b.y - a.y) * (b.x - a.x)) odd = !odd;
  }
  return odd;
}
/** Degrees clockwise from north of a point that is x metres east and y metres south of the place. */
export const bearingOf = (p: Pt): number => ((Math.atan2(p.x, -p.y) * 180 / Math.PI) + 360) % 360;

/** The nearest sea, river and park within reach of the place (0, 0), nearest first, with the way to each. */
export function nearestOfEach(shapes: Shape[], max = SEARCH_METRES): NearFeature[] {
  const best = new Map<NearKind, { metres: number; at: Pt | null }>();
  const origin = { x: 0, y: 0 };
  for (const shape of shapes) {
    let metres = Infinity, at: Pt | null = null;
    if (shape.polygon && inside(shape.rings)) metres = 0;
    else for (const ring of shape.rings) for (let i = 0; i + 1 < ring.length; i++) {
      const point = closest(origin, ring[i], ring[i + 1]), d = Math.hypot(point.x, point.y);
      if (d < metres) { metres = d; at = point; }
    }
    const known = best.get(shape.kind);
    if (metres <= max && (!known || metres < known.metres)) best.set(shape.kind, { metres, at });
  }
  return [...best].map(([kind, b]) => ({ kind, metres: Math.round(b.metres), bearing: b.at ? Math.round(bearingOf(b.at)) : null })).sort((a, b) => a.metres - b.metres);
}

/** What the map shows within walking distance of a place, from the same tiles the discovery map draws. */
export async function findNearby(lat: number, lng: number, signal?: AbortSignal): Promise<NearFeature[]> {
  const here = tileAt(lat, lng), size = tileMetres(lat);
  const wanted: [number, number][] = [];
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
    const near = (d: number, f: number) => d === 0 || (d < 0 ? f * size : (1 - f) * size) <= SEARCH_METRES;
    if (near(dx, here.fx) && near(dy, here.fy)) wanted.push([dx, dy]);
  }
  const shapes = (await Promise.all(wanted.map(async ([dx, dy]) => {
    try {
      const response = await fetch(`${TILE_URL}/${ZOOM}/${here.x + dx}/${here.y + dy}.pbf`, { signal, credentials: "omit" });
      if (!response.ok) throw new Error(`Map tile returned ${response.status}`);
      return readShapes(new Uint8Array(await response.arrayBuffer()), { x: (dx - here.fx) * size, y: (dy - here.fy) * size }, size);
    } catch (error) {
      if (dx === 0 && dy === 0) throw error; // without the tile the place is on, there is nothing to say
      return [];
    }
  }))).flat();
  return nearestOfEach(shapes);
}
