// Public event pages (docs/api.md, "Events, public"): event types, upcoming listed
// events and the event venues (halls and quintas). No session is sent.
import { api } from "./client";
import type { PublicPhoto } from "./discovery";

export interface EventType {
  key: string;
  label: string;
}

export type VenueType = "hall" | "quinta";

export interface PublicEvent {
  public_id: string;
  name: string;
  event_type: string | null;
  event_type_label: string | null;
  starts_at: string;
  ends_at: string;
  venue: { name: string; slug: string; venue_type: VenueType | null; address: string; cover_url: string | null };
  places_left: number | null;
  /** "/j/<token>": the shared-link page, which handles the account and the seat. */
  join_path: string;
}

export interface EventVenueCard {
  slug: string;
  name: string;
  venue_type: VenueType | null;
  venue_type_label: string | null;
  description: string;
  address: string;
  lat: number | null;
  lng: number | null;
  cover_url: string | null;
  cover_alt: string | null;
  capacity: number;
  event_types: string[];
  upcoming_count: number;
}

export interface EventVenue {
  slug: string;
  name: string;
  venue_type: VenueType | null;
  venue_type_label: string | null;
  description: string;
  address: string;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  instagram: string | null;
  maps_url: string;
  timezone: string;
  photos: PublicPhoto[];
  capacity: number;
  tables: number;
  event_types: EventType[];
  upcoming: PublicEvent[];
}

export function getEventTypes(): Promise<EventType[]> {
  return api.get<EventType[]>("/event-types", "none");
}

export function getPublicEvents(query: { type?: string | null; venue?: string | null; limit?: number; offset?: number }): Promise<{ items: PublicEvent[]; total: number }> {
  const params = new URLSearchParams();
  if (query.type) params.set("type", query.type);
  if (query.venue) params.set("venue", query.venue);
  params.set("limit", String(query.limit ?? 20));
  params.set("offset", String(query.offset ?? 0));
  return api.get(`/public-events?${params.toString()}`, "none");
}

export function getEventVenues(type: VenueType | null): Promise<{ items: EventVenueCard[] }> {
  return api.get(`/event-venues${type ? `?type=${type}` : ""}`, "none");
}

export function getEventVenue(slug: string): Promise<EventVenue> {
  return api.get<EventVenue>(`/event-venues/${encodeURIComponent(slug)}`, "none");
}
