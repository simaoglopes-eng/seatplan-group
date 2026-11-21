// Pure rules of the party booking ("Who is sitting where?"): one guest
// chooses several seats and names everyone on them, themselves first.
// Kept out of React so each rule can be read and tested on its own
// (__tests__/partyRules.test.ts). The server checks everything again
// (backend/app/events_service/party.py); these rules only stop a guest from
// sending what would be refused, and say why in plain words.
//
// A "card" is one person: the guest themselves (always the first card, key
// "me") or someone coming with them. The seats chosen on the map are the
// seats of the cards, so the selection and the cards can never disagree.
import type { MyPartySeatIn, PartyConfirmIn, PartyMemberIn, PartyView } from "../../api/events";
import type { MapSeat } from "../../api/types";

export const ME_KEY = "me";
/** Each half of a name (schemas.py, NamePart). */
export const NAME_MAX = 60;
/** guests.name is VARCHAR(120): first + space + last. */
export const FULL_NAME_MAX = 120;
export const AGE_MAX = 120;

export const FIRST_NAME_MISSING = "Enter a first name.";
export const LAST_NAME_MISSING = "Enter a last name.";
export const AGE_INVALID = "Enter an age from 0 to 120.";
export const NAME_TOO_LONG = `Use ${NAME_MAX} characters or fewer.`;
export const FULL_NAME_TOO_LONG = `Shorten the first or last name (${FULL_NAME_MAX} characters together at most).`;
export const NAME_INVISIBLE = "Use letters only, without line breaks, tabs or invisible characters.";

// The same rule as the server (backend/app/core/text.py, person_name_characters):
// no control characters (also tab and line breaks), line or paragraph
// separators, format characters (zero width spaces, direction marks and
// overrides) or "filler" characters that show nothing. The zero width
// non-joiner and joiner stay allowed: Persian and Indian names need them.
const FILLERS = "ᅟᅠㅤﾠ⠀";
const HIDDEN_IN_NAME = new RegExp(`(?![\\u200C\\u200D])[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}${FILLERS}]`, "u");
const LETTER = /\p{L}/u;

/** A name half: missing (no letter at all), or holding a character a name must not have. */
function nameProblem(text: string, missing: string): string | undefined {
  if (HIDDEN_IN_NAME.test(text)) return NAME_INVISIBLE;
  if (!LETTER.test(text)) return missing;
  if (text.length > NAME_MAX) return NAME_TOO_LONG;
  return undefined;
}

export interface PartyCard {
  /** "me" for the guest booking, "g1", "g2" ... for the people coming with them. */
  key: string;
  seatId: number | null;
  firstName: string;
  lastName: string;
  /** As typed: validated with parseAge before it is sent. */
  age: string;
  /** The seat cannot change here (adding people keeps the booker's own seat). */
  locked?: boolean;
}

export interface PersonErrors {
  firstName?: string;
  lastName?: string;
  age?: string;
}

/** "Ana Maria Silva" becomes Ana + Maria Silva: the first word, then the rest. */
export function splitName(name: string): { first: string; last: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return { first: words[0] ?? "", last: words.slice(1).join(" ") };
}

/** Whole years from 0 to 120 typed as digits only, or null. "7.5", "-1", "1e2" and "" are all null. */
export function parseAge(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const age = Number(trimmed);
  return age <= AGE_MAX ? age : null;
}

/**
 * The problems with one person's details, field by field. `ageOptional` is
 * true only for the booker when an age is already saved: an empty field then
 * keeps the saved age (the number itself is never shown back).
 */
export function validatePerson(card: PartyCard, ageOptional = false): PersonErrors {
  const errors: PersonErrors = {};
  const first = card.firstName.trim();
  const last = card.lastName.trim();
  const firstProblem = nameProblem(first, FIRST_NAME_MISSING);
  const lastProblem = nameProblem(last, LAST_NAME_MISSING);
  if (firstProblem) errors.firstName = firstProblem;
  if (lastProblem) errors.lastName = lastProblem;
  if (!errors.firstName && !errors.lastName && first.length + 1 + last.length > FULL_NAME_MAX) errors.lastName = FULL_NAME_TOO_LONG;
  const ageEmpty = card.age.trim() === "";
  if (!(ageEmpty && ageOptional) && parseAge(card.age) === null) errors.age = AGE_INVALID;
  return errors;
}

export function hasErrors(errors: PersonErrors): boolean {
  return Boolean(errors.firstName || errors.lastName || errors.age);
}

/** A card is ready when it has a seat and every detail is valid. */
export function cardComplete(card: PartyCard, ageOptional: boolean): boolean {
  return card.seatId !== null && !hasErrors(validatePerson(card, card.key === ME_KEY && ageOptional));
}

/** "2 of 3 people complete", read out next to the Confirm button. */
export function missingSummary(cards: PartyCard[], meAgeSaved: boolean): string {
  const done = cards.filter((card) => cardComplete(card, meAgeSaved)).length;
  const total = cards.length;
  if (total > 0 && done === total) return total === 1 ? "Your details are complete." : `All ${total} people are complete.`;
  return `${done} of ${total} ${total === 1 ? "person" : "people"} complete.`;
}

/** The seats chosen so far, in card order. */
export function selectedSeats(cards: PartyCard[]): number[] {
  return cards.map((card) => card.seatId).filter((id): id is number => id !== null);
}

/** True when a card holds nothing the guest typed (a fresh card can go away without loss). */
function isBlank(card: PartyCard): boolean {
  return !card.firstName.trim() && !card.lastName.trim() && !card.age.trim();
}

function nextKey(cards: PartyCard[]): string {
  const numbers = cards.map((card) => Number(card.key.slice(1))).filter((n) => Number.isInteger(n) && n > 0);
  return `g${numbers.length === 0 ? 1 : Math.max(...numbers) + 1}`;
}

export type ToggleResult = { cards: PartyCard[]; outcome: "added" | "removed" } | { cards: PartyCard[]; outcome: "full" };

/**
 * Tapping a seat on the map. A chosen seat is given back: its card keeps what
 * was typed, or goes away when it is an empty card of a companion. A new seat
 * goes to the first card without a seat (the booker first), otherwise to a
 * new card, unless the event has no place for one more person (`room` is how
 * many more people this guest may add; null means unknown).
 * `me` is the booker's card used when there is none yet.
 */
export function toggleSeat(cards: PartyCard[], seatId: number, me: PartyCard, room: number | null): ToggleResult {
  const holder = cards.find((card) => card.seatId === seatId);
  if (holder) {
    if (holder.locked) return { cards, outcome: "removed" };
    const next =
      holder.key !== ME_KEY && isBlank(holder)
        ? cards.filter((card) => card.key !== holder.key)
        : cards.map((card) => (card.key === holder.key ? { ...card, seatId: null } : card));
    return { cards: next, outcome: "removed" };
  }
  const withMe = cards.some((card) => card.key === ME_KEY) ? cards : [me, ...cards];
  const empty = withMe.find((card) => card.seatId === null && !card.locked);
  if (empty) return { cards: withMe.map((card) => (card.key === empty.key ? { ...card, seatId } : card)), outcome: "added" };
  const companions = withMe.filter((card) => card.key !== ME_KEY).length;
  if (room !== null && companions + 1 > room) return { cards: withMe, outcome: "full" };
  return { cards: [...withMe, { key: nextKey(withMe), seatId, firstName: "", lastName: "", age: "" }], outcome: "added" };
}

/** Gives a card a seat. If another card had that seat, the two swap. Locked cards never move. */
export function assignSeat(cards: PartyCard[], key: string, seatId: number | null): PartyCard[] {
  const card = cards.find((c) => c.key === key);
  if (!card || card.locked) return cards;
  const other = seatId === null ? undefined : cards.find((c) => c.key !== key && c.seatId === seatId);
  if (other?.locked) return cards;
  return cards.map((c) => {
    if (c.key === key) return { ...c, seatId };
    if (other && c.key === other.key) return { ...c, seatId: card.seatId };
    return c;
  });
}

export function updateCard(cards: PartyCard[], key: string, changes: Partial<Pick<PartyCard, "firstName" | "lastName" | "age">>): PartyCard[] {
  return cards.map((card) => (card.key === key ? { ...card, ...changes } : card));
}

/** Takes a companion out of the list; the booker's own card always stays. */
export function removeCard(cards: PartyCard[], key: string): PartyCard[] {
  return key === ME_KEY ? cards : cards.filter((card) => card.key !== key);
}

/**
 * Chosen seats that are gone on a fresh map: now someone else's, blocked, or
 * no longer in the room. "mine" is not a loss: it is this guest's own party.
 * A locked card's seat is the booker's own and is never counted.
 */
export function lostSeats(seats: MapSeat[], cards: PartyCard[]): number[] {
  const stateOf = new Map(seats.map((seat) => [seat.id, seat.state] as const));
  return cards
    .filter((card) => card.seatId !== null && !card.locked)
    .map((card) => card.seatId as number)
    .filter((id) => {
      const state = stateOf.get(id);
      return state === undefined || (state !== "free" && state !== "mine");
    });
}

/** Takes the given seats away from the cards; names and ages stay. */
export function dropSeats(cards: PartyCard[], seatIds: readonly number[]): PartyCard[] {
  const gone = new Set(seatIds);
  return cards.map((card) => (card.seatId !== null && gone.has(card.seatId) && !card.locked ? { ...card, seatId: null } : card));
}

/** The fixed label of a card: "You", then "Guest 1", "Guest 2" ... (the booker's card is index 0). */
export function cardLabel(card: PartyCard, index: number): string {
  return card.key === ME_KEY ? "You" : `Guest ${index}`;
}

/** Who a card is, in words: "you", or the companion's first name, or "Guest 1". */
export function cardName(card: PartyCard, index: number): string {
  if (card.key === ME_KEY) return "you";
  return card.firstName.trim() || cardLabel(card, index);
}

/**
 * The body of POST .../party/confirm, or null while a card is not complete.
 * Ages travel as numbers; the booker's empty age (with one saved) is left out.
 */
export function confirmBody(cards: PartyCard[], meAgeSaved: boolean): PartyConfirmIn | null {
  const me = cards.find((card) => card.key === ME_KEY);
  if (!me || !cards.every((card) => cardComplete(card, meAgeSaved))) return null;
  const myAge = parseAge(me.age);
  const meIn: MyPartySeatIn = { seat_id: me.seatId as number, first_name: me.firstName.trim(), last_name: me.lastName.trim() };
  if (myAge !== null) meIn.age = myAge;
  const members: PartyMemberIn[] = cards
    .filter((card) => card.key !== ME_KEY)
    .map((card) => ({ seat_id: card.seatId as number, first_name: card.firstName.trim(), last_name: card.lastName.trim(), age: parseAge(card.age) as number }));
  return { me: meIn, members };
}

/**
 * After an unclear refusal (a 409 without seat ids, for example a repeated
 * click after the first one worked): does the server already show exactly
 * this booking? Then it is a success, not an error.
 */
export function alreadyBooked(party: PartyView | undefined, cards: PartyCard[]): boolean {
  if (!party) return false;
  const me = cards.find((card) => card.key === ME_KEY);
  if (!me || me.seatId === null || party.me.seat_id !== me.seatId) return false;
  const same = (a: string | null, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();
  return cards
    .filter((card) => card.key !== ME_KEY)
    .every((card) =>
      party.members.some((m) => m.seat_id === card.seatId && same(m.first_name, card.firstName) && same(m.last_name, card.lastName)),
    );
}

/** A member's whole name as the booker typed it. */
export function memberName(member: { first_name: string | null; last_name: string | null }): string {
  return [member.first_name, member.last_name].filter(Boolean).join(" ") || "Guest";
}
