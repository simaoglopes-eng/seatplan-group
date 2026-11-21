// Pure helpers for the venue directory: address-bar values, words, links. Unit tested.
import type { DirectoryCountry, DirectoryKind, Listing } from "../../api/venueDirectory";

export const COUNTRIES: { key: DirectoryCountry; label: string }[] = [
  { key: "PT", label: "Portugal" },
  { key: "BE", label: "Belgium" },
  { key: "IT", label: "Italy" },
];

export const KINDS: { key: DirectoryKind; label: string; blurb: string }[] = [
  { key: "estate", label: "Quintas and estates", blurb: "Quintas, villas, castles and manor farms in the country." },
  { key: "hall", label: "Event halls", blurb: "Function rooms and halls for dinners, parties and receptions." },
  { key: "conference", label: "Conference centres", blurb: "Auditoriums and congress centres for talks and meetings." },
];

export function countryFrom(value: string | null): DirectoryCountry | null {
  return value === "PT" || value === "BE" || value === "IT" ? value : null;
}

export function kindFrom(value: string | null): DirectoryKind | null {
  return value === "estate" || value === "hall" || value === "conference" ? value : null;
}

export function directoryHref(country: DirectoryCountry | null, kind: DirectoryKind | null): string {
  const params = new URLSearchParams();
  if (country) params.set("country", country);
  if (kind) params.set("kind", kind);
  const query = params.toString();
  return query ? `/directory?${query}` : "/directory";
}

/** "Sintra, Portugal", or "Near Sintra, Portugal" when the town was inferred from the map. */
export function placeLine(listing: Pick<Listing, "city" | "city_inferred" | "country_label">): string {
  if (!listing.city) return listing.country_label;
  return `${listing.city_inferred ? "Near " : ""}${listing.city}, ${listing.country_label}`;
}

/** Where "Plan an event here" goes: the organiser space, which names the venue. */
export function planHref(listing: Pick<Listing, "id">): string {
  return `/organiser?at=${encodeURIComponent(listing.id)}`;
}

/** Only http(s) links are shown; anything else in the source is dropped. */
export function safeWebsite(url: string | null): string | null {
  return url && /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}
