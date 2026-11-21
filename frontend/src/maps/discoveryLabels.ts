import { DomUtil, Layer, type Map as LeafletMap } from "leaflet";
import { TILE_URL } from "./tileSource";
import { readMapLayers } from "./vectorTile";
import type { MapLayer } from "./vectorTile";
import { LABEL_LAYERS, placeLabels, tileCandidates } from "./mapLabels";
import type { Candidate } from "./mapLabels";

/** The finest zoom the tile server stores; closer than this the names are laid out from the same tile at a larger size. */
const NATIVE_ZOOM = 14;
const PADDING = 0.25; // the label canvas reaches this far past each side of the view, so names do not pop in while panning
const MAX_TILES = 30;
const CACHE_LIMIT = 96;
const tiles = new Map<string, Promise<Map<string, MapLayer>>>();

function labelTile(z: number, x: number, y: number): Promise<Map<string, MapLayer>> {
  const key = `${z}/${x}/${y}`, cached = tiles.get(key);
  if (cached) return cached;
  const pending = fetch(`${TILE_URL}/${key}.pbf`, { credentials: "omit" }).then(async response => {
    if (!response.ok) throw new Error(`Map tile returned ${response.status}`);
    return readMapLayers(new Uint8Array(await response.arrayBuffer()), LABEL_LAYERS);
  });
  pending.catch(() => tiles.delete(key));
  tiles.set(key, pending);
  if (tiles.size > CACHE_LIMIT) tiles.delete(tiles.keys().next().value as string);
  return pending;
}

const named = new Map<string, Candidate[]>();
/** The names of one stored tile at one zoom, worked out once: panning back and forth costs nothing. */
function candidatesOf(z: number, x: number, y: number, zoom: number, layers: Map<string, MapLayer>): Candidate[] {
  const key = `${z}/${x}/${y}@${zoom}`, cached = named.get(key);
  if (cached) return cached;
  const found = tileCandidates(layers, { x, y, z }, zoom);
  named.set(key, found);
  if (named.size > CACHE_LIMIT * 2) named.delete(named.keys().next().value as string);
  return found;
}

/**
 * The names of main areas, rivers, parks and streets, drawn on one canvas over the basemap. The basemap itself draws no text:
 * these come from the same OpenFreeMap tiles (OpenMapTiles and OpenStreetMap, credited in the page footer).
 */
export class DiscoveryLabels extends Layer {
  private canvas: HTMLCanvasElement | null = null;
  private run = 0;
  private readonly redraw = () => { void this.draw(); };

  override onAdd(map: LeafletMap): this {
    const canvas = DomUtil.create("canvas", "leaflet-zoom-hide discovery-labels") as HTMLCanvasElement;
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.pointerEvents = "none";
    map.getPane("overlayPane")?.appendChild(canvas);
    this.canvas = canvas;
    map.on("moveend resize", this.redraw);
    this.redraw();
    return this;
  }

  override onRemove(map: LeafletMap): this {
    this.run++;
    map.off("moveend resize", this.redraw);
    this.canvas?.remove();
    this.canvas = null;
    return this;
  }

  private async draw(): Promise<void> {
    const map = this._map as LeafletMap | undefined, canvas = this.canvas;
    if (!map || !canvas) return;
    // The map can be at a part-way zoom; names are chosen for the nearest whole zoom and placed at the real scale.
    const run = ++this.run, exact = map.getZoom(), zoom = Math.round(exact), scale = 2 ** (exact - zoom), size = map.getSize();
    const min = map.containerPointToLayerPoint(size.multiplyBy(-PADDING)).round();
    const width = Math.round(size.x * (1 + PADDING * 2)), height = Math.round(size.y * (1 + PADDING * 2));
    const origin = map.getPixelOrigin(), left = min.x + origin.x, top = min.y + origin.y; // the canvas's corner in world pixels
    // Which stored tiles cover it (in the pixels of the whole zoom).
    const sz = Math.min(zoom, NATIVE_ZOOM), span = 256 * 2 ** (zoom - sz), last = 2 ** sz - 1;
    const x0 = Math.max(0, Math.floor(left / scale / span)), x1 = Math.min(last, Math.floor((left + width) / scale / span));
    const y0 = Math.max(0, Math.floor(top / scale / span)), y1 = Math.min(last, Math.floor((top + height) / scale / span));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return;
    const wanted: { x: number; y: number }[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) wanted.push({ x, y });
    const loaded = await Promise.all(wanted.map(async ({ x, y }) => {
      try { return candidatesOf(sz, x, y, zoom, await labelTile(sz, x, y)); }
      catch { return [] as Candidate[]; } // a missing tile only means fewer names: the basemap says when tiles fail
    }));
    if (run !== this.run || this._map !== map) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const density = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * density; canvas.height = height * density;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    DomUtil.setPosition(canvas, min);
    context.setTransform(density, 0, 0, density, 0, 0);
    // To canvas pixels.
    const here: Candidate[] = loaded.flat().map(c => ({ ...c, lines: c.lines.map(line => line.map(p => ({ x: p.x * scale - left, y: p.y * scale - top }))) }));
    const spaced = "letterSpacing" in context; // letter-spacing on the canvas, where the browser has it
    const setSpacing = (px: number) => { if (spaced) (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`; };
    const measure = (text: string, style: { font: string; spacing?: number }) => { context.font = style.font; setSpacing(style.spacing ?? 0); return context.measureText(text).width; };
    const placed = placeLabels(here, { x0: 6, y0: 6, x1: width - 6, y1: height - 6 }, measure);
    context.textBaseline = "middle"; context.lineJoin = "round"; context.lineCap = "round";
    for (const label of placed) {
      const { style } = label, shift = style.dot ? 5 : 0; // room for the dot before the name
      context.save();
      context.translate(label.x, label.y);
      context.rotate(label.angle * Math.PI / 180);
      context.font = style.font;
      setSpacing(style.spacing ?? 0);
      context.textAlign = "center";
      context.lineWidth = style.haloWidth; context.strokeStyle = style.halo;
      context.strokeText(label.text, shift, 0);
      context.fillStyle = style.color;
      context.fillText(label.text, shift, 0);
      if (style.dot) {
        const dotX = shift - (label.width - 10) / 2 - 7;
        context.beginPath(); context.arc(dotX, 0, 2.6, 0, Math.PI * 2);
        context.lineWidth = 2; context.stroke(); context.fill();
      }
      context.restore();
    }
  }
}
