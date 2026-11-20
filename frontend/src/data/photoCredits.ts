// Every photograph the site shows that is not ours, with what its licence asks us to
// state: title, author, licence and a link to the source. /credits lists this array.
// To add a photo (for example a venue photo), append one entry; the page needs no change.

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
}

const CC_BY_SA_4 = "https://creativecommons.org/licenses/by-sa/4.0/";
const CC_BY_3 = "https://creativecommons.org/licenses/by/3.0/";
const CC_BY_SA_2 = "https://creativecommons.org/licenses/by-sa/2.0/";
const CC_BY_SA_3_AT = "https://creativecommons.org/licenses/by-sa/3.0/at/deed.en";

export const PHOTO_CREDITS: PhotoCredit[] = [
  {
    file: "/images/photos/hero-auditorium.jpg",
    title: "Lichtburg Essen, Kinosaal",
    author: "Tuxyso",
    licence: "CC BY-SA 4.0",
    licenceUrl: CC_BY_SA_4,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Lichtburg-Essen-Kinosaal-2025.jpg",
    usedFor: "Home page, top",
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
    usedFor: "Home page, quintas and estates",
  },
  {
    file: "/images/photos/ballroom.jpg",
    title: "Parkhotel Schönbrunn, Ballsaal",
    author: "P e z i",
    licence: "CC BY-SA 3.0 AT",
    licenceUrl: CC_BY_SA_3_AT,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Parkhotel_Schoenbrunn_Ballsaal_DSC_5115w.jpg",
    usedFor: "Home page, event halls",
  },
  {
    file: "/images/photos/conference-room.jpg",
    title: "EBACE 2019, Le Grand-Saconnex",
    author: "Matti Blume",
    licence: "CC BY-SA 4.0",
    licenceUrl: CC_BY_SA_4,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:EBACE_2019,_Le_Grand-Saconnex_(EB190648).jpg",
    usedFor: "Home page, conference centres",
  },
];
