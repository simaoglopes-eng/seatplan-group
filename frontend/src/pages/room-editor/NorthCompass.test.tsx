import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { NorthCompass } from "./NorthCompass";
import { createRoom, withNorthUp } from "./roomModel";
import type { RoomLayout } from "./roomModel";

it("is a fixed mark that says north is at the top of the plan, with nothing to turn", () => {
  render(<NorthCompass />);
  expect(screen.getByRole("img", { name: "North is at the top of the plan" })).toBeTruthy();
  expect(screen.queryByRole("slider")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

it("gives a new room north 0, so zero degrees is the value rather than 'not set'", () => {
  expect(createRoom("Room 1", 1000, 700).north_deg).toBe(0);
});

it("edits every room with north at the top, whatever the server holds", () => {
  const room = createRoom("Room 1", 1000, 700);
  const layout: RoomLayout = { base_version: 3, rooms: [{ ...room, north_deg: null }, { ...room, key: "b", north_deg: 200 }, { ...room, key: "c", north_deg: 0 }] };
  const up = withNorthUp(layout);
  expect(up.rooms.map(r => r.north_deg)).toEqual([0, 0, 0]);
  expect(up.base_version).toBe(3);
  expect(up.rooms[2]).toBe(layout.rooms[2]);
});
