import { expect, it } from "vitest";
import { bearingOf, nearestOfEach, tileAt, tileMetres } from "./nearbyFeatures";
import type { Shape } from "./nearbyFeatures";

const box = (x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
const area = (kind: Shape["kind"], x0: number, y0: number, x1: number, y1: number): Shape => ({ kind, polygon: true, rings: [box(x0, y0, x1, y1)] });

it("says which way and how far the nearest water and park lie", () => {
  const found = nearestOfEach([
    area("sea", -500, 120, 500, 900), // water 120 m to the south
    area("park", 200, -60, 400, 60), // a park 200 m to the east
  ]);
  expect(found).toEqual([{ kind: "sea", metres: 120, bearing: 180 }, { kind: "park", metres: 200, bearing: 90 }]);
});

it("takes the nearest of several, ignores what is out of reach, and has no direction when the place is inside", () => {
  const found = nearestOfEach([
    area("river", 300, -10, 350, 10), area("river", -150, -10, -100, 10), // two rivers: 100 m west is nearer
    area("sea", 0, 800, 100, 900), // too far
    area("park", -50, -50, 50, 50), // standing in a park
  ]);
  expect(found.find(f => f.kind === "river")).toEqual({ kind: "river", metres: 100, bearing: 270 });
  expect(found.find(f => f.kind === "sea")).toBeUndefined();
  expect(found.find(f => f.kind === "park")).toEqual({ kind: "park", metres: 0, bearing: null });
});

it("follows a river drawn as a line", () => {
  const river: Shape = { kind: "river", polygon: false, rings: [[{ x: -300, y: -80 }, { x: 300, y: -80 }]] };
  expect(nearestOfEach([river])).toEqual([{ kind: "river", metres: 80, bearing: 0 }]);
});

it("turns a point into a compass bearing from north, clockwise", () => {
  expect(bearingOf({ x: 0, y: -10 })).toBe(0);
  expect(bearingOf({ x: 10, y: 0 })).toBe(90);
  expect(bearingOf({ x: 0, y: 10 })).toBe(180);
  expect(bearingOf({ x: -10, y: 0 })).toBe(270);
});

it("finds the map tile a place is on and how big it is", () => {
  const lisbon = tileAt(38.7223, -9.1393, 14);
  expect(lisbon.x).toBe(7776); expect(lisbon.y).toBe(6277); // worked out separately from the usual web-map formula
  expect(lisbon.fx).toBeGreaterThanOrEqual(0); expect(lisbon.fx).toBeLessThan(1);
  expect(tileMetres(38.7223)).toBeGreaterThan(1800); expect(tileMetres(38.7223)).toBeLessThan(2000);
});
