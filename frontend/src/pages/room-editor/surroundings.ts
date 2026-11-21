import { bearing } from "./geometry";
import type { Point } from "./geometry";
import { onTerrace, outward, strip, TERRACE_DEPTH, terraceOn } from "./terraceGeometry";
import type { Room, RoomZone } from "./roomModel";
import { addZone, editZone, removeZone } from "./roomObjects";
export { TERRACE_DEPTH, terraceOn } from "./terraceGeometry";
import { addOpening, updateOpening } from "./wallModel";

/*
 * What is outside a wall. It is kept as the view of a window on that wall (a view tag and a few words), which the diner's
 * plan already reads: the sea and a river are drawn as water along that edge, a park as green.
 */
export type SurroundingKind = "sea" | "river" | "park" | "street" | "city" | "hills";
export interface Surrounding { kind: SurroundingKind; label: string; tag: string; text: string; group: "water" | "green" | "other" }
export const SURROUNDINGS: readonly Surrounding[] = [
  { kind: "sea", label: "Sea", tag: "sea", text: "The sea", group: "water" },
  { kind: "river", label: "River", tag: "river", text: "The river", group: "water" },
  { kind: "park", label: "Park", tag: "garden", text: "A park", group: "green" },
  { kind: "street", label: "Street", tag: "street", text: "The street", group: "other" },
  { kind: "city", label: "City", tag: "city", text: "The city", group: "other" },
  { kind: "hills", label: "Hills", tag: "hills", text: "The hills", group: "other" },
];
const BY_TAG = new Map(SURROUNDINGS.map(s => [s.tag, s]));

/** What is outside this wall, if the owner said so. */
export function surroundingOf(room: Room, side: number): Surrounding | null {
  for (const opening of room.openings) {
    if (opening.side !== side || opening.kind !== "window") continue;
    const found = opening.view_tags.map(tag => BY_TAG.get(tag)).find(Boolean);
    if (found) return found;
  }
  return null;
}

/** Says what is outside a wall (or, with null, that nothing is). Adds a window to carry it when the wall has none. */
export function setSurrounding(room: Room, side: number, kind: SurroundingKind | null): Room {
  const windows = room.openings.filter(o => o.side === side && o.kind === "window");
  if (kind === null) {
    return { ...room, openings: room.openings.map(o => o.side === side && o.kind === "window" && o.view_tags.some(t => BY_TAG.has(t))
      ? { ...o, view_tags: o.view_tags.filter(t => !BY_TAG.has(t)), view_text: "" } : o) };
  }
  const wanted = SURROUNDINGS.find(s => s.kind === kind);
  if (!wanted) throw new Error("Choose what is outside the wall.");
  let next = room, target = windows.find(o => o.view_tags.some(t => BY_TAG.has(t))) ?? windows[0];
  if (!target) {
    try { next = addOpening(room, side, "window"); }
    catch { throw new Error("There is no room on this wall to say what is outside. Make space or choose another wall."); }
    target = next.openings.at(-1)!;
  }
  return updateOpening(next, target.key, { view_tags: [wanted.tag, ...target.view_tags.filter(t => !BY_TAG.has(t))].slice(0, 3), view_text: wanted.text });
}

const WORDS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
/** "south-east" for 135 degrees. */
export const directionWord = (degrees: number): string => WORDS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];

/** The way a wall faces, in degrees clockwise from north (the top of the plan). */
export function wallBearing(room: Room, side: number): number | null {
  const o = outward(room, side);
  return o ? bearing(o.normal.x, o.normal.y, room.north_deg ?? 0) : null;
}

/** The wall that faces nearest to this bearing, with how far off it is. */
export function wallFacing(room: Room, degrees: number): { side: number; off: number } | null {
  let best: { side: number; off: number } | null = null;
  room.outline.points.forEach((_, side) => {
    const facing = wallBearing(room, side);
    if (facing === null) return;
    const off = Math.abs(((facing - degrees + 540) % 360) - 180);
    if (!best || off < best.off) best = { side, off };
  });
  return best;
}

/** Puts a terrace outside a wall (a terrace zone, so diners can look for one), or takes it away. */
export function setTerrace(room: Room, side: number, on: boolean): Room {
  const existing = terraceOn(room, side);
  if (!on) return existing ? removeZone(room, existing.key) : room;
  if (existing) return room;
  const quad = strip(room, side, 0, TERRACE_DEPTH), o = outward(room, side);
  if (!quad || !o) throw new Error("Choose a wall first.");
  const a = room.outline.points[side], b = room.outline.points[(side + 1) % room.outline.points.length], along = Math.hypot(b.x - a.x, b.y - a.y);
  const horizontal = Math.abs(o.normal.y) > 0.5, w = Math.max(100, Math.round(horizontal ? along : TERRACE_DEPTH)), h = Math.max(100, Math.round(horizontal ? TERRACE_DEPTH : along));
  const centre = { x: o.mid.x + o.normal.x * TERRACE_DEPTH / 2, y: o.mid.y + o.normal.y * TERRACE_DEPTH / 2 }; // against the wall, however it slopes
  const added = addZone(room, "terrace", { x: Math.round(centre.x - w / 2), y: Math.round(centre.y - h / 2) });
  return editZone(added, added.zones.at(-1)!.key, { w, h });
}

/** A table standing on a terrace belongs to it; one that leaves it does not. Returns the same room when nothing changes. */
export function assignTerraceTables(room: Room): Room {
  const terraces = room.zones.filter(z => z.kind === "terrace");
  if (!terraces.length && !room.tables.some(t => t.zone_key)) return room;
  let changed = false;
  const tables = room.tables.map(t => {
    const centre = { x: t.x + t.w / 2, y: t.y + t.h / 2 }, here = terraces.find(z => onTerrace(room, z, centre));
    const current = room.zones.find(z => z.key === t.zone_key);
    let zone_key = t.zone_key;
    if (here) { if (!current || current.kind === "terrace") zone_key = here.key; }
    else if (current?.kind === "terrace") zone_key = null;
    if (zone_key === t.zone_key) return t;
    changed = true; return { ...t, zone_key };
  });
  return changed ? { ...room, tables } : room;
}

export interface Band { side: number; surrounding: Surrounding; quad: Point[]; label: Point }
/** The strips drawn outside the walls that have something outside them (beyond the terrace, when there is one). */
export function surroundingBands(room: Room, depth = 140): Band[] {
  const bands: Band[] = [];
  room.outline.points.forEach((_, side) => {
    const surrounding = surroundingOf(room, side), inset = terraceDepth(room, side), quad = strip(room, side, inset, inset + depth), o = outward(room, side);
    if (!surrounding || !quad || !o) return;
    bands.push({ side, surrounding, quad, label: { x: o.mid.x + o.normal.x * (inset + depth / 2), y: o.mid.y + o.normal.y * (inset + depth / 2) } });
  });
  return bands;
}

/** A terrace's length along its wall and how far it reaches out from it, in cm. */
export function terraceSize(room: Room, side: number, zone: RoomZone): { along: number; depth: number } {
  const o = outward(room, side);
  return o && Math.abs(o.normal.y) > 0.5 ? { along: zone.w, depth: zone.h } : { along: zone.h, depth: zone.w };
}

/** How far a wall's terrace reaches out from it, in cm (0 when there is none). */
function terraceDepth(room: Room, side: number): number {
  const zone = terraceOn(room, side);
  return zone ? terraceSize(room, side, zone).depth : 0;
}

/** Sets a terrace's length along its wall (kept centred) or its depth (the side against the wall stays put). */
export function setTerraceSize(room: Room, side: number, patch: { along?: number; depth?: number }): Room {
  const zone = terraceOn(room, side), o = outward(room, side);
  if (!zone || !o) throw new Error("There is no terrace on this wall.");
  const horizontal = Math.abs(o.normal.y) > 0.5, now = terraceSize(room, side, zone), along = patch.along ?? now.along, depth = patch.depth ?? now.depth;
  if (!(along >= 50) || !(depth >= 50)) throw new Error("A terrace is at least 50 cm each way.");
  const grow = (depth - now.depth) / 2, centre = { x: zone.x + zone.w / 2 + o.normal.x * grow, y: zone.y + zone.h / 2 + o.normal.y * grow };
  const w = Math.round(horizontal ? along : depth), h = Math.round(horizontal ? depth : along);
  return editZone(room, zone.key, { w, h, x: Math.round(centre.x - w / 2), y: Math.round(centre.y - h / 2) });
}
