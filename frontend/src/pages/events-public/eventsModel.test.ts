import { describe, expect, it } from "vitest";
import { areaOf, capacityText, eventTypeFrom, placesLeftText, venueTypeFrom, workRoleLabel } from "./eventsModel";

const TYPES = [
  { key: "wedding", label: "Wedding" },
  { key: "conference", label: "Conference" },
];

describe("areaOf", () => {
  it("takes the town at the end of the address", () => {
    expect(areaOf("Estrada da Pena 140, Sintra")).toBe("Sintra");
    expect(areaOf("Alameda dos Oceanos 21,  Lisboa ")).toBe("Lisboa");
  });
  it("keeps a one-part address and gives nothing for an empty one", () => {
    expect(areaOf("Sintra")).toBe("Sintra");
    expect(areaOf("")).toBe("");
    expect(areaOf(null)).toBe("");
  });
});

describe("placesLeftText", () => {
  it("says full, one place, or the number", () => {
    expect(placesLeftText(0)).toBe("Full");
    expect(placesLeftText(1)).toBe("1 place left");
    expect(placesLeftText(39)).toBe("39 places left");
  });
  it("says nothing when the number is unknown", () => {
    expect(placesLeftText(null)).toBe("");
    expect(placesLeftText(undefined)).toBe("");
  });
});

describe("capacityText", () => {
  it("names guests and tables, singular and plural", () => {
    expect(capacityText(80, 10)).toBe("Up to 80 guests at 10 tables");
    expect(capacityText(1, 1)).toBe("Up to 1 guest at 1 table");
    expect(capacityText(48, 0)).toBe("Up to 48 guests");
  });
});

describe("eventTypeFrom", () => {
  it("accepts only a known type key from the address bar", () => {
    expect(eventTypeFrom("wedding", TYPES)).toBe("wedding");
    expect(eventTypeFrom("WEDDING", TYPES)).toBeNull();
    expect(eventTypeFrom("party", TYPES)).toBeNull();
    expect(eventTypeFrom(null, TYPES)).toBeNull();
  });
  it("trusts nothing before the types have loaded", () => {
    expect(eventTypeFrom("wedding", [])).toBeNull();
  });
});

describe("venueTypeFrom", () => {
  it("knows halls and quintas only", () => {
    expect(venueTypeFrom("hall")).toBe("hall");
    expect(venueTypeFrom("quinta")).toBe("quinta");
    expect(venueTypeFrom("castle")).toBeNull();
    expect(venueTypeFrom(null)).toBeNull();
  });
});

describe("workRoleLabel", () => {
  it("names each role in words", () => {
    expect(workRoleLabel("owner")).toBe("Owner");
    expect(workRoleLabel("staff")).toBe("Staff");
    expect(workRoleLabel("organiser")).toBe("Organiser");
  });
});
