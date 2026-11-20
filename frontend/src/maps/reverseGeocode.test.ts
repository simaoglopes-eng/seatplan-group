import { afterEach, expect, it, vi } from "vitest";
import { formatAddress, reverseGeocode } from "./reverseGeocode";

afterEach(() => vi.unstubAllGlobals());

it("builds a street, postcode and city line", () => {
  expect(formatAddress({ address: { road: "Rua do Alecrim", house_number: "50", postcode: "1200-014", city: "Lisboa" } })).toBe("Rua do Alecrim 50, 1200-014 Lisboa");
  expect(formatAddress({ address: { pedestrian: "Praça do Comércio", town: "Lisboa" } })).toBe("Praça do Comércio, Lisboa");
});

it("falls back to the display name and caps the length at 200", () => {
  expect(formatAddress({ display_name: "Somewhere, Portugal" })).toBe("Somewhere, Portugal");
  expect(formatAddress({ display_name: "x".repeat(300) })).toHaveLength(200);
  expect(formatAddress({})).toBe("");
});

it("asks OpenStreetMap once for the pin and returns the address", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ address: { road: "Rua A", postcode: "1000-001", city: "Lisboa" } }) });
  vi.stubGlobal("fetch", fetchMock);
  await expect(reverseGeocode({ lat: 38.72237, lng: -9.13954 })).resolves.toBe("Rua A, 1000-001 Lisboa");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const url = String(fetchMock.mock.calls[0][0]);
  expect(url).toContain("https://nominatim.openstreetmap.org/reverse?");
  expect(url).toContain("lat=38.722370");
  expect(url).toContain("lon=-9.139540");
});

it("returns null when the service fails or finds nothing", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  await expect(reverseGeocode({ lat: 1, lng: 1 })).resolves.toBeNull();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: "Unable to geocode" }) }));
  await expect(reverseGeocode({ lat: 1, lng: 1 })).resolves.toBeNull();
});
