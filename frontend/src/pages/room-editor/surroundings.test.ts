import { expect, it } from "vitest";
import { createRoom } from "./roomModel";
import { terraceCorners, terraceRotation } from "./terraceGeometry";
import { assignTerraceTables, directionWord, setSurrounding, setTerrace, setTerraceSize, terraceOn, terraceSize, TERRACE_DEPTH, surroundingBands, surroundingOf, wallBearing, wallFacing } from "./surroundings";
import { addOpening } from "./wallModel";
import { addTable } from "./tableModel";
import { validateRooms } from "./validation";

const room = () => createRoom("Room 1", 1000, 700); // walls: 0 top, 1 right, 2 bottom, 3 left

it("says what is outside a wall, adding a window to carry it", () => {
  const next = setSurrounding(room(), 2, "sea");
  expect(surroundingOf(next, 2)?.kind).toBe("sea");
  expect(surroundingOf(next, 0)).toBeNull();
  expect(next.openings).toHaveLength(1);
  expect(next.openings[0]).toMatchObject({ kind: "window", side: 2, view_tags: ["sea"], view_text: "The sea" });
});

it("changes and clears it, reusing the window, and keeps the owner's own words on other views", () => {
  let r = setSurrounding(room(), 1, "river");
  r = setSurrounding(r, 1, "park");
  expect(r.openings).toHaveLength(1);
  expect(surroundingOf(r, 1)?.kind).toBe("park");
  expect(r.openings[0].view_tags).toEqual(["garden"]);
  r = setSurrounding(r, 1, null);
  expect(surroundingOf(r, 1)).toBeNull();
  expect(r.openings).toHaveLength(1); // the window stays; only what it looks onto is cleared
  expect(r.openings[0]).toMatchObject({ view_tags: [], view_text: "" });
});

it("uses a window that is already on the wall", () => {
  const withWindow = addOpening(room(), 0, "window");
  const next = setSurrounding(withWindow, 0, "city");
  expect(next.openings).toHaveLength(1);
  expect(surroundingOf(next, 0)?.kind).toBe("city");
});

it("says so when the wall has no space for a window", () => {
  const door = addOpening(room(), 0, "door");
  const full = { ...door, openings: [{ ...door.openings[0], offset: 0, width: 1000 }] };
  expect(() => setSurrounding(full, 0, "sea")).toThrow("no room on this wall");
});

it("knows which way each wall faces and which wall faces a direction", () => {
  const r = room();
  expect([0, 1, 2, 3].map(s => wallBearing(r, s))).toEqual([0, 90, 180, 270]);
  expect(wallFacing(r, 170)).toEqual({ side: 2, off: 10 });
  expect(wallFacing(r, 350)?.side).toBe(0);
  expect(directionWord(135)).toBe("south-east");
});

it("draws a strip outside only the walls that have something outside them", () => {
  const r = setSurrounding(setSurrounding(room(), 2, "sea"), 1, "park");
  const bands = surroundingBands(r);
  expect(bands.map(b => [b.side, b.surrounding.kind])).toEqual([[1, "park"], [2, "sea"]]);
  const sea = bands.find(b => b.side === 2)!;
  expect(Math.max(...sea.quad.map(p => p.y))).toBeGreaterThan(700); // below the bottom wall, outside the room
  expect(sea.label.y).toBeGreaterThan(700);
});

it("puts a terrace outside a wall as a terrace zone, and takes it away again", () => {
  const next = setTerrace(room(), 2, true); // the bottom wall, y = 700
  expect(next.zones).toHaveLength(1);
  expect(next.zones[0]).toMatchObject({ kind: "terrace", name: "Terrace", x: 0, y: 700, w: 1000, h: TERRACE_DEPTH });
  expect(terraceOn(next, 2)).not.toBeNull();
  expect(terraceOn(next, 0)).toBeNull();
  expect(setTerrace(next, 2, true)).toBe(next);
  expect(setTerrace(next, 2, false).zones).toHaveLength(0);
});

it("lets tables stand on the terrace, and puts them in its zone", () => {
  let r = setTerrace(room(), 2, true);
  r = addTable(r, "round", { x: 200, y: 750 });
  expect(validateRooms([r]).some(p => p.code === "table_outside")).toBe(false);
  r = assignTerraceTables(r);
  expect(r.tables[0].zone_key).toBe(r.zones[0].key);
  expect(assignTerraceTables(r)).toBe(r);
  const away = assignTerraceTables({ ...r, tables: [{ ...r.tables[0], y: 200 }] });
  expect(away.tables[0].zone_key).toBeNull();
  const nowhere = addTable(room(), "round", { x: 200, y: 750 });
  expect(validateRooms([nowhere]).some(p => p.code === "table_outside")).toBe(true);
});

it("draws the view beyond the terrace", () => {
  const r = setSurrounding(setTerrace(room(), 2, true), 2, "sea");
  const band = surroundingBands(r).find(b => b.side === 2)!;
  expect(Math.min(...band.quad.map(p => p.y))).toBe(700 + TERRACE_DEPTH);
});

it("sizes a terrace by its length along the wall and its depth, keeping the wall side fixed", () => {
  const bottom = setTerrace(room(), 2, true); // below the room, y 700..950
  const deeper = setTerraceSize(bottom, 2, { depth: 400 });
  expect(deeper.zones[0]).toMatchObject({ y: 700, h: 400 });
  const shorter = setTerraceSize(bottom, 2, { along: 600 });
  expect(shorter.zones[0]).toMatchObject({ x: 200, w: 600 });
  expect(terraceSize(shorter, 2, shorter.zones[0])).toEqual({ along: 600, depth: TERRACE_DEPTH });
  const top = setTerrace(room(), 0, true); // above the room
  expect(setTerraceSize(top, 0, { depth: 400 }).zones[0]).toMatchObject({ y: -400, h: 400 }); // still against the wall
  const side = setTerrace(room(), 1, true); // right of the room
  expect(setTerraceSize(side, 1, { depth: 400 }).zones[0]).toMatchObject({ x: 1000, w: 400 });
  expect(() => setTerraceSize(bottom, 2, { depth: 10 })).toThrow("at least 50");
});

it("fits a terrace to a sloping wall, turned to match it", () => {
  const base = room(); // walls: 0 top, 1 right, 2 bottom, 3 left; slope the bottom wall (from 1000,700 to 0,600)
  const sloped = { ...base, outline: { points: [base.outline.points[0], base.outline.points[1], { ...base.outline.points[2], y: 700 }, { ...base.outline.points[3], y: 600 }] } };
  const next = setTerrace(sloped, 2, true);
  const zone = next.zones[0];
  expect(terraceOn(next, 2)).toBe(zone);
  expect(terraceRotation(next, zone)).toBeCloseTo(5.71, 1); // the angle of the wall
  expect(zone.w).toBe(Math.round(Math.hypot(1000, 100))); // as long as the wall
  const a = sloped.outline.points[2], b = sloped.outline.points[3], length = Math.hypot(b.x - a.x, b.y - a.y);
  const distance = (p: { x: number; y: number }) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length;
  const gaps = terraceCorners(next, zone).map(distance).sort((x, y) => x - y);
  expect(gaps[0]).toBeLessThan(1); expect(gaps[1]).toBeLessThan(1); // two corners lie on the wall
  expect(gaps[2]).toBeGreaterThan(TERRACE_DEPTH - 1); expect(gaps[3]).toBeGreaterThan(TERRACE_DEPTH - 1); // the others are a terrace deep away
  const deeper = setTerraceSize(next, 2, { depth: 400 });
  expect(terraceCorners(deeper, deeper.zones[0]).map(distance).sort((x, y) => x - y)[0]).toBeLessThan(1); // the wall side stays on the wall
  expect(validateRooms([addTable(next, "round", { x: 450, y: 760 })]).some(p => p.code === "table_outside")).toBe(false);
});
