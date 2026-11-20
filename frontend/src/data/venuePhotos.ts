// Photographs of real directory venues, keyed by the listing id the API returns
// (n/w/r + OpenStreetMap id). Each one is the venue's own image on Wikidata (P18),
// taken from Wikimedia Commons under a free licence and credited on /credits.
// A venue without an entry here shows no photo: we never put a stock picture on a real place.

import type { PhotoCredit } from "./photoCredits";

export interface VenuePhoto {
  src: string;
  alt: string;
  credit: Omit<PhotoCredit, "file" | "usedFor">;
}

const CC_BY_SA_4 = "https://creativecommons.org/licenses/by-sa/4.0/";
const CC_BY_3 = "https://creativecommons.org/licenses/by/3.0/";
const CC_BY_2 = "https://creativecommons.org/licenses/by/2.0/";

export const VENUE_PHOTOS: Record<string, VenuePhoto> = {
  r5424595: {
    src: "/images/venues/relation-5424595.jpg",
    alt: "Palácio da Bolsa, Porto, seen from the square",
    credit: { title: "Palacio da Bolsa (Porto)", author: "Manuel de Sousa", licence: "Public domain", licenceUrl: "https://creativecommons.org/publicdomain/mark/1.0/", sourceUrl: "https://commons.wikimedia.org/wiki/File:Palacio_da_Bolsa_(Porto).JPG" },
  },
  r10794433: {
    src: "/images/venues/relation-10794433.jpg",
    alt: "Convento de São Francisco, Coimbra, the church front",
    credit: { title: "San Francisco Convent", author: "Mister No", licence: "CC BY 3.0", licenceUrl: CC_BY_3, sourceUrl: "https://commons.wikimedia.org/wiki/File:San_Francisco_Convent_-_panoramio.jpg" },
  },
  w142509065: {
    src: "/images/venues/way-142509065.jpg",
    alt: "Kasteel van Groenenberg, Gaasbeek, with daffodils in front",
    credit: { title: "Lennik, Gaasbeek, Groenenberg", author: "Johan Allard", licence: "CC BY-SA 4.0", licenceUrl: CC_BY_SA_4, sourceUrl: "https://commons.wikimedia.org/wiki/File:Lennik_-_Gaasbeek_-_Groenenberg_(2022-04-09_13-16-55)_04.jpg" },
  },
  w144502504: {
    src: "/images/venues/way-144502504.jpg",
    alt: "Square Brussels Convention Centre, the orange glass foyer",
    credit: { title: "Square, Brussels Meeting Centre 3", author: "AGC Glass Europe", licence: "CC BY 2.0", licenceUrl: CC_BY_2, sourceUrl: "https://commons.wikimedia.org/wiki/File:Square_-_Brussels_Meeting_Centre_3_-_Brussels,_Belgium.jpg" },
  },
  r10379191: {
    src: "/images/venues/relation-10379191.jpg",
    alt: "Villa Andrea Ponti, Varese, the main front",
    credit: { title: "Varese, Ville Ponti 0202", author: "Phyrexian", licence: "CC BY-SA 4.0", licenceUrl: CC_BY_SA_4, sourceUrl: "https://commons.wikimedia.org/wiki/File:Varese_-_Ville_Ponti_0202.JPG" },
  },
  w43664624: {
    src: "/images/venues/way-43664624.jpg",
    alt: "Roma Convention Center La Nuvola, the glass box in EUR",
    credit: { title: "Roma EUR nuovo centro congressi", author: "Blackcat", licence: "CC BY-SA 4.0", licenceUrl: CC_BY_SA_4, sourceUrl: "https://commons.wikimedia.org/wiki/File:Roma_EUR_nuovo_centro_congressi.jpg" },
  },
};

/** Venues shown on the home page, two per country, in this order. */
export const FEATURED_VENUES = ["r5424595", "w142509065", "r10379191", "r10794433", "w144502504", "w43664624"] as const;

export function venuePhoto(id: string): VenuePhoto | undefined {
  return VENUE_PHOTOS[id];
}
