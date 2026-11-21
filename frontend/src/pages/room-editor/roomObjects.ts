import type { Point } from "./geometry";
import { normaliseNorth } from "./northModel";
import { newRoomKey } from "./roomModel";
import { fitsInRoom } from "./validation";
import type { FixtureKind, Room, RoomFixture, RoomZone } from "./roomModel";
import type { ZoneKind } from "../../api/types";

export const FIXTURE_KINDS: readonly FixtureKind[] = ["bar", "kitchen", "wc", "column", "stairs", "plant", "stage", "fireplace", "tv", "host_stand", "awning"];
/** What the owner can add today. Older plans may still hold the other kinds, which keep drawing and editing. */
export const FIXTURE_PALETTE: readonly FixtureKind[] = ["bar", "wc", "stairs", "tv"];
export const FIXTURE_NAMES: Record<FixtureKind, string> = { bar: "Bar", kitchen: "Open kitchen", wc: "WC", column: "Column", stairs: "Stairs", plant: "Plant", stage: "Stage", fireplace: "Fireplace", tv: "TV", host_stand: "Host stand", awning: "Awning" };
/** The zones an owner can add today. Plans may still hold the other kinds, which keep drawing and editing. */
export const ZONE_PALETTE: readonly ZoneKind[] = ["quiet"];
export const ZONE_NAMES: Partial<Record<ZoneKind, string>> = { terrace: "Terrace", quiet: "Quiet zone" };
export const ZONE_KINDS: readonly ZoneKind[] = ["general", "window", "terrace", "bar", "quiet", "vip", "accessible"];

/** The size a new fixed element starts with, in cm. */
export function fixtureSize(kind: FixtureKind): { w: number; h: number } {
  const circle = kind === "plant" || kind === "column";
  return { w: circle ? 50 : kind === "awning" ? 300 : 150, h: circle ? 50 : kind === "awning" ? 200 : 80 };
}

/** The spot nearest to `want` (the top-left corner) where `fixture` lies inside the room, searched every 25 cm, or null. */
function nearestFit(room: Room, fixture: RoomFixture, want: Point): Point | null {
  const xs = room.outline.points.map(p => p.x), ys = room.outline.points.map(p => p.y);
  const spots: Point[] = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 25) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 25) spots.push({ x, y });
  spots.sort((a, b) => Math.hypot(a.x - want.x, a.y - want.y) - Math.hypot(b.x - want.x, b.y - want.y));
  return spots.find(spot => fitsInRoom(room, { ...fixture, x: spot.x, y: spot.y })) ?? null;
}

/** Adds a fixed element with its top-left corner at `at`. Dropped outside the room, it lands on the nearest spot inside. */
export function addFixture(room: Room, kind: FixtureKind, at: Point): Room {
  if (!FIXTURE_KINDS.includes(kind)) throw new Error("Choose a fixed element from the palette.");
  const { w, h } = fixtureSize(kind);
  const fixture: RoomFixture = { id: null, key: newRoomKey("f"), kind, shape: kind === "plant" || kind === "column" ? "circle" : "rect", x: at.x, y: at.y, w, h, rotation: 0, label: "" };
  checkFixture(fixture);
  if (!fitsInRoom(room, fixture)) {
    const spot = nearestFit(room, fixture, at);
    if (!spot) throw new Error("There is no room for this element.");
    fixture.x = spot.x; fixture.y = spot.y;
  }
  return { ...room, fixtures: [...room.fixtures, fixture] };
}

function checkFixture(f: RoomFixture): void {
  if (![f.x, f.y, f.w, f.h, f.rotation].every(Number.isFinite) || f.w <= 0 || f.h <= 0 || f.w > 10000 || f.h > 10000) throw new Error("Use finite positions and positive sizes up to 10000 cm.");
  if (f.label.length > 40) throw new Error("Use a label of up to 40 characters.");
  if (f.shape === "circle" && f.w !== f.h) throw new Error("A circle needs equal width and height.");
}

export function editFixture(room: Room, key: string, patch: Partial<RoomFixture>): Room {
  return { ...room, fixtures: room.fixtures.map(f => {
    if (f.key !== key) return f;
    const next = { ...f, ...patch, id: f.id, key: f.key };
    if (next.shape === "circle") { const diameter = patch.w ?? patch.h ?? f.w; next.w = diameter; next.h = diameter; }
    next.rotation = normaliseNorth(next.rotation);
    checkFixture(next);
    // Moving, resizing or turning may not take an element out of the room (one already outside, from an older plan, is left alone).
    const geometry = ["x", "y", "w", "h", "rotation", "shape"].some(k => k in patch);
    if (geometry && fitsInRoom(room, f) && !fitsInRoom(room, next)) throw new Error("Keep the element inside the room.");
    return next;
  }) };
}

/** The size a new zone starts with, in cm. */
export const ZONE_SIZE = { w: 200, h: 150 };

export function addZone(room: Room, kind: ZoneKind, at: Point): Room {
  if (!ZONE_KINDS.includes(kind)) throw new Error("Choose a zone type from the palette.");
  // "Terrace", then "Terrace 2"...; other kinds keep the old "Zone 1".
  const base = ZONE_NAMES[kind] ?? "Zone";
  let number = 1;
  const nameOf = (n: number) => base === "Zone" || n > 1 ? `${base} ${n}` : base;
  while (room.zones.some(z => z.name === nameOf(number))) number++;
  const zone: RoomZone = { id: null, key: newRoomKey("z"), name: nameOf(number), kind, x: at.x, y: at.y, ...ZONE_SIZE };
  const next = { ...room, zones: [...room.zones, zone] };
  return editZone(next, zone.key, {});
}

export function editZone(room: Room, key: string, patch: Partial<RoomZone>): Room {
  return { ...room, zones: room.zones.map(z => {
    if (z.key !== key) return z;
    const next = { ...z, ...patch, key: z.key, id: z.id };
    if (![next.x, next.y, next.w, next.h].every(Number.isFinite) || next.w <= 0 || next.h <= 0 || next.w > 10000 || next.h > 10000) throw new Error("Use finite positions and positive sizes up to 10000 cm.");
    if (!next.name.trim() || next.name.length > 80) throw new Error("Use a zone name of 1 to 80 characters.");
    return next;
  }) };
}

export function removeZone(room: Room, key: string): Room {
  return { ...room, zones: room.zones.filter(z => z.key !== key), tables: room.tables.map(t => t.zone_key === key ? { ...t, zone_key: null } : t) };
}
