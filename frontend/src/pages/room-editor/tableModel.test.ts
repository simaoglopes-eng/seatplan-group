import { expect, it } from "vitest";
import { createRoom } from "./roomModel";
import { addTable, editTable, setChairCount, editChair, tableKind, tableSize } from "./tableModel";

it("creates the four specified tables and keeps counter chairs on one side", () => {
  let room = createRoom("Main", 1000, 700);
  for (const kind of ["round", "square", "long", "counter"] as const) room = addTable(room, kind, { x: 100, y: 100 });
  expect(room.tables.map(t => [t.shape, t.w, t.h, t.seats.length])).toEqual([
    ["round", 90, 90, 4], ["rect", 80, 80, 4], ["rect", 180, 80, 6], ["row", 300, 50, 5], // real sizes: 90 cm round for four, 180 x 80 cm for six
  ]);
  expect(room.tables.map(t => t.label)).toEqual(["Table 1", "Table 2", "Table 3", "Table 4"]);
  expect(room.tables[3].seats.map(s => [s.x, s.y])).toEqual([[130, 84], [190, 84], [250, 84], [310, 84], [370, 84]]);
});

it("edits table geometry and flags without losing seat ids or custom offsets", () => {
  const original = addTable(createRoom("Main", 1000, 700), "round", { x: 100, y: 100 });
  const key = original.tables[0].key;
  original.tables[0].seats[0].id = 12;
  const custom = editChair(original, key, original.tables[0].seats[0].key, { x: 200, label: "Window", is_accessible: true });
  const moved = editTable(custom, key, { x: 200, y: 300, rotation: 90, is_active: false, high_chair_ok: true, combine_group: "A" });
  expect(moved.tables[0].seats[0]).toMatchObject({ id: 12, label: "Window", x: 306, y: 400, is_accessible: true });
  expect(moved.tables[0]).toMatchObject({ is_active: false, high_chair_ok: true, combine_group: "A" });
  expect(original.tables[0].x).toBe(100);
  expect(original.tables[0].seats[0].label).toBe("1");
});

it("changes chair count within 1–20 and preserves existing identifiers and labels", () => {
  const room = addTable(createRoom("Main", 1000, 700), "square", { x: 100, y: 100 });
  const key = room.tables[0].key, chairKey = room.tables[0].seats[0].key;
  const more = setChairCount(room, key, 6);
  expect(more.tables[0].seats).toHaveLength(6);
  expect(more.tables[0].max_party).toBe(6);
  expect(more.tables[0].seats[0].key).toBe(chairKey);
  expect(room.tables[0].seats).toHaveLength(4);
  expect(() => setChairCount(room, key, 0)).toThrow();
  expect(() => setChairCount(room, key, 21)).toThrow();
  expect(() => editTable(room, key, { min_party: 5 })).toThrow();
  expect(() => editTable(room, key, { label: "" })).toThrow();
  expect(() => editChair(room, key, chairKey, { x: Infinity })).toThrow();
});

it("requires table names unique within a room and keeps round dimensions equal", () => {
  const first = addTable(createRoom("Main", 1000, 700), "round", { x: 100, y: 100 });
  const room = addTable(first, "round", { x: 300, y: 100 });
  expect(() => editTable(room, room.tables[1].key, { label: "Table 1" })).toThrow();
  expect(editTable(room, room.tables[0].key, { h: 120 }).tables[0]).toMatchObject({ w: 120, h: 120 });
});

it("gives every kind of table a real size that grows with its chairs", () => {
  for (const kind of ["round", "square", "long", "counter"] as const) {
    let before = tableSize(kind, 1);
    for (let chairs = 2; chairs <= 12; chairs++) {
      const now = tableSize(kind, chairs);
      expect(now.w * now.h).toBeGreaterThanOrEqual(before.w * before.h);
      before = now;
    }
  }
  expect(tableSize("long", 8).w).toBeGreaterThan(tableSize("long", 6).w);
  expect(tableSize("round", 8).w).toBeGreaterThan(tableSize("round", 6).w);
  expect(tableSize("counter", 8).w).toBeGreaterThan(tableSize("counter", 5).w);
  expect(tableSize("round", 4)).toEqual({ w: 90, h: 90 });
  expect(tableSize("round", 8)).toEqual({ w: 150, h: 150 });
  expect(tableSize("long", 6)).toEqual({ w: 180, h: 80 });
  expect(tableSize("counter", 5)).toEqual({ w: 300, h: 50 });
});

it("makes the table longer when chairs are added, and shorter when they are taken away, about its centre", () => {
  let room = addTable(createRoom("Main", 2000, 1000), "long", { x: 500, y: 300 });
  const key = room.tables[0].key, centre = () => ({ x: room.tables[0].x + room.tables[0].w / 2, y: room.tables[0].y + room.tables[0].h / 2 });
  const before = centre();
  room = setChairCount(room, key, 8);
  expect(room.tables[0]).toMatchObject({ w: 240, h: 80 });
  expect(centre()).toEqual(before);
  expect(room.tables[0].seats).toHaveLength(8);
  room = setChairCount(room, key, 4);
  expect(room.tables[0]).toMatchObject({ w: 120, h: 80 });
  const roundRoom = addTable(createRoom("Main", 2000, 1000), "round", { x: 500, y: 300 });
  const eight = setChairCount(roundRoom, roundRoom.tables[0].key, 8).tables[0];
  expect([eight.w, eight.h, eight.seats.length]).toEqual([150, 150, 8]); // a round table stays round
});

it("tells the four kinds apart from a table's shape and size", () => {
  expect(tableKind({ shape: "round", w: 90, h: 90 })).toBe("round");
  expect(tableKind({ shape: "row", w: 300, h: 50 })).toBe("counter");
  expect(tableKind({ shape: "rect", w: 80, h: 80 })).toBe("square");
  expect(tableKind({ shape: "rect", w: 180, h: 80 })).toBe("long");
});
