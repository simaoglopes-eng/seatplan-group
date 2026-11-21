// Party rows in the organiser's guest list, as pure functions (tested in
// __tests__/GuestsParty.test.tsx). A party member (source "companion") is
// listed straight after the guest who booked their seat, one step indented.
// A member whose booker was deleted with "keep" has no booker in the list
// any more and stays a normal row, marked "Party member".
import type { OrganiserGuest } from "../../api/events";

export interface PartyRow {
  guest: OrganiserGuest;
  /** 1 for a party member shown under their booker, else 0. */
  depth: 0 | 1;
  /** The guest who booked this member's seat, when still in the list. */
  booker: OrganiserGuest | null;
  /** On a booker: the people they booked seats for. */
  members: OrganiserGuest[];
}

export function isPartyMember(guest: OrganiserGuest): boolean {
  return guest.source === "companion";
}

/** Every guest once, each booker followed by their members (in list order). */
export function partyOrder(guests: OrganiserGuest[]): PartyRow[] {
  const byId = new Map(guests.map((guest) => [guest.id, guest] as const));
  const membersOf = new Map<number, OrganiserGuest[]>();
  for (const guest of guests) {
    const bookerId = guest.booked_by_guest_id ?? null;
    if (bookerId === null || !byId.has(bookerId) || bookerId === guest.id) continue;
    membersOf.set(bookerId, [...(membersOf.get(bookerId) ?? []), guest]);
  }
  const placed = new Set<number>();
  const rows: PartyRow[] = [];
  for (const guest of guests) {
    if (placed.has(guest.id)) continue;
    const bookerId = guest.booked_by_guest_id ?? null;
    // Members with a booker in the list are written under that booker instead.
    if (bookerId !== null && byId.has(bookerId) && bookerId !== guest.id) continue;
    const members = membersOf.get(guest.id) ?? [];
    rows.push({ guest, depth: 0, booker: null, members });
    placed.add(guest.id);
    for (const member of members) {
      if (placed.has(member.id)) continue;
      rows.push({ guest: member, depth: 1, booker: guest, members: [] });
      placed.add(member.id);
    }
  }
  // A member whose booker is itself a member is not expected; never drop a row because of it.
  for (const guest of guests) {
    if (!placed.has(guest.id)) rows.push({ guest, depth: 0, booker: byId.get(guest.booked_by_guest_id ?? -1) ?? null, members: [] });
  }
  return rows;
}

/** "Bea Silva, Rui Silva" for the delete question. */
export function namesOf(guests: OrganiserGuest[]): string {
  return guests.map((guest) => guest.name).join(", ");
}
