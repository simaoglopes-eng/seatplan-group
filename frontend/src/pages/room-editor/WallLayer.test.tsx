import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WallLayer } from "./WallLayer";
import { createRoom } from "./roomModel";
import { addOpening, updateOpening } from "./wallModel";

const layer = (room: ReturnType<typeof createRoom>) => render(
  <svg><WallLayer room={room} zoom={1} editing={false} selected={null} toWorld={() => ({ x: 0, y: 0 })} onSelect={vi.fn()} onChange={vi.fn()} onDragStart={vi.fn()} onError={vi.fn()} /></svg>,
);

it("tags only the door that is the main entrance", () => {
  const withDoors = addOpening(addOpening(createRoom("Room 1", 1000, 700), 0, "door"), 2, "door");
  const [first] = withDoors.openings;
  const room = updateOpening(withDoors, first.key, { is_main_entrance: true });
  const { container, getAllByText } = layer(room);
  expect(container.querySelectorAll("[data-main-entrance]")).toHaveLength(1);
  expect(getAllByText("Main entrance")).toHaveLength(1);
  expect(container.querySelectorAll("[data-opening]")).toHaveLength(2);
});

it("shows no tag when no door is marked", () => {
  const { container } = layer(addOpening(createRoom("Room 1", 1000, 700), 0, "door"));
  expect(container.querySelector("[data-main-entrance]")).toBeNull();
});
