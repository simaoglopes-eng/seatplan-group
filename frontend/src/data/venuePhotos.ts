// Photographs of real directory venues, keyed by the listing id the API returns
// (first letter of the OpenStreetMap type + id: node/1 -> n1, way/2 -> w2, relation/3 -> r3,
// see public_ref in backend/app/events_service/directory.py). Each one shows that venue,
// taken from Wikimedia Commons under a free licence and credited on /credits.
// A venue without an entry here gets an illustrative photo (illustrativePhotos.ts), always
// labelled "Illustrative photo" on the card: a stock picture is never presented as a real place.
// The six hand-written entries keep their own alt text and credit; the other 39 were generated
// from the vetted list (scratchpad keep.json, 2026-11-20).

import type { DirectoryCountry, DirectoryKind } from "../api/venueDirectory";
import type { PhotoCredit } from "./photoCredits";

export interface VenuePhoto {
  src: string;
  alt: string;
  /** The venue's name as the directory lists it. */
  name: string;
  /** The country in English ("Italy"), as the home page room tiles print it. */
  country: string;
  countryCode: DirectoryCountry;
  credit: Omit<PhotoCredit, "file" | "usedFor" | "group">;
}

const CC_BY_2 = "https://creativecommons.org/licenses/by/2.0/";
const CC_BY_2_5 = "https://creativecommons.org/licenses/by/2.5/";
const CC_BY_3 = "https://creativecommons.org/licenses/by/3.0/";
const CC_BY_4 = "https://creativecommons.org/licenses/by/4.0/";
const CC_BY_SA_3 = "https://creativecommons.org/licenses/by-sa/3.0/";
const CC_BY_SA_4 = "https://creativecommons.org/licenses/by-sa/4.0/";
const CC0 = "https://creativecommons.org/publicdomain/zero/1.0/";
const PD_MARK = "https://creativecommons.org/publicdomain/mark/1.0/";

const COUNTRY_NAME: Record<DirectoryCountry, string> = { PT: "Portugal", BE: "Belgium", IT: "Italy" };

function venue(src: string, name: string, country: DirectoryCountry, title: string, author: string, licence: string, licenceUrl: string, sourceUrl: string): VenuePhoto {
  return { src, alt: `${name}, ${COUNTRY_NAME[country]}`, name, country: COUNTRY_NAME[country], countryCode: country, credit: { title, author, licence, licenceUrl, sourceUrl } };
}

// Hand-written entries (alt text describes what the photo shows).
const HAND_r5424595: VenuePhoto = {
  src: "/images/venues/relation-5424595.jpg",
  alt: "Palácio da Bolsa, Porto, seen from the square",
  name: "Palácio da Bolsa",
  country: "Portugal",
  countryCode: "PT",
  credit: { title: "Palacio da Bolsa (Porto)", author: "Manuel de Sousa", licence: "Public domain", licenceUrl: PD_MARK, sourceUrl: "https://commons.wikimedia.org/wiki/File:Palacio_da_Bolsa_(Porto).JPG" },
};
const HAND_r10794433: VenuePhoto = {
  src: "/images/venues/relation-10794433.jpg",
  alt: "Convento de São Francisco, Coimbra, the church front",
  name: "Convento de São Francisco",
  country: "Portugal",
  countryCode: "PT",
  credit: { title: "San Francisco Convent", author: "Mister No", licence: "CC BY 3.0", licenceUrl: CC_BY_3, sourceUrl: "https://commons.wikimedia.org/wiki/File:San_Francisco_Convent_-_panoramio.jpg" },
};
const HAND_w142509065: VenuePhoto = {
  src: "/images/venues/way-142509065.jpg",
  alt: "Kasteel van Groenenberg, Gaasbeek, with daffodils in front",
  name: "Kasteel van Groenenberg",
  country: "Belgium",
  countryCode: "BE",
  credit: { title: "Lennik, Gaasbeek, Groenenberg", author: "Johan Allard", licence: "CC BY-SA 4.0", licenceUrl: CC_BY_SA_4, sourceUrl: "https://commons.wikimedia.org/wiki/File:Lennik_-_Gaasbeek_-_Groenenberg_(2022-04-09_13-16-55)_04.jpg" },
};
// The file on disk is the AGC Glass foyer photo (same as hero-square-brussels.jpg); keep.json
// lists another Commons file for this id, so this hand-written credit is the right one.
const HAND_w144502504: VenuePhoto = {
  src: "/images/venues/way-144502504.jpg",
  alt: "Square Brussels Convention Centre, the orange glass foyer",
  name: "Square Brussels Convention Centre",
  country: "Belgium",
  countryCode: "BE",
  credit: { title: "Square, Brussels Meeting Centre 3", author: "AGC Glass Europe", licence: "CC BY 2.0", licenceUrl: CC_BY_2, sourceUrl: "https://commons.wikimedia.org/wiki/File:Square_-_Brussels_Meeting_Centre_3_-_Brussels,_Belgium.jpg" },
};
const HAND_r10379191: VenuePhoto = {
  src: "/images/venues/relation-10379191.jpg",
  alt: "Villa Andrea Ponti, Varese, the main front",
  name: "Villa Andrea Ponti",
  country: "Italy",
  countryCode: "IT",
  credit: { title: "Varese, Ville Ponti 0202", author: "Phyrexian", licence: "CC BY-SA 4.0", licenceUrl: CC_BY_SA_4, sourceUrl: "https://commons.wikimedia.org/wiki/File:Varese_-_Ville_Ponti_0202.JPG" },
};
const HAND_w43664624: VenuePhoto = {
  src: "/images/venues/way-43664624.jpg",
  alt: "Roma Convention Center La Nuvola, the glass box in EUR",
  name: "Roma Convention Center La Nuvola",
  country: "Italy",
  countryCode: "IT",
  credit: { title: "Roma EUR nuovo centro congressi", author: "Blackcat", licence: "CC BY-SA 4.0", licenceUrl: CC_BY_SA_4, sourceUrl: "https://commons.wikimedia.org/wiki/File:Roma_EUR_nuovo_centro_congressi.jpg" },
};

export const VENUE_PHOTOS: Record<string, VenuePhoto> = {
  n3942508757: venue("/images/venues/node-3942508757.jpg", "Castello di Rossino", "IT", "Rossino вид на озеро Como", "Rostkol", "CC BY-SA 4.0", CC_BY_SA_4, "https://commons.wikimedia.org/wiki/File:Rossino_%D0%B2%D0%B8%D0%B4_%D0%BD%D0%B0_%D0%BE%D0%B7%D0%B5%D1%80%D0%BE_Como.jpg"),
  w212650231: venue("/images/venues/way-212650231.jpg", "Castello dei Solaro", "IT", "Villanova solaro castello", "Luigi.tuby", "CC BY-SA 3.0", CC_BY_SA_3, "https://commons.wikimedia.org/wiki/File:Villanova_solaro_castello.jpg"),
  w526568710: venue("/images/venues/way-526568710.jpg", "Villa Vittoria", "IT", "Villa Vittoria C", "Massimilianogalardi", "CC BY-SA 3.0", CC_BY_SA_3, "https://commons.wikimedia.org/wiki/File:Villa_Vittoria_C.jpg"),
  w542292860: venue("/images/venues/way-542292860.jpg", "Villa delle Ginestre", "IT", "Villa delle Ginestre, Torre del Greco, Napoli (2)", "Sergioizzo", "CC BY-SA 4.0", CC_BY_SA_4, "https://commons.wikimedia.org/wiki/File:Villa_delle_Ginestre,_Torre_del_Greco,_Napoli_(2).jpg"),
  w972835112: venue("/images/venues/way-972835112.jpg", "Terminal de Cruzeiros de Leixões", "PT", "Außenansicht (38287203275)", "Dennis Morhardt", "CC BY 2.0", CC_BY_2, "https://commons.wikimedia.org/wiki/File:Au%C3%9Fenansicht_(38287203275).jpg"),
  w23041580: venue("/images/venues/way-23041580.jpg", "Nekkerhal", "BE", "Nekkerhal - Mechelen 6-04-2019 17-41-41", "Paul Hermans", "CC BY-SA 4.0", CC_BY_SA_4, "https://commons.wikimedia.org/wiki/File:Nekkerhal_-_Mechelen_6-04-2019_17-41-41.jpg"),
  w23634249: venue("/images/venues/way-23634249.jpg", "AFAS Dome", "BE", "Sportpaleis 2011", "Ziyalistix", "CC BY-SA 3.0", CC_BY_SA_3, "https://commons.wikimedia.org/wiki/File:Sportpaleis_2011.jpg"),
  w30800728: venue("/images/venues/way-30800728.jpg", "Lotto Arena", "BE", "2013 3-cushion World Championship-Outdoor-01", "LezFraniak", "CC BY-SA 3.0", CC_BY_SA_3, "https://commons.wikimedia.org/wiki/File:2013_3-cushion_World_Championship-Outdoor-01.jpg"),
  w71286121: venue("/images/venues/way-71286121.jpg", "Concert Noble", "BE", "Belgique - Bruxelles - ABB - 02", "EmDee", "CC BY-SA 4.0", CC_BY_SA_4, "https://commons.wikimedia.org/wiki/File:Belgique_-_Bruxelles_-_ABB_-_02.jpg"),
  w111347385: venue("/images/venues/way-111347385.jpg", "Maison Vis-à-Vis", "BE", "Haus Trouet, Eynatten", "ArthurMcGill", "CC BY-SA 4.0", CC_BY_SA_4, "https://commons.wikimedia.org/wiki/File:Haus_Trouet,_Eynatten.jpg"),
  w225745453: venue("/images/venues/way-225745453.jpg", "Kasteelhoeve Dessener", "BE", "Dessener2", "Jos Punie", "CC BY-SA 3.0", CC_BY_SA_3, "https://commons.wikimedia.org/wiki/File:Dessener2.png"),
  w298902749: venue("/images/venues/way-298902749.jpg", "BEL", "BE", "Brussels Environnement building (1)", "Romaine", "CC0", CC0, "https://commons.wikimedia.org/wiki/File:Brussels_Environnement_building_(1).jpg"),
  w335297622: venue("/images/venues/way-335297622.jpg", "Sint-Jansbergklooster", "BE", "Kartuizerklooster Sint Jan", "Lagekempen", "CC BY-SA 3.0", CC_BY_SA_3, "https://commons.wikimedia.org/wiki/File:Kartuizerklooster_Sint_Jan.jpg"),
  w822859807: venue("/images/venues/way-822859807.jpg", "Trixxo Arena", "BE", "Ethias Arena", "DNLS Belgie", "CC BY-SA 4.0", CC_BY_SA_4, "https://commons.wikimedia.org/wiki/File:Ethias_Arena.jpg"),
  w1170999488: venue("/images/venues/way-1170999488.jpg", "Kasteeldomein Hof ter Linden", "BE", "Schilde Hof ter Linden 57-59 - toegangsbrug Hofdreef - 230093 - onroerenderfgoed", "De Haan, Aukje", "CC BY 4.0", CC_BY_4, "https://commons.wikimedia.org/wiki/File:Schilde_Hof_ter_Linden_57-59_-_toegangsbrug_Hofdreef_-_230093_-_onroerenderfgoed.jpg"),
  w93159180: venue("/images/venues/way-93159180.jpg", "Dogana Veneta", "IT", "Dogana Veneta (2)", "Andrea Bertozzi", "CC BY-SA 4.0", CC_BY_SA_4, "https://commons.wikimedia.org/wiki/File:Dogana_Veneta_(2).jpg"),
  w179246066: venue("/images/venues/way-179246066.jpg", "CityOval", "IT", "Ex Padiglione 3 della Fiera di Milano (1923), oggi parte di Citylife", "Paolobon140", "CC BY-SA 4.0", CC_BY_SA_4, "https://commons.wikimedia.org/wiki/File:Ex_Padiglione_3_della_Fiera_di_Milano_(1923),_oggi_parte_di_Citylife.jpg"),
  w203887978: venue("/images/venues/way-203887978.jpg", "Palazzo degli Esami", "IT", "Trastevere - palazzo esami O9280004", "Lalupa", "CC BY-SA 3.0", CC_BY_SA_3, "https://commons.wikimedia.org/wiki/File:Trastevere_-_palazzo_esami_O9280004.JPG"),
  w373638679: venue("/images/venues/way-373638679.jpg", "Auditorium \"Santa Caterina\"", "IT", "Orciano di Pesaro", "Accurimbono", "CC BY-SA 4.0", CC_BY_SA_4, "https://commons.wikimedia.org/wiki/File:Orciano_di_Pesaro.jpg"),
  w199575694: venue("/images/venues/way-199575694.jpg", "Europarque", "PT", "Europarque (Santa Maria da Feira)", "Portuguese eyes (Flickr user)", "CC BY 2.0", CC_BY_2, "https://commons.wikimedia.org/wiki/File:Europarque_(Santa_Maria_da_Feira).jpg"),
  r5424595: HAND_r5424595,
  r10794433: HAND_r10794433,
  w24714565: venue("/images/venues/way-24714565.jpg", "Aula Magna", "BE", "Belgique - Louvain-la-Neuve - Aula Magna - 04", "EmDee", "CC BY-SA 4.0", CC_BY_SA_4, "https://commons.wikimedia.org/wiki/File:Belgique_-_Louvain-la-Neuve_-_Aula_Magna_-_04.jpg"),
  w30962033: venue("/images/venues/way-30962033.jpg", "Palais des Congrès", "BE", "Palais des Congrès9", "CrucialFriend", "CC BY-SA 3.0", CC_BY_SA_3, "https://commons.wikimedia.org/wiki/File:Palais_des_Congr%C3%A8s9.JPG"),
  w83513754: venue("/images/venues/way-83513754.jpg", "Flanders Expo", "BE", "Gent - Flanders Expo 1", "LimoWreck", "CC BY-SA 3.0", CC_BY_SA_3, "https://commons.wikimedia.org/wiki/File:Gent_-_Flanders_Expo_1.jpg"),
  w142509065: HAND_w142509065,
  w144502504: HAND_w144502504,
  w172865902: venue("/images/venues/way-172865902.jpg", "Maaltebruggekasteel", "BE", "20111101 Maaltepark", "Donar Reiskoffer", "CC BY 3.0", CC_BY_3, "https://commons.wikimedia.org/wiki/File:20111101_Maaltepark.jpg"),
  w228640488: venue("/images/venues/way-228640488.jpg", "Hof ter Musschen", "BE", "Hof ter Musschen farm.03", "Nenea hartia", "CC BY-SA 4.0", CC_BY_SA_4, "https://commons.wikimedia.org/wiki/File:Hof_ter_Musschen_farm.03.jpg"),
  w244064803: venue("/images/venues/way-244064803.jpg", "Palais de la Dynastie - Dynastiepaleis", "BE", "Palace of the Dynasty, Brussels", "Silver Dovelet", "CC BY-SA 4.0", CC_BY_SA_4, "https://commons.wikimedia.org/wiki/File:Palace_of_the_Dynasty,_Brussels.jpg"),
  w244066615: venue("/images/venues/way-244066615.jpg", "Palais des Congrès - Paleis voor Congressen", "BE", "SQUARE - BRUSSELS MEETING CENTRE", "Palais des Congrès plc", "CC0", CC0, "https://commons.wikimedia.org/wiki/File:SQUARE_-_BRUSSELS_MEETING_CENTRE.jpg"),
  w323052910: venue("/images/venues/way-323052910.jpg", "Palais des Congrès de Mons", "BE", "MICXMons22", "Alession98", "CC BY-SA 4.0", CC_BY_SA_4, "https://commons.wikimedia.org/wiki/File:MICXMons22.jpg"),
  n1775450932: venue("/images/venues/node-1775450932.jpg", "Accademia degli Euteleti", "IT", "Accademia degli Euteleti", "Prof.Quatermass", "Public domain", PD_MARK, "https://commons.wikimedia.org/wiki/File:Accademia_degli_Euteleti.JPG"),
  n12384197877: venue("/images/venues/node-12384197877.jpg", "Auditorium San Rocco", "IT", "Piazza Garibaldi (Senigallia) 8", "Accurimbono", "CC BY-SA 4.0", CC_BY_SA_4, "https://commons.wikimedia.org/wiki/File:Piazza_Garibaldi_(Senigallia)_8.jpg"),
  w43664624: HAND_w43664624,
  w130807638: venue("/images/venues/way-130807638.jpg", "Santa Marta al Collegio Romano", "IT", "Santa Marta al Collegio romano (chiesa sconsacrata a Roma)", "Bargioni", "CC0", CC0, "https://commons.wikimedia.org/wiki/File:Santa_Marta_al_Collegio_romano_(chiesa_sconsacrata_a_Roma).jpg"),
  w149276886: venue("/images/venues/way-149276886.jpg", "Ex chiesa di Sant'Antonio da Padova", "IT", "Sant'antonio pavia", "FabioRomanoni", "CC BY-SA 4.0", CC_BY_SA_4, "https://commons.wikimedia.org/wiki/File:Sant%27antonio_pavia.jpg"),
  w180547721: venue("/images/venues/way-180547721.jpg", "Chiesa del Suffragio", "IT", "Chiesa del Suffragio (Lucca) 01", "sailko", "CC BY 2.5", CC_BY_2_5, "https://commons.wikimedia.org/wiki/File:Chiesa_del_Suffragio_(Lucca)_01.JPG"),
  w189250040: venue("/images/venues/way-189250040.jpg", "Stresa Convention Centre", "IT", "1030642710 STRESA palazzo congressi 5 ph Andrea Bertani", "Acquerel", "CC BY-SA 3.0", CC_BY_SA_3, "https://commons.wikimedia.org/wiki/File:1030642710_STRESA_palazzo_congressi_5_ph_Andrea_Bertani.jpg"),
  w200415692: venue("/images/venues/way-200415692.jpg", "Palacongressi di Rimini", "IT", "Palacongressi di Rimini La Conchiglia", "Unknown author (see source)", "CC BY-SA 3.0", CC_BY_SA_3, "https://commons.wikimedia.org/wiki/File:Palacongressi_di_Rimini_La_Conchiglia.jpg"),
  w288756708: venue("/images/venues/way-288756708.jpg", "Auditorium San Francesco al Prato", "IT", "09a.sfrancesco", "Demincob", "CC BY-SA 3.0", CC_BY_SA_3, "https://commons.wikimedia.org/wiki/File:09a.sfrancesco.JPG"),
  w368749943: venue("/images/venues/way-368749943.jpg", "Chiesa di San Romano", "IT", "Chiesa di san romano, lucca 01", "sailko", "CC BY 2.5", CC_BY_2_5, "https://commons.wikimedia.org/wiki/File:Chiesa_di_san_romano,_lucca_01.JPG"),
  w683664981: venue("/images/venues/way-683664981.jpg", "Vecchia parrocchiale di San Lino", "IT", "Lurano1", "Unknown author (see source)", "CC BY-SA 3.0", CC_BY_SA_3, "https://commons.wikimedia.org/wiki/File:Lurano1.JPG"),
  w705980267: venue("/images/venues/way-705980267.jpg", "Auditorium di San Martino", "IT", "San miniato, ex-san martino 02", "sailko", "CC BY-SA 3.0", CC_BY_SA_3, "https://commons.wikimedia.org/wiki/File:San_miniato,_ex-san_martino_02.JPG"),
  r10379191: HAND_r10379191,
};

/** The venue whose photo fills the top band of /directory (DirectoryPage.tsx); credited as such on /credits. */
export const DIRECTORY_BAND_VENUE = "w142509065";

/** Venues shown on the home page, two per country, in this order. */
export const FEATURED_VENUES = ["r5424595", "w142509065", "r10379191", "r10794433", "w144502504", "w43664624"] as const;

/**
 * The photos that cross-fade in the three room tiles of the home page (RoomSlides.tsx),
 * three listing ids per kind. Each must be a venue of that kind whose photo reads as one:
 * a gate in a park under "event halls" does not.
 */
export const HOME_TILE_VENUES: Record<DirectoryKind, readonly string[]> = {
  estate: ["w542292860", "n3942508757", "w212650231"],
  hall: ["w93159180", "w23041580", "w111347385"],
  conference: ["w43664624", "w200415692", "r5424595"],
};

/** Where on the home page a venue photo appears, for /credits; "" when it is not there. */
export function homeUseOf(id: string): string {
  const uses: string[] = [];
  const tile = (Object.keys(HOME_TILE_VENUES) as DirectoryKind[]).find((kind) => HOME_TILE_VENUES[kind].includes(id));
  if (tile) uses.push(`the ${TILE_NAME[tile]} tile`);
  if ((FEATURED_VENUES as readonly string[]).includes(id)) uses.push("“In the directory”");
  return uses.length > 0 ? `home page, ${uses.join(" and ")}` : "";
}

const TILE_NAME: Record<DirectoryKind, string> = { estate: "quintas and estates", hall: "event halls", conference: "conference centres" };

export function venuePhoto(id: string): VenuePhoto | undefined {
  return Object.prototype.hasOwnProperty.call(VENUE_PHOTOS, id) ? VENUE_PHOTOS[id] : undefined;
}
