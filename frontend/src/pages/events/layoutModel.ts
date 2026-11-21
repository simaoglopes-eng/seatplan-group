// Pure rules of the Layout tab (one-click room setups, docs/api.md "Event room
// layouts"): the preview drawn as a seat map, what each setup's capacity means
// for this event, and the words of the confirm step and of the result.
// No React here, so each rule is tested (__tests__/layoutModel.test.ts).
import { ApiError } from "../../api/client";
import type { EventLayouts, LayoutConfirmFacts, LayoutPreview } from "../../api/events";
import type { MapSeat, MapTable, MapZone, ZoneKind } from "../../api/types";

const ZONE_KINDS: readonly ZoneKind[] = ["general", "window", "terrace", "bar", "quiet", "vip", "accessible", "stage"];

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The preview carries only a zone's kind; the setup names its front zone (layout_presets.py). */
const FRONT_NAMES: Record<string, string> = { banquet: "Dance floor", u_shape: "Screen" };

function zoneName(kind: string, presetKey?: string): string {
  if (presetKey && FRONT_NAMES[presetKey]) return FRONT_NAMES[presetKey];
  return kind === "bar" ? "Bar" : "Stage";
}

/**
 * The preview as a seat map. It has no ids or labels, so tables and seats are
 * numbered in order; every seat is free, because nobody sits there yet. Step-free
 * seats keep their mark, so staff see how few a setup has.
 */
export function previewToMap(preview: LayoutPreview, presetKey?: string): { zones: MapZone[]; tables: MapTable[]; seats: MapSeat[] } {
  const zones = preview.zones.map((zone, index) => ({
    id: index + 1,
    name: zoneName(zone.kind, presetKey),
    kind: ZONE_KINDS.includes(zone.kind as ZoneKind) ? (zone.kind as ZoneKind) : "general",
    x: zone.x,
    y: zone.y,
    w: zone.w,
    h: zone.h,
  }));
  const tables: MapTable[] = [];
  const seats: MapSeat[] = [];
  preview.tables.forEach((table, index) => {
    const id = index + 1;
    tables.push({ id, label: String(id), shape: table.shape, x: table.x, y: table.y, w: table.w, h: table.h, rotation: table.rotation });
    table.seats.forEach((seat, n) => {
      seats.push({ id: seats.length + 1, table_id: id, label: String(n + 1), x: seat.x, y: seat.y, state: "free", accessible: seat.accessible === true, occupant: null });
    });
  });
  return { zones, tables, seats };
}

/** SVG transform for a table box: it turns around its own centre, as in the editor. */
export function thumbTransform(box: { x: number; y: number; w: number; h: number; rotation: number }): string | undefined {
  if (!box.rotation) return undefined;
  return `rotate(${box.rotation} ${box.x + box.w / 2} ${box.y + box.h / 2})`;
}

export interface CapacityFit {
  tone: "ok" | "short" | "none";
  text: string;
}

/** A setup's seats against the guests coming, in a few words for its card. */
export function capacityFit(capacity: number, guests: number): CapacityFit {
  if (capacity === 0) return { tone: "none", text: "Does not fit this room" };
  const base = `${plural(capacity, "seat")} for ${guests} coming`;
  if (capacity < guests) return { tone: "short", text: `${base}, ${guests - capacity} short` };
  return { tone: "ok", text: base };
}

/** The counts of a 409 `guests_seated` or 422 `not_enough_seats` (under `error.details`), else null. */
export function confirmFacts(error: unknown): LayoutConfirmFacts | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code !== "guests_seated" && error.code !== "not_enough_seats") return null;
  const facts = error.details?.details as Partial<LayoutConfirmFacts> | undefined;
  if (!facts || typeof facts.seated !== "number" || typeof facts.capacity !== "number" || typeof facts.guests !== "number") return null;
  const found: LayoutConfirmFacts = { seated: facts.seated, capacity: facts.capacity, guests: facts.guests };
  // Newer counts: kept only when the server sends them.
  for (const key of ["accessible_needed", "accessible_seats", "holding"] as const) {
    if (typeof facts[key] === "number") found[key] = facts[key];
  }
  return found;
}

/** What applying will do, one sentence per line, for the confirm dialog. */
export function confirmLines(label: string, facts: LayoutConfirmFacts): string[] {
  const { seated, capacity, guests } = facts;
  const lines: string[] = [];
  if (seated > 0) {
    lines.push(
      `${plural(seated, "guest")} already ${seated === 1 ? "has" : "have"} a seat. They will be re-seated automatically on the ${label} setup, keeping groups and friends together.`,
    );
  }
  if (capacity < seated) {
    const lost = seated - capacity;
    lines.push(`The ${label} setup has only ${plural(capacity, "seat")}, so ${plural(lost, "guest")} will lose their seat and be told by email.`);
  } else if (capacity < guests) {
    lines.push(`The ${label} setup has ${plural(capacity, "seat")} for ${guests} guests coming, so ${guests - capacity} will not get a seat.`);
  }
  // Needing a step-free seat is a hard rule for the re-seat: the setup's step-free seats are all such guests can get.
  const stepFree = facts.accessible_seats ?? 0;
  const short = (facts.accessible_needed ?? 0) - stepFree;
  if (seated > 0 && facts.accessible_seats !== undefined && short > 0) {
    const have = stepFree === 0 ? "No seat" : stepFree === 1 ? "Only 1 seat" : `Only ${stepFree} seats`;
    const who = short === 1 ? "1 guest who needs one" : `${short} guests who need one`;
    lines.push(`${have} in the ${label} setup ${stepFree === 1 || stepFree === 0 ? "is" : "are"} step-free, so at least ${who} will lose their seat and be told by email.`);
  }
  const holding = facts.holding ?? 0;
  if (holding > 0) {
    lines.push(`${holding === 1 ? "1 person" : `${holding} people`} choosing a seat right now will need to choose again on the new layout.`);
  }
  if (seated > 0) lines.push("Anyone whose seat changes gets the usual seat-change email.");
  return lines;
}

/** The result of an apply, for the toast, the live region and the tab. */
export function appliedMessage(label: string, reseated: number, unseated: number): string {
  const parts = [`${label} setup applied.`];
  if (reseated === 0 && unseated === 0) parts.push("Nobody had a seat yet.");
  if (reseated > 0) parts.push(`${plural(reseated, "guest")} re-seated.`);
  if (unseated > 0) parts.push(`${plural(unseated, "guest")} lost their seat and ${unseated === 1 ? "was" : "were"} told by email.`);
  return parts.join(" ");
}

/** The setup in use now, in a few words. */
export function currentLine(layouts: Pick<EventLayouts, "current" | "own_layout" | "capacity">, labels: Record<string, string>): string {
  const seats = plural(layouts.capacity, "seat");
  if (layouts.current !== "custom") return `${labels[layouts.current] ?? layouts.current} setup, ${seats}`;
  return layouts.own_layout ? `Your own layout, ${seats}` : `The venue's standard plan, ${seats}`;
}
