import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TableTools } from "./TableTools";
import { createRoom } from "./roomModel";
import { addTable } from "./tableModel";
import type { Room } from "./roomModel";

const show = (room: Room, selected: string | null = null) => {
  const onPlace = vi.fn(), onChange = vi.fn();
  render(<TableTools room={room} selected={selected} onSelect={vi.fn()} onPlace={onPlace} onChange={onChange} onError={vi.fn()} />);
  return { onPlace, onChange };
};

it("offers a round table, a square table, a long table and a counter, each added with one tap", () => {
  const { onPlace } = show(createRoom("Room 1", 1000, 700));
  const names = screen.getAllByRole("button").map(b => b.getAttribute("aria-label")).filter(Boolean);
  expect(names).toEqual(["Place Round table", "Place Square table", "Place Long table", "Place Counter"]);
  expect(document.querySelectorAll(".room-object-palette svg")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Place Long table" }));
  expect(onPlace).toHaveBeenCalledWith("table:long", undefined);
  expect(screen.queryByRole("button", { name: "Place selected in room" })).toBeNull();
});

it("no longer lets the owner turn a table into another shape", () => {
  const room = addTable(createRoom("Room 1", 1000, 700), "round", { x: 100, y: 100 });
  show(room, room.tables[0].key);
  expect(screen.queryByLabelText("Table shape")).toBeNull();
});

it("makes the table bigger when a chair is added", () => {
  const room = addTable(createRoom("Room 1", 2000, 1000), "long", { x: 100, y: 100 });
  const { onChange } = show(room, room.tables[0].key);
  fireEvent.click(screen.getByRole("button", { name: "Add chair" }));
  const next = (onChange.mock.calls[0][0] as Room).tables[0];
  expect(next.seats).toHaveLength(7);
  expect(next.w).toBeGreaterThan(room.tables[0].w);
});
