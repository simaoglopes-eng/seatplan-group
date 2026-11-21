import { GridLayer, type Coords, type DoneCallback } from "leaflet";
import { sourceTile, strokeGrowth, TILE_URL } from "./tileSource";
import { readMapLayers, traceGeometry } from "./vectorTile";
import type { MapFeature, MapLayer } from "./vectorTile";

/** The finest zoom the tile server stores. Closer than this the same tile is redrawn larger, so the map stays sharp. */
const NATIVE_ZOOM = 14;
const LAND = "#dfedf2";
const WATER = "#b8eaf4";
const PARK = "#c5ece1";
const BUILDING = "#edf6f8";
const STREET = "#fbfeff";

const visibleLayers = new Set(["landuse", "landcover", "park", "water", "waterway", "building", "transportation"]);
const greenAreas = new Set(["grass", "wood", "forest", "park", "garden", "recreation_ground", "cemetery", "golf_course", "pitch"]);
const urbanAreas = new Set(["residential", "commercial", "industrial", "retail"]);
const roadWidths: Readonly<Record<string, number>> = {
  motorway: 5.4, trunk: 4.5, primary: 3.5, secondary: 2.6, tertiary: 1.9,
  minor: 1.15, service: 0.8, path: 0.55,
};

// A stored tile is decoded once. Each shape keeps its outline (a Path2D, in tile pixels) and its bounding box, so drawing a tile again
// (panning back, or the many tiles cut from one parent when zoomed in) skips the decoding and every shape that is not on screen.
interface Shape { path: Path2D | null; box: [number, number, number, number] }
const shapes = new WeakMap<MapFeature, Shape>();
const prepared = new Map<string, Map<string, MapLayer>>();
const PREPARED_LIMIT = 40;

function preparedLayers(key: string, bytes: Uint8Array): Map<string, MapLayer> {
  const known = prepared.get(key);
  if (known) { prepared.delete(key); prepared.set(key, known); return known; }
  const layers = readMapLayers(bytes, visibleLayers);
  prepared.set(key, layers);
  if (prepared.size > PREPARED_LIMIT) prepared.delete(prepared.keys().next().value as string);
  return layers;
}

function shapeOf(feature: MapFeature, k: number): Shape {
  const known = shapes.get(feature);
  if (known) return known;
  const path = typeof Path2D === "function" ? new Path2D() : null;
  const box: Shape["box"] = [Infinity, Infinity, -Infinity, -Infinity];
  const note = (x: number, y: number) => { if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y; if (x > box[2]) box[2] = x; if (y > box[3]) box[3] = y; };
  traceGeometry({
    moveTo: (x, y) => { note(x, y); path?.moveTo(x, y); },
    lineTo: (x, y) => { note(x, y); path?.lineTo(x, y); },
    closePath: () => path?.closePath(),
  }, feature.geometry, k);
  const shape = { path, box };
  shapes.set(feature, shape);
  return shape;
}

/** `view` is the part of the stored tile this canvas shows, in tile pixels. */
function drawMapTile(ctx: CanvasRenderingContext2D, layers: Map<string, MapLayer>, size: number, zoom: number, scale: number, view: [number, number, number, number]) {
  // The context is already scaled by `scale`, so line widths are divided by it to keep their size on screen.
  const grow = strokeGrowth(zoom, NATIVE_ZOOM) / scale;
  const margin = 8 / scale + 4; // a wide road just outside the view still reaches into it
  ctx.fillStyle = LAND;
  ctx.fillRect(view[0] - margin, view[1] - margin, view[2] - view[0] + margin * 2, view[3] - view[1] + margin * 2);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const draw = (name: string, kind: number, paint: (category: string) => boolean) => {
    const layer = layers.get(name);
    if (!layer) return;
    const k = size / layer.extent;
    for (const feature of layer.features) {
      if (feature.kind !== kind || !paint(feature.category ?? "")) continue;
      const { path, box } = shapeOf(feature, k);
      if (box[2] < view[0] - margin || box[0] > view[2] + margin || box[3] < view[1] - margin || box[1] > view[3] + margin) continue; // off screen
      if (path) { if (kind === 3) ctx.fill(path, "evenodd"); else ctx.stroke(path); continue; }
      ctx.beginPath();
      traceGeometry(ctx, feature.geometry, k);
      if (kind === 3) ctx.fill("evenodd");
      else ctx.stroke();
    }
  };
  const fill = (color: string) => { ctx.fillStyle = color; return true; };

  draw("landuse", 3, category => {
    if (greenAreas.has(category)) return fill(PARK);
    return urbanAreas.has(category) && fill("#d8e9ef");
  });
  draw("landcover", 3, category => greenAreas.has(category) && fill(PARK));
  draw("park", 3, () => fill(PARK));
  ctx.strokeStyle = WATER;
  ctx.lineWidth = (zoom >= 13 ? 1.5 : 0.8) * grow;
  draw("waterway", 2, () => true);
  draw("water", 3, () => fill(WATER));
  if (zoom >= 13) draw("building", 3, () => fill(BUILDING));

  ctx.strokeStyle = STREET;
  const detail = zoom < 11 ? 0.55 : zoom < 13 ? 0.78 : 1;
  draw("transportation", 2, category => {
    const width = Object.hasOwn(roadWidths, category) ? roadWidths[category] : 0;
    if (width === 0 || (category === "path" && zoom < 14)) return false;
    ctx.lineWidth = width * detail * grow;
    return true;
  });
}

// Zoomed in, many tiles are cut from the same stored tile: download it once and share it.
const shared = new Map<string, Promise<Uint8Array>>();
const SHARED_LIMIT = 48;

function loadTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<Uint8Array> {
  const get = () => fetch(`${TILE_URL}/${z}/${x}/${y}.pbf`, { signal, credentials: "omit" }).then(async response => {
    if (!response.ok) throw new Error(`Map tile returned ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  });
  if (signal) return get();
  const key = `${z}/${x}/${y}`;
  const cached = shared.get(key);
  if (cached) return cached;
  const pending = get().catch((error: unknown) => { shared.delete(key); throw error; });
  shared.set(key, pending);
  if (shared.size > SHARED_LIMIT) shared.delete(shared.keys().next().value as string);
  return pending;
}

export class DiscoveryBasemap extends GridLayer {
  private readonly requests = new WeakMap<HTMLElement, AbortController>();

  constructor() {
    super({ maxZoom: 19, updateWhenZooming: false, keepBuffer: 3 }); // no tiles for the zoom steps in between, and more kept around the view
    this.on("tileunload", ({ tile }) => this.requests.get(tile)?.abort());
  }

  override createTile({ x, y, z }: Coords, done: DoneCallback): HTMLElement {
    const tile = document.createElement("canvas");
    const size = this.getTileSize().x;
    const density = Math.min(window.devicePixelRatio || 1, 2);
    tile.width = tile.height = size * density;
    tile.setAttribute("aria-hidden", "true");
    const request = new AbortController();
    this.requests.set(tile, request);
    const source = sourceTile({ x, y, z }, NATIVE_ZOOM);

    void loadTile(source.z, source.x, source.y, source.scale === 1 ? request.signal : undefined).then(bytes => {
      if (request.signal.aborted) return;
      const context = tile.getContext("2d");
      if (!context) throw new Error("Map canvas unavailable");
      // Draw the parent tile enlarged and slid so that this tile's part fills the canvas.
      context.scale(density * source.scale, density * source.scale);
      context.translate(-(source.offsetX * size) / source.scale, -(source.offsetY * size) / source.scale);
      const layers = preparedLayers(`${source.z}/${source.x}/${source.y}`, bytes);
      const part = size / source.scale; // the width of the part of the stored tile this canvas shows
      drawMapTile(context, layers, size, z, source.scale, [source.offsetX * part, source.offsetY * part, (source.offsetX + 1) * part, (source.offsetY + 1) * part]);
      done(undefined, tile);
    }).catch((error: unknown) => {
      if (!request.signal.aborted) done(error instanceof Error ? error : new Error("Map tile failed"), tile);
    });
    return tile;
  }
}
