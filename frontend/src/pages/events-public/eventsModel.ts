// The pure part of the public event pages: words and checks, no React, unit tested.
import type { EventType, VenueType } from "../../api/eventsPublic";
import type { WorkRole } from "../../api/account";

/** "Estrada da Pena 140, Sintra" -> "Sintra": the town people look for on a card. */
export function areaOf(address: string | null | undefined): string {
  if (!address) return "";
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

export function placesLeftText(places: number | null | undefined): string {
  if (places === null || places === undefined) return "";
  if (places <= 0) return "Full";
  return places === 1 ? "1 place left" : `${places} places left`;
}

export function capacityText(guests: number, tables: number): string {
  const people = `Up to ${guests} ${guests === 1 ? "guest" : "guests"}`;
  return tables > 0 ? `${people} at ${tables} ${tables === 1 ? "table" : "tables"}` : people;
}

/** The ?type= of the address bar, kept only when it is one of the server's types. */
export function eventTypeFrom(value: string | null, types: EventType[]): string | null {
  return value && types.some((type) => type.key === value) ? value : null;
}

export function venueTypeFrom(value: string | null): VenueType | null {
  return value === "hall" || value === "quinta" ? value : null;
}

const ROLE_LABELS: Record<WorkRole, string> = { owner: "Owner", staff: "Staff", organiser: "Organiser" };

export function workRoleLabel(role: WorkRole): string {
  return ROLE_LABELS[role];
}

/** "Fri 27 Nov 2026, 12:30" in the browser's time zone, 24-hour clock, as on the restaurant pages. */
export function shortDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/**
 * The kinds of venue the home page and /venues offer. Quintas and halls are the
 * server's venue types; conference rooms are any venue that hosts conferences
 * (?occasion=conference), so a ballroom that also takes talks counts as both.
 */
export type VenueKind = "quinta" | "hall" | "conference";

export const VENUE_KINDS: { key: VenueKind; label: string; blurb: string; query: Record<string, string> }[] = [
  { key: "quinta", label: "Quintas", blurb: "Country estates for weddings, christenings and long lunches.", query: { type: "quinta" } },
  { key: "hall", label: "Event halls", blurb: "Ballrooms and city halls for galas, dinners and parties.", query: { type: "hall" } },
  { key: "conference", label: "Conference rooms", blurb: "Auditoriums and workshop rooms for talks and training days.", query: { occasion: "conference" } },
];

interface KindVenue {
  venue_type: VenueType | null;
  event_types: string[];
}

export function matchesKind(venue: KindVenue, kind: VenueKind | null): boolean {
  if (kind === null) return true;
  if (kind === "conference") return venue.event_types.includes("conference");
  return venue.venue_type === kind;
}

/** The kind a /venues address asks for: ?occasion=conference wins over ?type=. */
export function kindFrom(type: string | null, occasion: string | null): VenueKind | null {
  if (occasion === "conference") return "conference";
  return venueTypeFrom(type);
}

/** ?guests= of the address bar: a whole number from 1 to 2000, anything else is ignored. */
export function guestsFrom(value: string | null): number | null {
  if (!value || !/^\d{1,4}$/.test(value)) return null;
  const guests = Number(value);
  return guests >= 1 && guests <= 2000 ? guests : null;
}

/** /venues with the same kind and guest count, so "See all" lands on the same list. */
export function venuesHref(kind: VenueKind | null, guests: number | null): string {
  const params = new URLSearchParams(kind ? VENUE_KINDS.find((k) => k.key === kind)?.query : undefined);
  if (guests) params.set("guests", String(guests));
  const query = params.toString();
  return query ? `/venues?${query}` : "/venues";
}
