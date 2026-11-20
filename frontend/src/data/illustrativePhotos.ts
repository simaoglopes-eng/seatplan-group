// Stock photographs of kinds of room, for directory venues that have no photo of their own.
// They never show the listed venue, so every card that uses one carries the visible label
// "Illustrative photo" (ListingCard.tsx). Credited on /credits under "Illustrative photos".

import type { DirectoryKind } from "../api/venueDirectory";
import type { PhotoCredit } from "./photoCredits";

export interface IllustrativePhoto {
  src: string;
  /** What the photo shows, for /credits (the card's img keeps alt=""). */
  subject: string;
  credit: Omit<PhotoCredit, "file" | "usedFor" | "group">;
}

const CC_BY_SA_2 = "https://creativecommons.org/licenses/by-sa/2.0/";
const CC_BY_SA_3_AT = "https://creativecommons.org/licenses/by-sa/3.0/at/deed.en";
const CC_BY_SA_4 = "https://creativecommons.org/licenses/by-sa/4.0/";
const CC0 = "https://creativecommons.org/publicdomain/zero/1.0/";

export const ILLUSTRATIVE_PHOTOS: Record<DirectoryKind, IllustrativePhoto[]> = {
  estate: [
    {
      src: "/images/illustrative/estate-1.jpg",
      subject: "A quinta above the Douro",
      credit: { title: "Quinta Dona Matilde, Vale do Rio Douro, Portugal (14928976369)", author: "Vitor Oliveira", licence: "CC BY-SA 2.0", licenceUrl: CC_BY_SA_2, sourceUrl: "https://commons.wikimedia.org/wiki/File:Quinta_Dona_Matilde_-_Vale_do_Rio_Douro_-_Portugal_(14928976369).jpg" },
    },
    {
      src: "/images/illustrative/estate-2.jpg",
      subject: "A wine estate in Tuscany",
      credit: { title: "Tenuta PERANO - FRESCOBALDI Gaiole in Chianti", author: "Sarasara82", licence: "CC BY-SA 4.0", licenceUrl: CC_BY_SA_4, sourceUrl: "https://commons.wikimedia.org/wiki/File:Tenuta_PERANO_-_FRESCOBALDI_Gaiole_in_Chianti.jpg" },
    },
    {
      src: "/images/illustrative/estate-3.jpg",
      subject: "A herdade in the Alentejo",
      credit: { title: "Herdade do Esporão, Portugal (52723399056)", author: "Vitor Oliveira", licence: "CC BY-SA 2.0", licenceUrl: CC_BY_SA_2, sourceUrl: "https://commons.wikimedia.org/wiki/File:Herdade_do_Espor%C3%A3o_-_Portugal_(52723399056).jpg" },
    },
    {
      src: "/images/illustrative/estate-4.jpg",
      subject: "A wine cellar",
      credit: { title: "Herdade do Esporão, Portugal (52551691871)", author: "Vitor Oliveira", licence: "CC BY-SA 2.0", licenceUrl: CC_BY_SA_2, sourceUrl: "https://commons.wikimedia.org/wiki/File:Herdade_do_Espor%C3%A3o_-_Portugal_(52551691871).jpg" },
    },
  ],
  hall: [
    {
      src: "/images/illustrative/hall-1.jpg",
      subject: "A ballroom",
      credit: { title: "Parkhotel Schönbrunn, Ballsaal", author: "P e z i", licence: "CC BY-SA 3.0 AT", licenceUrl: CC_BY_SA_3_AT, sourceUrl: "https://commons.wikimedia.org/wiki/File:Parkhotel_Schoenbrunn_Ballsaal_DSC_5115w.jpg" },
    },
    {
      src: "/images/illustrative/hall-2.jpg",
      subject: "Tables set for a wedding",
      credit: { title: "Wedding reception tables and benches (Unsplash)", author: "Sweet Ice Cream Photography", licence: "CC0", licenceUrl: CC0, sourceUrl: "https://commons.wikimedia.org/wiki/File:Wedding_reception_tables_and_benches_(Unsplash).jpg" },
    },
    {
      src: "/images/illustrative/hall-3.jpg",
      subject: "A table with flowers",
      credit: { title: "Legant table setting with white floral centerpiece", author: "Bhullargraphic", licence: "CC BY-SA 4.0", licenceUrl: CC_BY_SA_4, sourceUrl: "https://commons.wikimedia.org/wiki/File:Legant_table_setting_with_white_floral_centerpiece.jpg" },
    },
  ],
  conference: [
    {
      src: "/images/illustrative/conference-1.jpg",
      subject: "A conference room",
      credit: { title: "EBACE 2019, Le Grand-Saconnex (EB190648)", author: "Matti Blume", licence: "CC BY-SA 4.0", licenceUrl: CC_BY_SA_4, sourceUrl: "https://commons.wikimedia.org/wiki/File:EBACE_2019,_Le_Grand-Saconnex_(EB190648).jpg" },
    },
    {
      src: "/images/illustrative/conference-2.jpg",
      subject: "An auditorium",
      credit: { title: "Lichtburg Essen, Kinosaal", author: "Tuxyso", licence: "CC BY-SA 4.0", licenceUrl: CC_BY_SA_4, sourceUrl: "https://commons.wikimedia.org/wiki/File:Lichtburg-Essen-Kinosaal-2025.jpg" },
    },
  ],
};

/** Every illustrative photo, in kind order. */
export const ALL_ILLUSTRATIVE: IllustrativePhoto[] = [...ILLUSTRATIVE_PHOTOS.estate, ...ILLUSTRATIVE_PHOTOS.hall, ...ILLUSTRATIVE_PHOTOS.conference];

/** FNV-1a (32 bit): mixes well, so listing ids that differ by one digit land apart. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The illustrative photo for a venue of this kind: always the same one for the same id. */
export function illustrativeFor(kind: DirectoryKind, id: string): IllustrativePhoto {
  const list = ILLUSTRATIVE_PHOTOS[kind] ?? ILLUSTRATIVE_PHOTOS.hall;
  return list[hash(id) % list.length];
}

/**
 * Illustrative photos for a whole grid of cards, in display order. Each card starts from
 * its own illustrativeFor() pick, but never repeats the photo of the card to its left
 * (same row) or of the card above it (`columns` back), so the few stock photos of a kind
 * do not sit side by side. Cards with a photo of their own (`hasOwn`) get undefined and
 * block nothing. With at least three photos per kind both neighbours can always be avoided.
 */
export function illustrativeLayout(cards: readonly { id: string; kind: DirectoryKind; hasOwn: boolean }[], columns: number): (IllustrativePhoto | undefined)[] {
  const cols = Math.max(1, Math.floor(columns) || 1);
  const out: (IllustrativePhoto | undefined)[] = [];
  cards.forEach((card, i) => {
    if (card.hasOwn) {
      out.push(undefined);
      return;
    }
    const list = ILLUSTRATIVE_PHOTOS[card.kind] ?? ILLUSTRATIVE_PHOTOS.hall;
    const left = i % cols !== 0 ? out[i - 1] : undefined;
    const above = i >= cols ? out[i - cols] : undefined;
    const start = hash(card.id) % list.length;
    let pick = list[start];
    for (let step = 0; step < list.length; step++) {
      const candidate = list[(start + step) % list.length];
      if (candidate !== left && candidate !== above) {
        pick = candidate;
        break;
      }
    }
    out.push(pick);
  });
  return out;
}
