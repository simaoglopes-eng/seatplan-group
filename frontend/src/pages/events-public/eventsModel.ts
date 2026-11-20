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
