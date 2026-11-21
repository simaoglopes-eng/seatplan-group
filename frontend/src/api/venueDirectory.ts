// The public directory of real venues in Portugal, Belgium and Italy (OpenStreetMap
// data, docs: backend/app/events_service/directory.py). No session is sent.
import { api } from "./client";

export type DirectoryCountry = "PT" | "BE" | "IT";
export type DirectoryKind = "estate" | "hall" | "conference";

export interface Listing {
  id: string;
  name: string;
  kind: DirectoryKind;
  kind_label: string;
  country: DirectoryCountry;
  country_label: string;
  city: string | null;
  /** True when the city is the nearest named place, not part of the address. */
  city_inferred: boolean;
  street: string | null;
  postcode: string | null;
  lat: number;
  lng: number;
  website: string | null;
  source_url: string;
}

export interface DirectoryCounts {
  items: { country: DirectoryCountry; kind: DirectoryKind; count: number }[];
  countries: { key: DirectoryCountry; label: string }[];
  kinds: { key: DirectoryKind; label: string }[];
  attribution: string;
}

export function getDirectory(query: { country?: DirectoryCountry | null; kind?: DirectoryKind | null; q?: string; limit?: number; offset?: number }): Promise<{ items: Listing[]; total: number; attribution: string }> {
  const params = new URLSearchParams();
  if (query.country) params.set("country", query.country);
  if (query.kind) params.set("kind", query.kind);
  if (query.q) params.set("q", query.q);
  params.set("limit", String(query.limit ?? 24));
  params.set("offset", String(query.offset ?? 0));
  return api.get(`/venue-directory?${params.toString()}`, "none");
}

export function getDirectoryCounts(): Promise<DirectoryCounts> {
  return api.get("/venue-directory/counts", "none");
}

export function getListing(id: string): Promise<Listing> {
  return api.get(`/venue-directory/${encodeURIComponent(id)}`, "none");
}
