import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RoomProperties } from "./RoomProperties";
import { createRoom } from "./roomModel";
import { addOpening } from "./wallModel";
import type { Room } from "./roomModel";
import type { ShapeSelection } from "./ShapeTools";

const show = (room: Room, selection: ShapeSelection = null) => {
  const onChange = vi.fn(), onSelect = vi.fn();
  render(<RoomProperties room={room} selection={selection} onSelect={onSelect} onChange={onChange} onError={vi.fn()} />);
  return { onChange, onSelect };
};

it("adds a wall by splitting the longest wall when none is selected, and selects the new wall", () => {
  const { onChange, onSelect } = show(createRoom("Room 1", 1000, 700));
  fireEvent.click(screen.getByRole("button", { name: "Add a new wall" }));
  const next = onChange.mock.calls[0][0] as Room;
  expect(next.outline.points).toHaveLength(5);
  expect(onSelect).toHaveBeenCalledWith({ kind: "side", index: 1 });
});

it("splits the selected wall in half", () => {
  const { onChange, onSelect } = show(createRoom("Room 1", 1000, 700), { kind: "side", index: 1 });
  fireEvent.click(screen.getByRole("button", { name: "Add a new wall" }));
  const next = onChange.mock.calls[0][0] as Room;
  expect(next.outline.points).toHaveLength(5);
  expect(next.outline.points[2]).toMatchObject({ x: 1000, y: 350 });
  expect(onSelect).toHaveBeenCalledWith({ kind: "side", index: 2 });
});

it("explains itself next to the button when the wall cannot be split", () => {
  const room = addOpening(createRoom("Room 1", 1000, 700), 0, "window");
  const wide = { ...room, openings: [{ ...room.openings[0], offset: 0, width: 1000 }] };
  const { onChange } = show(wide, { kind: "side", index: 0 });
  fireEvent.click(screen.getByRole("button", { name: "Add a new wall" }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("Move the opening away");
});
