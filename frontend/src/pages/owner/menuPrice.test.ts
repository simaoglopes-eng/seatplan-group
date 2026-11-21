import { expect, it } from "vitest";
import { euroCents } from "./menuPrice";

it("accepts euro commas and dots with exact cents and rejects invalid prices", () => {
  expect(euroCents("4,50")).toBe(450);
  expect(euroCents(" 12.1 ")).toBe(1210);
  expect(euroCents("0")).toBe(0);
  expect(euroCents("19.99")).toBe(1999);
  for (const value of ["", "-1", "1.111", "1e3", "Infinity", "10000.01"]) expect(euroCents(value)).toBeNull();
});
