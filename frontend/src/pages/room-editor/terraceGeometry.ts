import { outlineToPolygon, pointInPolygon, rectCorners, sideNormal } from "./geometry";
import type { Point } from "./geometry";
import type { Room, RoomZone } from "./roomModel";

/*
 * A terrace is a terrace zone (x, y, w, h) that lies against a wall. Zones are saved without a turn, so a terrace against a
 * sloping wall is turned to match the wall when it is drawn: the saved box is the unturned one, and the wall it lies against
 * (the one whose outside strip holds its middle) gives the angle. Nothing extra has to be stored.
 */

/** How deep a new terrace is, in cm: room for a table, its chairs and a way past. */
export const TERRACE_DEPTH = 250;
const REACH = 1500; // how far from a wall a terrace's middle may be and still belong to that wall

/** The middle of a wall and the way out of the room from it. */
export function outward(room: Room, side: number): { mid: Point; normal: Point } | null {
  const points = room.outline.points, n = points.length;
  if (n < 3 || side < 0 || side >= n) return null;
  const a = points[side], b = points[(side + 1) % n], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let normal = sideNormal(room.outline, side, 0.5);
  try { if (pointInPolygon({ x: mid.x + normal.x * 5, y: mid.y + normal.y * 5 }, outlineToPolygon(room.outline))) normal = { x: -normal.x, y: -normal.y }; } catch { /* keep it */ }
  return { mid, normal };
}

/** The strip outside a wall, from `from` to `to` cm away from it (along the wall's own direction, however it slopes). */
export function strip(room: Room, side: number, from: number, to: number): Point[] | null {
  const o = outward(room, side), points = room.outline.points;
  if (!o) return null;
  const a = points[side], b = points[(side + 1) % points.length], at = (p: Point, d: number): Point => ({ x: p.x + o.normal.x * d, y: p.y + o.normal.y * d });
  return [at(a, from), at(b, from), at(b, to), at(a, to)];
}

/** The terrace outside a wall, if there is one: a terrace zone whose middle lies just outside it. */
export function terraceOn(room: Room, side: number): RoomZone | null {
  const area = strip(room, side, 0, REACH);
  if (!area) return null;
  return room.zones.find(z => z.kind === "terrace" && pointInPolygon({ x: z.x + z.w / 2, y: z.y + z.h / 2 }, area)) ?? null;
}

/** The wall a terrace lies against, or null for a terrace that is not outside any wall (an old one, inside the room). */
export function terraceSide(room: Room, zone: RoomZone): number | null {
  for (let side = 0; side < room.outline.points.length; side++) if (terraceOn(room, side) === zone) return side;
  return null;
}

const half = (degrees: number) => { const d = ((degrees % 180) + 180) % 180; return d > 90 ? d - 180 : d; }; // into (-90, 90]

/** How far a terrace is turned (degrees): the slope of the wall it lies against, 0 for a wall across or up and down the plan. */
export function terraceRotation(room: Room, zone: RoomZone): number {
  const side = zone.kind === "terrace" ? terraceSide(room, zone) : null, o = side === null ? null : outward(room, side);
  if (side === null || !o) return 0;
  const a = room.outline.points[side], b = room.outline.points[(side + 1) % room.outline.points.length];
  const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const turn = Math.abs(o.normal.y) > 0.5 ? half(angle) : half(angle - 90); // the box's width runs along the wall, or its height does
  return Math.abs(turn) < 1e-6 ? 0 : Math.round(turn * 100) / 100;
}

/** The four corners of a terrace as drawn, turned to its wall. */
export function terraceCorners(room: Room, zone: RoomZone): Point[] {
  return rectCorners({ x: zone.x, y: zone.y, w: zone.w, h: zone.h, rotation: terraceRotation(room, zone) });
}

/** Whether a point lies on the terrace. */
export function onTerrace(room: Room, zone: RoomZone, point: Point): boolean {
  return pointInPolygon(point, terraceCorners(room, zone));
}
