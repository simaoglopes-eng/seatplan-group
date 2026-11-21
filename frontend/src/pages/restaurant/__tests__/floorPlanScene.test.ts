// The floor plan's pure rules: the view band outside a glass wall, the size of the picture and
// the quarter turn on a phone.
import { describe, expect, it } from "vitest";
import type { MapRoom, MapRoomOpening } from "../../../api/types";
import { BAND, ENTRANCE_OUT, entranceTags, planLayout, project, shouldTurn, viewBox, viewSides } from "../floorPlanScene";

const SQUARE = { points: [{ x: 0, y: 0, curve: 0 }, { x: 800, y: 0, curve: 0 }, { x: 800, y: 300, curve: 0 }, { x: 0, y: 300, curve: 0 }] };

function opening(side: number, kind: MapRoomOpening["kind"], text: string, tags: string[], night = ""): MapRoomOpening {
  return { id: side + 1, side, offset: 0, width: 800, kind, is_main_entrance: false, view_text: text, view_tags: tags, night_view_text: night, view_photo_url: "" };
}

function room(openings: MapRoomOpening[], night = false): MapRoom {
  return { id: 1, name: "Hall", is_outdoor: false, north_deg: 0, outline: SQUARE, width: 800, height: 300, openings, fixtures: [], sun: null, sun_patches: [], night };
}

describe("viewSides", () => {
  it("puts a river seen through the bottom glass wall below the plan", () => {
    expect(viewSides([room([opening(2, "glass_wall", "The Tagus river", ["river", "water"])])])).toEqual([{ side: "down", kind: "water", text: "The Tagus river" }]);
  });

  it("uses the night words after dark, and ignores doors and views that are neither water nor green", () => {
    const rooms = [room([opening(2, "window", "The Tagus river", ["river"], "The river lights"), opening(0, "door", "Garden", ["garden"]), opening(1, "window", "The street", ["street"])], true)];
    expect(viewSides(rooms)).toEqual([{ side: "down", kind: "water", text: "The river lights" }]);
  });

  it("finds a garden from the words when the owner gave no tags", () => {
    expect(viewSides([room([opening(3, "window", "Our herb garden", [])])])).toEqual([{ side: "left", kind: "green", text: "Our herb garden" }]);
  });
});

describe("planLayout", () => {
  it("grows the picture to hold the band, and the band spans the plan", () => {
    const plain = planLayout([], [], [], [room([])]);
    const withRiver = planLayout([], [], [], [room([opening(2, "glass_wall", "The river", ["river"])])]);
    expect(withRiver.bands).toHaveLength(1);
    const band = withRiver.bands[0];
    expect(band.h).toBe(BAND);
    expect(band.w).toBe(plain.bounds.maxX - plain.bounds.minX);
    expect(band.y).toBeGreaterThan(300);
    expect(withRiver.bounds.maxY).toBeGreaterThan(band.y + band.h);
    expect(withRiver.bounds.minY).toBe(plain.bounds.minY);
  });
});

describe("turning on a phone", () => {
  const wide = { minX: 0, minY: 0, maxX: 1000, maxY: 600 };
  it("turns only a wide plan, and only on a narrow screen", () => {
    expect(shouldTurn(wide, true)).toBe(true);
    expect(shouldTurn(wide, false)).toBe(false);
    expect(shouldTurn({ minX: 0, minY: 0, maxX: 600, maxY: 1000 }, true)).toBe(false);
  });

  it("projects points and the viewBox the same way, so every corner stays inside the picture", () => {
    const box = viewBox(wide, true);
    expect(box).toEqual({ x: -600, y: 0, w: 600, h: 1000 });
    for (const corner of [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 600 }, { x: 1000, y: 600 }]) {
      const p = project(corner, true);
      expect(p.x).toBeGreaterThanOrEqual(box.x);
      expect(p.x).toBeLessThanOrEqual(box.x + box.w);
      expect(p.y).toBeGreaterThanOrEqual(box.y);
      expect(p.y).toBeLessThanOrEqual(box.y + box.h);
    }
    expect(project({ x: 5, y: 7 }, false)).toEqual({ x: 5, y: 7 });
  });
});

describe("entranceTags", () => {
  const door = (side: number, offset: number, main: boolean): MapRoomOpening => ({ ...opening(side, "door", "", []), offset, width: 100, is_main_entrance: main });

  it("puts one tag just outside the main entrance, away from the room", () => {
    const tags = entranceTags([room([door(0, 300, true), door(2, 100, false)])]);
    expect(tags).toEqual([{ x: 350, y: -ENTRANCE_OUT }]);
  });

  it("draws nothing for a window, an ordinary door or a door on a missing wall", () => {
    expect(entranceTags([room([opening(0, "window", "", []), door(1, 50, false), door(9, 0, true)])])).toEqual([]);
  });

  it("grows the picture so the tag is not cut off", () => {
    const plain = planLayout([], [], [], [room([])]);
    const tagged = planLayout([], [], [], [room([door(0, 300, true)])]);
    expect(tagged.bounds.minY).toBeLessThan(plain.bounds.minY);
    expect(tagged.bounds.minY).toBeLessThanOrEqual(-ENTRANCE_OUT - 30);
    expect(tagged.bounds.maxX).toBe(plain.bounds.maxX);
  });
});
