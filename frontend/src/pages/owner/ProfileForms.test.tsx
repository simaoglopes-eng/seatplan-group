import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EMPTY_PROFILE, LocationForm } from "./ProfileForms";

// The real map needs a browser; this stand-in places a pin the way a click on the map does.
vi.mock("../../maps/LeafletMap", () => ({
  default: ({ onChange }: { onChange: (point: { lat: number; lng: number }) => void }) => <button type="button" onClick={() => onChange({ lat: 38.72237, lng: -9.13954 })}>Place pin</button>,
}));

const reply = (address: object) => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ address }) });
const address = () => screen.getByLabelText<HTMLInputElement>("Address");
const placePin = async () => { fireEvent.click(await screen.findByRole("button", { name: "Place pin" })); };

afterEach(() => vi.unstubAllGlobals());

it("never asks for the device location and keeps the coordinate fields usable", async () => {
  const locate = vi.fn();
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: locate } });
  render(<LocationForm profile={EMPTY_PROFILE} label="Save" onSave={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Use my current location" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "39" } });
  expect(screen.getByLabelText<HTMLInputElement>("Latitude").value).toBe("39");
  expect(locate).not.toHaveBeenCalled();
  Reflect.deleteProperty(navigator, "geolocation");
});

it("fills an empty address from the pin with one lookup and the owner can keep editing it", async () => {
  const fetchMock = reply({ road: "Rua A", house_number: "1", postcode: "1000-001", city: "Lisboa" });
  vi.stubGlobal("fetch", fetchMock);
  render(<LocationForm profile={EMPTY_PROFILE} label="Save" onSave={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Fill address from pin" })).toBeNull();
  await placePin();
  expect(fetchMock).not.toHaveBeenCalled();
  await waitFor(() => expect(address().value).toBe("Rua A 1, 1000-001 Lisboa"), { timeout: 3000 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Address filled from the pin/)).toBeTruthy();
  fireEvent.change(address(), { target: { value: "My own address" } });
  expect(address().value).toBe("My own address");
});

it("updates an address it filled itself when the pin moves, but never one the owner typed", async () => {
  const fetchMock = reply({ road: "Rua B", postcode: "2000-002", city: "Lisboa" });
  vi.stubGlobal("fetch", fetchMock);
  render(<LocationForm profile={EMPTY_PROFILE} label="Save" onSave={vi.fn()} />);
  await placePin();
  await waitFor(() => expect(address().value).toBe("Rua B, 2000-002 Lisboa"), { timeout: 3000 });
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ address: { road: "Rua C", city: "Porto" } }) });
  await placePin();
  await waitFor(() => expect(address().value).toBe("Rua C, Porto"), { timeout: 3000 });
  fireEvent.change(address(), { target: { value: "Typed by the owner" } });
  await placePin();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3), { timeout: 3000 });
  expect(address().value).toBe("Typed by the owner");
});

it("keeps the form usable when the address lookup fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("blocked")));
  render(<LocationForm profile={EMPTY_PROFILE} label="Save" onSave={vi.fn()} />);
  await placePin();
  await waitFor(() => expect(screen.getByText(/Could not look up the address/)).toBeTruthy(), { timeout: 3000 });
  expect(address().value).toBe("");
  fireEvent.change(address(), { target: { value: "Typed after the failure" } });
  expect(address().value).toBe("Typed after the failure");
});
