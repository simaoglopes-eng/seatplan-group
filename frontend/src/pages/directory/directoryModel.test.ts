import { describe, expect, it } from "vitest";
import { countryFrom, directoryHref, kindFrom, placeLine, planHref, safeWebsite } from "./directoryModel";

describe("directoryModel", () => {
  it("keeps only known address-bar values", () => {
    expect(countryFrom("PT")).toBe("PT");
    expect(countryFrom("pt")).toBeNull();
    expect(countryFrom("FR")).toBeNull();
    expect(kindFrom("estate")).toBe("estate");
    expect(kindFrom("castle")).toBeNull();
  });
  it("builds the directory and plan links", () => {
    expect(directoryHref(null, null)).toBe("/directory");
    expect(directoryHref("BE", "hall")).toBe("/directory?country=BE&kind=hall");
    expect(planHref({ id: "w12" })).toBe("/organiser?at=w12");
  });
  it("says Near when the town was inferred", () => {
    expect(placeLine({ city: "Sintra", city_inferred: false, country_label: "Portugal" })).toBe("Sintra, Portugal");
    expect(placeLine({ city: "Sintra", city_inferred: true, country_label: "Portugal" })).toBe("Near Sintra, Portugal");
    expect(placeLine({ city: null, city_inferred: false, country_label: "Italy" })).toBe("Italy");
  });
  it("shows only http(s) websites", () => {
    expect(safeWebsite("https://a.pt")).toBe("https://a.pt");
    expect(safeWebsite("javascript:alert(1)")).toBeNull();
    expect(safeWebsite(null)).toBeNull();
  });
});
