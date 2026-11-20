import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { createRoom } from "./roomModel";
import { WallTools } from "./WallTools";
import { mainEntrance, setMainEntrance } from "./wallModel";
import type { Room } from "./roomModel";

const show = (room: Room, onChange = vi.fn(), onSelect = vi.fn()) => {
  render(<MemoryRouter><WallTools room={room} selection={null} selected={null} onSelect={onSelect} onSide={vi.fn()} onChange={onChange} onError={vi.fn()} /></MemoryRouter>);
  return { onChange, onSelect };
};

it("puts the main entrance first and asks for it when the room has none", () => {
  show(createRoom("Room 1", 1000, 700));
  const headings = screen.getAllByRole("heading", { level: 3 }).map(h => h.textContent);
  expect(headings[0]).toBe("Main entrance");
  expect(screen.getByRole("button", { name: "Set main entrance" })).toBeTruthy();
});

it("places the main entrance on the chosen wall and selects its door", () => {
  const { onChange, onSelect } = show(createRoom("Room 1", 1000, 700));
  fireEvent.change(screen.getByLabelText("Wall of the main entrance"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Set main entrance" }));
  const next = onChange.mock.calls[0][0] as Room;
  expect(mainEntrance(next)).toMatchObject({ kind: "door", side: 2 });
  expect(onSelect).toHaveBeenCalledWith(mainEntrance(next)!.key);
});

it("offers to move an existing main entrance, never to place it where it already is", () => {
  const room = setMainEntrance(createRoom("Room 1", 1000, 700), 0);
  show(room);
  const button = screen.getByRole<HTMLButtonElement>("button", { name: "Move main entrance here" });
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Wall of the main entrance"), { target: { value: "1" } });
  expect(button.disabled).toBe(false);
});
