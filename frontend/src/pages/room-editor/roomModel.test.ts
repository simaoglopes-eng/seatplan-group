import { expect, it } from "vitest";
import { nextRoomName } from "./roomModel";

it("names the next room after the rooms the restaurant already has", () => {
  expect(nextRoomName([])).toBe("Room 1");
  expect(nextRoomName([{ name: "Main room" }])).toBe("Room 2");
  expect(nextRoomName([{ name: "Main room" }, { name: "Terrace" }])).toBe("Room 3");
});

it("skips a room number that is already used, whatever the capitalisation", () => {
  expect(nextRoomName([{ name: "Room 2" }, { name: "Terrace" }])).toBe("Room 3");
  expect(nextRoomName([{ name: "ROOM 3 " }, { name: "Room 1" }, { name: "Bar" }])).toBe("Room 4");
});
