import { expect, it } from "vitest";
import { sourceTile, strokeGrowth } from "./tileSource";

it("uses the tile itself up to the stored detail", () => {
  expect(sourceTile({ x: 5, y: 6, z: 14 }, 14)).toEqual({ x: 5, y: 6, z: 14, scale: 1, offsetX: 0, offsetY: 0 });
  expect(sourceTile({ x: 5, y: 6, z: 9 }, 14).scale).toBe(1);
});

it("cuts a finer tile from its parent and says which part", () => {
  expect(sourceTile({ x: 9, y: 4, z: 15 }, 14)).toEqual({ z: 14, x: 4, y: 2, scale: 2, offsetX: 1, offsetY: 0 });
  const deep = sourceTile({ x: 8 * 32 + 31, y: 3 * 32 + 5, z: 19 }, 14);
  expect(deep).toEqual({ z: 14, x: 8, y: 3, scale: 32, offsetX: 31, offsetY: 5 });
});

it("lets strokes grow gently past the stored detail", () => {
  expect(strokeGrowth(14, 14)).toBe(1);
  expect(strokeGrowth(12, 14)).toBe(1);
  expect(strokeGrowth(19, 14)).toBeCloseTo(3, 5);
});
