import { expect, it } from "vitest";
import { createRoom } from "./roomModel";
import { addFixture, editFixture, addZone, editZone, removeZone, fixtureSize, FIXTURE_KINDS, ZONE_KINDS } from "./roomObjects";

it("places every fixed element with independent keys and immutable edits", () => {
  const original = createRoom("Main", 1000, 700);
  let room = original;
  for (const kind of FIXTURE_KINDS) room = addFixture(room, kind, { x: 100, y: 100 });
  expect(original.fixtures).toEqual([]);
  expect(room.fixtures).toHaveLength(11);
  expect(new Set(room.fixtures.map(f => f.key)).size).toBe(11);
  const key = room.fixtures[0].key;
  const changed = editFixture(room, key, { x: 200, rotation: 90, label: "Main bar" });
  expect(changed.fixtures[0]).toMatchObject({ x: 200, rotation: 90, label: "Main bar" });
  expect(room.fixtures[0].label).toBe("");
  expect(changed.fixtures[0].key).toBe(key);
  expect(() => editFixture(room, key, { w: 0 })).toThrow();
  expect(() => editFixture(room, key, { label: "x".repeat(41) })).toThrow();
});

it("creates every zone type and removes only links to the deleted zone", () => {
  let room = createRoom("Main", 1000, 700);
  for (const kind of ZONE_KINDS) room = addZone(room, kind, { x: 50, y: 100 });
  expect(room.zones).toHaveLength(7);
  const key = room.zones[0].key;
  const changed = editZone(room, key, { name: "Quiet corner", kind: "quiet", w: 350 });
  expect(changed.zones[0]).toMatchObject({ name: "Quiet corner", kind: "quiet", w: 350 });
  expect(room.zones[0].name).toBe("Zone 1");
  const table = { id: null, key: "t1", zone_key: key, label: "Table 1", shape: "rect" as const, x: 10, y: 10, w: 80, h: 80, rotation: 0, min_party: 1, max_party: 4, is_accessible: false, high_chair_ok: false, combine_group: null, is_active: true, seats: [] };
  const linked = { ...changed, tables: [table, { ...table, key: "t2", zone_key: "another" }] };
  const removed = removeZone(linked, key);
  expect(removed.tables.map(t => t.zone_key)).toEqual([null, "another"]);
  expect(linked.tables[0].zone_key).toBe(key);
  expect(() => editZone(room, key, { name: "" })).toThrow();
  expect(() => editZone(room, key, { h: NaN })).toThrow();
});

it("resizes circles consistently and preserves persisted fixture identifiers", () => {
  const room = addFixture(createRoom("Main", 1000, 700), "column", { x: 100, y: 100 });
  room.fixtures[0].id = 12;
  const key = room.fixtures[0].key;
  expect(editFixture(room, key, { h: 90, rotation: 375, id: 999, key: "other" }).fixtures[0]).toMatchObject({ id: 12, key, w: 90, h: 90, rotation: 15 });
});

it("preserves the existing eighty-character zone name limit while moving", () => {
  const room = addZone(createRoom("Main", 1000, 700), "general", { x: 50, y: 50 });
  room.zones[0].name = "x".repeat(80);
  expect(editZone(room, room.zones[0].key, { x: 100 }).zones[0].name).toHaveLength(80);
});

it("keeps a fixed element inside the room when it is added, moved, resized or turned", () => {
  const room = addFixture(createRoom("Main", 1000, 700), "bar", { x: 100, y: 100 });
  const key = room.fixtures[0].key;
  expect(() => editFixture(room, key, { x: 5000 })).toThrow("inside the room");
  expect(() => editFixture(room, key, { x: 900 })).toThrow("inside the room"); // 150 wide: pokes through the right wall
  expect(() => editFixture(room, key, { w: 2000 })).toThrow("inside the room");
  expect(editFixture(room, key, { x: 840, y: 600 }).fixtures[0]).toMatchObject({ x: 840, y: 600 }); // touching the walls is fine
  expect(editFixture(room, key, { label: "Bar" }).fixtures[0].label).toBe("Bar");
});

it("puts an element dropped outside the room on the nearest spot inside", () => {
  const room = addFixture(createRoom("Main", 1000, 700), "bar", { x: 5000, y: 100 });
  const bar = room.fixtures[0];
  const size = fixtureSize("bar");
  expect(bar.x + size.w).toBeLessThanOrEqual(1000);
  expect(bar.x).toBeGreaterThan(800);
  expect(bar.y).toBeGreaterThanOrEqual(0);
});

it("refuses an element that fits nowhere in the room", () => {
  const tiny = createRoom("Tiny", 200, 200);
  expect(() => addFixture(tiny, "awning", { x: 0, y: 0 })).toThrow("no room");
});

it("leaves an element that an older plan put outside the room editable", () => {
  const room = addFixture(createRoom("Main", 1000, 700), "bar", { x: 100, y: 100 });
  const stray = { ...room, fixtures: [{ ...room.fixtures[0], x: 4000 }] };
  expect(editFixture(stray, stray.fixtures[0].key, { label: "Old bar" }).fixtures[0].label).toBe("Old bar");
  expect(editFixture(stray, stray.fixtures[0].key, { x: 4100 }).fixtures[0].x).toBe(4100);
});

it("names new zones Terrace and Quiet zone, then numbers repeats, and lets them stand outside the room", () => {
  let room = createRoom("Main", 1000, 700);
  room = addZone(room, "terrace", { x: 1200, y: -300 }); // outside the walls, and welcome
  room = addZone(room, "terrace", { x: 100, y: 100 });
  room = addZone(room, "quiet", { x: 300, y: 300 });
  expect(room.zones.map(z => z.name)).toEqual(["Terrace", "Terrace 2", "Quiet zone"]);
  expect(room.zones[0]).toMatchObject({ x: 1200, y: -300 });
  expect(editZone(room, room.zones[1].key, { x: 5000, y: -2000 }).zones[1]).toMatchObject({ x: 5000, y: -2000 });
  expect(addZone(createRoom("Other", 1000, 700), "general", { x: 0, y: 0 }).zones[0].name).toBe("Zone 1");
});
