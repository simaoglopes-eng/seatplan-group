import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FixtureTools } from "./FixtureTools";
import { createRoom } from "./roomModel";
import { addFixture, addZone } from "./roomObjects";
import type { Room } from "./roomModel";

const show = (room: Room, selected: string | null = null, free = false) => {
  const onPlace = vi.fn(), onSelect = vi.fn(), onChange = vi.fn(), onFree = vi.fn();
  render(<FixtureTools room={room} selected={selected} free={free} onFree={onFree} onSelect={onSelect} onPlace={onPlace} onChange={onChange} onError={vi.fn()} />);
  return { onPlace, onSelect, onChange, onFree };
};
const empty = () => createRoom("Room 1", 1000, 700);

it("adds an element with one tap and offers no second step", () => {
  const { onPlace } = show(empty());
  fireEvent.click(screen.getByRole("button", { name: "Place Bar" }));
  expect(onPlace).toHaveBeenCalledWith("fixture:bar");
  expect(screen.queryByRole("button", { name: "Place selected in room" })).toBeNull();
});

it("shows only Remove for a chosen element, with size, position and shape tucked away", () => {
  const room = addFixture(empty(), "bar", { x: 100, y: 100 });
  show(room, room.fixtures[0].key);
  expect(screen.queryByLabelText("Rename label")).toBeNull();
  expect(screen.queryByRole("button", { name: "Rotate 90°" })).toBeNull();
  expect(screen.getByRole("button", { name: "Remove fixed element" })).toBeTruthy();
  const more = document.querySelector<HTMLDetailsElement>("details.room-more")!;
  expect(more.open).toBe(false);
  expect(more.textContent).toContain("Size, position and shape");
  expect(more.querySelector("input")).not.toBeNull();
});

it("lists the elements to choose from only when there are two or more", () => {
  const one = addFixture(empty(), "bar", { x: 100, y: 100 });
  const { onSelect } = show(one);
  expect(screen.queryByLabelText("Selected fixed element")).toBeNull();
  const two = addFixture(one, "plant", { x: 300, y: 300 });
  const second = render(<FixtureTools room={two} selected={null} free={false} onFree={vi.fn()} onSelect={onSelect} onPlace={vi.fn()} onChange={vi.fn()} onError={vi.fn()} />);
  expect(second.getByLabelText("Selected fixed element")).toBeTruthy();
});

it("offers free placement as a switch that starts off", () => {
  const { onFree } = show(empty());
  const box = screen.getByLabelText<HTMLInputElement>("Free placement (no grid snapping)");
  expect(box.checked).toBe(false);
  fireEvent.click(box);
  expect(onFree).toHaveBeenCalledWith(true);
});

it("offers a bar, a WC, stairs, a TV and a quiet zone, each with an icon (a terrace is chosen on a wall instead)", () => {
  show(empty());
  const names = screen.getAllByRole("button").map(b => b.getAttribute("aria-label")).filter(Boolean);
  expect(names).toEqual(["Place Bar", "Place WC", "Place Stairs", "Place TV", "Place Quiet zone"]);
  expect(document.querySelectorAll(".room-object-palette svg")).toHaveLength(5);
});

it("adds a quiet zone with one tap, like any other element", () => {
  const { onPlace } = show(empty());
  fireEvent.click(screen.getByRole("button", { name: "Place Quiet zone" }));
  expect(onPlace).toHaveBeenCalledWith("zone:quiet");
});

it("edits a chosen zone here: size and position, remove", () => {
  const room = addZone(empty(), "terrace", { x: 100, y: 100 });
  const { onChange, onSelect } = show(room, room.zones[0].key);
  expect(screen.queryByLabelText("Rename label")).toBeNull();
  expect(screen.queryByRole("button", { name: "Rotate 90°" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remove zone" }));
  expect((onChange.mock.calls[0][0] as Room).zones).toHaveLength(0);
  expect(onSelect).toHaveBeenCalledWith(null);
});

it("lists fixed elements and zones together once there are two or more", () => {
  const room = addZone(addFixture(empty(), "bar", { x: 100, y: 100 }), "quiet", { x: 400, y: 300 });
  show(room);
  const options = Array.from(screen.getByLabelText("Selected fixed element").querySelectorAll("option")).map(o => o.textContent);
  expect(options).toEqual(["Choose an element", "Bar 1", "Quiet zone"]);
});

