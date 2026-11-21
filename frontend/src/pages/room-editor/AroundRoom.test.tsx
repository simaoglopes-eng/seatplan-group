import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { AroundRoom } from "./AroundRoom";
import { createRoom } from "./roomModel";
import { surroundingOf } from "./surroundings";
import type { Room } from "./roomModel";

const profile = vi.hoisted(() => vi.fn());
const nearby = vi.hoisted(() => vi.fn());
vi.mock("../../api/owner", () => ({ getOwnerProfile: profile }));
vi.mock("../../maps/nearbyFeatures", () => ({ findNearby: nearby }));

const show = (room: Room = createRoom("Room 1", 1000, 700), side = 0) => {
  const onChange = vi.fn(), onSide = vi.fn();
  render(<MemoryRouter><AroundRoom room={room} side={side} onSide={onSide} onChange={onChange} /></MemoryRouter>);
  return { onChange, onSide };
};
beforeEach(() => { profile.mockReset(); nearby.mockReset(); });

it("lets the owner say what is outside a wall, and clear it", () => {
  const { onChange, onSide } = show(undefined, 2);
  fireEvent.change(screen.getByLabelText("Wall"), { target: { value: "1" } });
  expect(onSide).toHaveBeenCalledWith(1);
  fireEvent.change(screen.getByLabelText("What is outside"), { target: { value: "sea" } });
  const next = onChange.mock.calls[0][0] as Room;
  expect(surroundingOf(next, 2)?.kind).toBe("sea");
});

it("shows what is already outside the chosen wall", () => {
  const withSea = createRoom("Room 1", 1000, 700);
  // a window carrying a sea view on wall 0
  const room: Room = { ...withSea, openings: [{ id: null, key: "o1", kind: "window", side: 0, offset: 100, width: 120, top_height: 220, is_main_entrance: false, view_text: "The sea", night_view_text: "", view_tags: ["sea"], sun_rule: "auto", sun_from: null, sun_until: null }] };
  show(room);
  expect((screen.getByLabelText("What is outside") as HTMLSelectElement).value).toBe("sea");
});

it("suggests walls from the restaurant's location and applies one with a tap", async () => {
  profile.mockResolvedValue({ lat: 38.7, lng: -9.1 });
  nearby.mockResolvedValue([{ kind: "sea", metres: 120, bearing: 180 }, { kind: "park", metres: 300, bearing: 270 }]);
  const { onChange, onSide } = show();
  fireEvent.click(screen.getByRole("button", { name: "Suggest from my location" }));
  expect(await screen.findByText("The sea, about 120 m to the south.")).toBeTruthy();
  expect(screen.getByText("A park, about 300 m to the west.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Put it on Wall 3" })); // the wall facing south
  expect(onSide).toHaveBeenCalledWith(2);
  const next = onChange.mock.calls[0][0] as Room;
  expect(surroundingOf(next, 2)?.kind).toBe("sea");
  expect(screen.getByRole("button", { name: "Put it on Wall 4" })).toBeTruthy(); // west
});

it("asks for the pin when the restaurant has none, and says when nothing is near or the lookup fails", async () => {
  profile.mockResolvedValue({ lat: null, lng: null });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Suggest from my location" }));
  expect(await screen.findByText(/Place the pin on the map/)).toBeTruthy();

  document.body.innerHTML = "";
  profile.mockResolvedValue({ lat: 1, lng: 1 }); nearby.mockResolvedValue([]);
  show();
  fireEvent.click(screen.getByRole("button", { name: "Suggest from my location" }));
  expect(await screen.findByText(/Nothing notable within a short walk/)).toBeTruthy();

  document.body.innerHTML = "";
  nearby.mockRejectedValue(new Error("offline"));
  show();
  fireEvent.click(screen.getByRole("button", { name: "Suggest from my location" }));
  await waitFor(() => expect(screen.getByText(/Could not look around your location/)).toBeTruthy());
});

it("says so beside the choice when the wall has no space for a window", () => {
  const base = createRoom("Room 1", 1000, 700);
  const full: Room = { ...base, openings: [{ id: null, key: "d", kind: "door", side: 0, offset: 0, width: 1000, top_height: 220, is_main_entrance: false, view_text: "", night_view_text: "", view_tags: [], sun_rule: "auto", sun_from: null, sun_until: null }] };
  const { onChange } = show(full);
  fireEvent.change(screen.getByLabelText("What is outside"), { target: { value: "sea" } });
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("no room on this wall");
});

it("adds a terrace against the chosen wall, and offers its width, depth and removal once it is there", () => {
  const first = show(undefined, 2);
  fireEvent.click(screen.getByRole("button", { name: "Add terrace" }));
  const withTerrace = first.onChange.mock.calls[0][0] as Room;
  expect(withTerrace.zones[0]).toMatchObject({ kind: "terrace", x: 0, y: 700, w: 1000 });
  document.body.innerHTML = "";
  const second = show(withTerrace, 2);
  expect((screen.getByLabelText("Terrace width (m)") as HTMLInputElement).value).toMatch(/^10/);
  expect((screen.getByLabelText("Terrace depth (m)") as HTMLInputElement).value).toMatch(/^2[,.]5/);
  fireEvent.click(screen.getByRole("button", { name: "Remove terrace" }));
  expect((second.onChange.mock.calls[0][0] as Room).zones).toHaveLength(0);
});
