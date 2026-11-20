// Every photograph the site shows that is not ours, with what its licence asks us to
// state: title, author, licence and a link to the source. /credits lists this array,
// grouped: site photos (below), venue photos (venuePhotos.ts) and illustrative photos
// (illustrativePhotos.ts). The last two are built from their data files so they never drift.

import { ALL_ILLUSTRATIVE } from "./illustrativePhotos";
import { VENUE_PHOTOS, homeUseOf } from "./venuePhotos";

export type CreditGroup = "site" | "venue" | "illustrative";

export interface PhotoCredit {
  /** Path of the file as served, e.g. /images/photos/ballroom.jpg. */
  file: string;
  /** The title of the work on its source page. */
  title: string;
  author: string;
  licence: string;
  /** The licence deed. */
  licenceUrl: string;
  /** The page the photo was taken from. */
  sourceUrl: string;
  /** Where the site uses it, in a few words. */
  usedFor: string;
  /** The heading it sits under on /credits. */
  group: CreditGroup;
}

export const CREDIT_GROUPS: { key: CreditGroup; title: string }[] = [
  { key: "site", title: "Site photos" },
  { key: "venue", title: "Venue photos" },
  { key: "illustrative", title: "Illustrative photos" },
];

const CC_BY_SA_4 = "https://creativecommons.org/licenses/by-sa/4.0/";
const CC_BY_3 = "https://creativecommons.org/licenses/by/3.0/";
const CC_BY_SA_2 = "https://creativecommons.org/licenses/by-sa/2.0/";
const CC_BY_SA_3_AT = "https://creativecommons.org/licenses/by-sa/3.0/at/deed.en";

/** Files still served from /images/photos but no longer on any page (the home tiles now
    show real directory venues): credited all the same, and said so. */
const NOT_SHOWN = "Earlier home page photo, not shown on any page at present";

const SITE_PHOTOS: Omit<PhotoCredit, "group">[] = [
  {
    file: "/images/photos/hero-auditorium.jpg",
    title: "Lichtburg Essen, Kinosaal",
    author: "Tuxyso",
    licence: "CC BY-SA 4.0",
    licenceUrl: CC_BY_SA_4,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Lichtburg-Essen-Kinosaal-2025.jpg",
    usedFor: "Home page, top; background of the invitation page (/participant)",
  },
  {
    file: "/images/photos/palazzo-hall.jpg",
    title: "Palazzo Vecchio, grand hall",
    author: "Eusebius",
    licence: "CC BY 3.0",
    licenceUrl: CC_BY_3,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Palazzo_Vecchio_-_grand_hall.jpg",
    usedFor: "Home page, for organisers",
  },
  {
    file: "/images/photos/douro-quinta-2.jpg",
    title: "Quinta dos Murças, Rio Douro",
    author: "Vitor Oliveira",
    licence: "CC BY-SA 2.0",
    licenceUrl: CC_BY_SA_2,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Quinta_dos_Mur%C3%A7as_-_Rio_Douro_-_Portugal_(13951175356).jpg",
    usedFor: NOT_SHOWN,
  },
  {
    file: "/images/photos/ballroom.jpg",
    title: "Parkhotel Schönbrunn, Ballsaal",
    author: "P e z i",
    licence: "CC BY-SA 3.0 AT",
    licenceUrl: CC_BY_SA_3_AT,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Parkhotel_Schoenbrunn_Ballsaal_DSC_5115w.jpg",
    usedFor: NOT_SHOWN,
  },
  {
    file: "/images/photos/conference-room.jpg",
    title: "EBACE 2019, Le Grand-Saconnex",
    author: "Matti Blume",
    licence: "CC BY-SA 4.0",
    licenceUrl: CC_BY_SA_4,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:EBACE_2019,_Le_Grand-Saconnex_(EB190648).jpg",
    usedFor: NOT_SHOWN,
  },
  {
    file: "/images/photos/hero-ballroom.jpg",
    title: "Parkhotel Schönbrunn, Ballsaal",
    author: "P e z i",
    licence: "CC BY-SA 3.0 AT",
    licenceUrl: CC_BY_SA_3_AT,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Parkhotel_Schoenbrunn_Ballsaal_DSC_5115w.jpg",
    usedFor: "Home page, top (second photo)",
  },
  {
    file: "/images/photos/hero-square-brussels.jpg",
    title: "Square, Brussels Meeting Centre 3",
    author: "AGC Glass Europe",
    licence: "CC BY 2.0",
    licenceUrl: "https://creativecommons.org/licenses/by/2.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Square_-_Brussels_Meeting_Centre_3_-_Brussels,_Belgium.jpg",
    usedFor: "Home page, top (third photo)",
  },
];

const ALL: PhotoCredit[] = [
  ...SITE_PHOTOS.map((credit): PhotoCredit => ({ ...credit, group: "site" })),
  ...Object.entries(VENUE_PHOTOS).map(([id, photo]): PhotoCredit => {
    const home = homeUseOf(id);
    return { ...photo.credit, file: photo.src, usedFor: home ? `Venue photo: ${photo.name}; also on the ${home}` : `Venue photo: ${photo.name}`, group: "venue" };
  }),
  ...ALL_ILLUSTRATIVE.map(
    (photo): PhotoCredit => ({ ...photo.credit, file: photo.src, usedFor: `Illustrative photo (${photo.subject.toLowerCase()}) on directory cards of venues without their own photo`, group: "illustrative" }),
  ),
];

/** Every credit once per served file: site photos first, then venue photos, then illustrative ones. */
export const PHOTO_CREDITS: PhotoCredit[] = ALL.filter((credit, i) => ALL.findIndex((other) => other.file === credit.file) === i);
