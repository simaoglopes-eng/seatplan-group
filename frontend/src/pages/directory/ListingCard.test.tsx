import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Listing } from "../../api/venueDirectory";
import { ALL_ILLUSTRATIVE, ILLUSTRATIVE_PHOTOS, illustrativeFor, illustrativeLayout } from "../../data/illustrativePhotos";
import { VENUE_PHOTOS, venuePhoto } from "../../data/venuePhotos";
import { ListingCard, cardPhoto } from "./ListingCard";

const listing = (over: Partial<Listing>): Listing => ({
  id: "w1", name: "Somewhere", kind: "estate", kind_label: "Quinta or estate", country: "PT", country_label: "Portugal",
  city: "Sintra", city_inferred: false, street: null, postcode: null, lat: 0, lng: 0, website: null,
  source_url: "https://www.openstreetmap.org/way/1", ...over,
});

function renderCard(l: Listing) {
  render(
    <MemoryRouter>
      <ListingCard listing={l} />
    </MemoryRouter>,
  );
  return screen.getByRole("article");
}

describe("ListingCard photo", () => {
  it("uses the venue's own photo when there is one, with its alt text and no label", () => {
    const card = renderCard(listing({ id: "w43664624", name: "Roma Convention Center La Nuvola", kind: "conference" }));
    const img = within(card).getByRole("img");
    expect(img.getAttribute("src")).toBe(VENUE_PHOTOS.w43664624.src);
    expect(img.getAttribute("alt")).toBe("Roma Convention Center La Nuvola, the glass box in EUR");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("width")).toBe("800");
    expect(img.getAttribute("height")).toBe("600");
    expect(within(card).queryByText("Illustrative photo")).toBeNull();
  });

  it("uses an illustrative photo of the same kind otherwise, with alt=\"\" and the visible label", () => {
    const l = listing({ id: "w999000111", kind: "hall" });
    expect(venuePhoto(l.id)).toBeUndefined();
    const card = renderCard(l);
    // alt="" makes the img presentational, so it is not an "img" role: query the element.
    const img = card.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("src")).toBe(illustrativeFor("hall", l.id).src);
    expect(ILLUSTRATIVE_PHOTOS.hall.map((p) => p.src)).toContain(img?.getAttribute("src"));
    expect(img?.getAttribute("loading")).toBe("lazy");
    const label = within(card).getByText("Illustrative photo");
    expect(label.closest(".dir-card-photo")).toBe(img?.parentElement);
  });

  it("gives every one of the 45 venue photos an alt text, a name and a country, never the label", () => {
    for (const [id, photo] of Object.entries(VENUE_PHOTOS)) {
      expect(photo.alt.trim()).not.toBe("");
      expect(photo.name.trim()).not.toBe("");
      expect(["PT", "BE", "IT"]).toContain(photo.countryCode);
      expect(["Portugal", "Belgium", "Italy"]).toContain(photo.country);
      expect(photo.src).toMatch(/^\/images\/venues\/(node|way|relation)-\d+\.jpg$/);
      // The id is the first letter of the OSM type + the number, as public_ref builds it.
      const [, type, number] = /^\/images\/venues\/(node|way|relation)-(\d+)\.jpg$/.exec(photo.src) ?? [];
      expect(id).toBe(`${type[0]}${number}`);
      expect(cardPhoto({ id, kind: "hall" }).illustrative).toBe(false);
    }
    expect(Object.keys(VENUE_PHOTOS)).toHaveLength(45);
  });
});

describe("illustrativeFor", () => {
  it("always picks the same photo for the same venue", () => {
    for (const kind of ["estate", "hall", "conference"] as const) {
      for (const id of ["n1", "w2", "r3", "w542292860", "n12384197877"]) {
        expect(illustrativeFor(kind, id)).toBe(illustrativeFor(kind, id));
        expect(ILLUSTRATIVE_PHOTOS[kind]).toContain(illustrativeFor(kind, id));
      }
    }
  });

  it("spreads neighbouring ids over every photo of the kind, so a grid is not one picture repeated", () => {
    const ids = Array.from({ length: 24 }, (_, i) => `w${1000 + i}`);
    for (const kind of ["estate", "hall", "conference"] as const) {
      const used = new Set(ids.map((id) => illustrativeFor(kind, id).src));
      expect(used.size).toBe(ILLUSTRATIVE_PHOTOS[kind].length);
      // Most consecutive pairs differ (two photos for conference means some repeats are expected).
      let differ = 0;
      for (let i = 1; i < ids.length; i++) if (illustrativeFor(kind, ids[i]).src !== illustrativeFor(kind, ids[i - 1]).src) differ++;
      expect(differ).toBeGreaterThanOrEqual(ids.length / 3);
    }
  });

  it("has nine illustrative photos, each credited and none of them a venue photo", () => {
    expect(ALL_ILLUSTRATIVE).toHaveLength(9);
    const venueSrcs = new Set(Object.values(VENUE_PHOTOS).map((p) => p.src));
    for (const photo of ALL_ILLUSTRATIVE) {
      expect(photo.src).toMatch(/^\/images\/illustrative\/(estate|hall|conference)-\d\.jpg$/);
      expect(venueSrcs.has(photo.src)).toBe(false);
      expect(photo.credit.author.trim()).not.toBe("");
      expect(photo.credit.sourceUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
  });
});

describe("illustrativeLayout, stock photos in a grid", () => {
  // 24 halls without a photo of their own, as on the first /directory page.
  const halls = Array.from({ length: 24 }, (_, i) => ({ id: `w${1000 + i * 7}`, kind: "hall" as const, hasOwn: false }));

  for (const columns of [1, 2, 3, 4, 5]) {
    it(`never repeats a photo beside or above a card with ${columns} column(s)`, () => {
      const out = illustrativeLayout(halls, columns);
      out.forEach((photo, i) => {
        expect(photo).toBeDefined();
        expect(ILLUSTRATIVE_PHOTOS.hall).toContain(photo);
        if (i % columns !== 0) expect(photo).not.toBe(out[i - 1]);
        if (i >= columns) expect(photo).not.toBe(out[i - columns]);
      });
      expect(new Set(out).size).toBe(ILLUSTRATIVE_PHOTOS.hall.length);
    });
  }

  it("leaves cards with their own photo alone and keeps each kind's photos", () => {
    const out = illustrativeLayout([{ id: "w43664624", kind: "conference", hasOwn: true }, { id: "w5", kind: "estate", hasOwn: false }], 4);
    expect(out[0]).toBeUndefined();
    expect(ILLUSTRATIVE_PHOTOS.estate).toContain(out[1]);
  });
});
