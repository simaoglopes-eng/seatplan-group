import { describe, expect, it } from "vitest";
import { MIN_SEAT_PX, SEAT_RADIUS, contentBounds, fitView, nearestInDirection, roomAround, seatGlyphScale, seatHitRadius, tableClearance, zoomAround } from "./geometry";

describe("seatGlyphScale (a zoomed-out phone map draws seats bigger, never overlapping)", () => {
  it("leaves seats alone once they are big enough on screen", () => {
    expect(seatGlyphScale(40, 30, 1)).toBe(1);
  });
  it("grows a 7px seat to the minimum size when there is room", () => {
    const k = 0.394; // the organiser map fitted to a 390px phone
    const scale = seatGlyphScale(32, 30, k);
    expect(2 * (SEAT_RADIUS - 1) * k * scale).toBeGreaterThanOrEqual(MIN_SEAT_PX - 0.5);
  });
  it("stops before touching a neighbour or the table, and never shrinks a seat", () => {
    const k = 0.4;
    const tight = seatGlyphScale(20, Infinity, k);
    expect(tight).toBeGreaterThan(1);
    expect(tight * SEAT_RADIUS).toBeLessThanOrEqual(20 - 3 / k);
    expect(seatGlyphScale(32, 12, k) * SEAT_RADIUS).toBeLessThanOrEqual(12);
    expect(seatGlyphScale(5, 5, k)).toBe(1);
  });
  it("measures the gap to a round table from its edge, and to a rotated rectangle in its own axes", () => {
    expect(tableClearance({ x: 0, y: -70 }, { id: 1, label: "T1", shape: "round", x: -50, y: -50, w: 100, h: 100, rotation: 0 })).toBeCloseTo(20);
    expect(tableClearance({ x: 0, y: -40 }, { id: 2, label: "T2", shape: "rect", x: -10, y: -50, w: 20, h: 100, rotation: 90 })).toBeCloseTo(30);
    expect(tableClearance({ x: 0, y: 0 }, { id: 3, label: "R1", shape: "row", x: -50, y: -5, w: 100, h: 10, rotation: 0 })).toBe(Infinity);
  });
});

// A plus sign of seats around the centre seat 5, plus one far-off seat 9.
//        1
//   4    5    6        9 (far right, slightly lower)
//        8
const POINTS = [
  { id: 1, x: 100, y: 50 },
  { id: 4, x: 50, y: 100 },
  { id: 5, x: 100, y: 100 },
  { id: 6, x: 150, y: 100 },
  { id: 8, x: 100, y: 150 },
  { id: 9, x: 400, y: 120 },
];

describe("nearestInDirection", () => {
  it("picks the closest seat in each direction", () => {
    expect(nearestInDirection(POINTS, 5, "up")).toBe(1);
    expect(nearestInDirection(POINTS, 5, "down")).toBe(8);
    expect(nearestInDirection(POINTS, 5, "left")).toBe(4);
    expect(nearestInDirection(POINTS, 5, "right")).toBe(6);
  });

  it("prefers a seat in line over a diagonal one", () => {
    // From 4, "right" must go to 5 (in line), not to 1 or 8 (diagonal, similar distance).
    expect(nearestInDirection(POINTS, 4, "right")).toBe(5);
  });

  it("returns null at the edge", () => {
    expect(nearestInDirection(POINTS, 9, "right")).toBeNull();
    expect(nearestInDirection(POINTS, 404, "right")).toBeNull();
  });
});

describe("camera maths", () => {
  it("fits content into the viewport, centred", () => {
    const view = fitView({ minX: 0, minY: 0, maxX: 200, maxY: 100 }, 400, 400);
    expect(view.k).toBe(2);
    expect(view.x).toBe(0);
    expect(view.y).toBe(100); // 400 tall viewport, 200 tall content, so 100 above and below
  });

  it("never zooms out below a readable zoom, and then centres on the focus point", () => {
    // 1000 units wide in a 400 px viewport would be k = 0.4; we ask for at least 0.8.
    const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 200 };
    const view = fitView(bounds, 400, 400, 0.8, { x: 900, y: 100 });
    expect(view.k).toBe(0.8);
    // The focus point is as central as the content edges allow: content ends at 800 px.
    expect(1000 * view.k + view.x).toBeCloseTo(400); // right edge of the content on the right edge of the screen
    // Vertically the content fits (160 px), so it is simply centred.
    expect(view.y).toBeCloseTo((400 - 160) / 2);
  });

  it("keeps the point under the cursor still while zooming", () => {
    const before = { x: 10, y: 20, k: 1 };
    const after = zoomAround(before, 2, 100, 100);
    // The venue point under (100, 100) was (90, 80); it must still be under (100, 100).
    expect(90 * after.k + after.x).toBeCloseTo(100);
    expect(80 * after.k + after.y).toBeCloseTo(100);
  });
});

describe("tap targets", () => {
  it("gives each seat half the distance to its nearest neighbour as room", () => {
    const room = roomAround([
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 60, y: 0 },
      { id: 3, x: 200, y: 0 },
    ]);
    expect(room.get(1)).toBe(30);
    expect(room.get(3)).toBe(70);
  });

  it("grows the hit area towards 44 px on screen, but never over a neighbour", () => {
    // Zoom 1: 44 px is 22 units, and there is room for it.
    expect(seatHitRadius(30, 1)).toBe(22);
    // Zoomed out, 44 px would be huge; the neighbour limits it to the room.
    expect(seatHitRadius(30, 0.3)).toBe(30);
    // Never smaller than the old fixed hit area.
    expect(seatHitRadius(5, 4)).toBe(SEAT_RADIUS + 4);
  });

  it("includes zones in the content bounds, so a stage is not cut off", () => {
    const bounds = contentBounds([], [], 0, [{ x: -50, y: -20, w: 10, h: 10 }]);
    expect(bounds.minX).toBe(-50);
    expect(bounds.minY).toBe(-20);
  });
});
