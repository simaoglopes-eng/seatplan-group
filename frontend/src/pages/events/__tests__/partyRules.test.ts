// The pure rules of the party booking (partyRules.ts): names, ages, which card
// a tapped seat goes to, swaps, lost seats and the body sent to the server.
import { describe, expect, it } from "vitest";
import type { PartyView } from "../../../api/events";
import type { MapSeat, SeatState } from "../../../api/types";
import {
  AGE_INVALID,
  FIRST_NAME_MISSING,
  FULL_NAME_TOO_LONG,
  LAST_NAME_MISSING,
  ME_KEY,
  NAME_INVISIBLE,
  alreadyBooked,
  assignSeat,
  cardComplete,
  cardLabel,
  cardName,
  confirmBody,
  dropSeats,
  lostSeats,
  missingSummary,
  parseAge,
  removeCard,
  selectedSeats,
  splitName,
  toggleSeat,
  validatePerson,
} from "../partyRules";
import type { PartyCard } from "../partyRules";

const ME: PartyCard = { key: ME_KEY, seatId: null, firstName: "Ana", lastName: "Silva", age: "" };

function card(key: string, seatId: number | null, firstName = "", lastName = "", age = ""): PartyCard {
  return { key, seatId, firstName, lastName, age };
}

function seat(id: number, state: SeatState): MapSeat {
  return { id, table_id: 1, label: String(id), x: id, y: 0, state, accessible: false };
}

describe("names and ages", () => {
  it("splits a whole name into the first word and the rest", () => {
    expect(splitName("Ana Maria  Silva")).toEqual({ first: "Ana", last: "Maria Silva" });
    expect(splitName("  Prince ")).toEqual({ first: "Prince", last: "" });
    expect(splitName("")).toEqual({ first: "", last: "" });
  });

  it("accepts whole years from 0 to 120 and nothing else", () => {
    expect(parseAge("0")).toBe(0);
    expect(parseAge(" 7 ")).toBe(7);
    expect(parseAge("120")).toBe(120);
    for (const bad of ["", " ", "121", "-1", "7.5", "1e2", "seven", "0x10", "1000"]) expect(parseAge(bad)).toBeNull();
  });

  it("asks for a first name, a last name and an age, field by field", () => {
    expect(validatePerson(card("g1", 1))).toEqual({ firstName: FIRST_NAME_MISSING, lastName: LAST_NAME_MISSING, age: AGE_INVALID });
    expect(validatePerson(card("g1", 1, "   ", "\t", " "))).toEqual({ firstName: FIRST_NAME_MISSING, lastName: LAST_NAME_MISSING, age: AGE_INVALID });
    expect(validatePerson(card("g1", 1, "Bea", "Silva", "9"))).toEqual({});
    expect(validatePerson(card("g1", 1, "Bea", "Silva", "121")).age).toBe(AGE_INVALID);
  });

  it("refuses a whole name over 120 characters, as guests.name holds 120", () => {
    const sixty = "a".repeat(60);
    expect(validatePerson(card("g1", 1, sixty, sixty, "30")).lastName).toBe(FULL_NAME_TOO_LONG);
    expect(validatePerson(card("g1", 1, sixty, "b".repeat(59), "30"))).toEqual({});
    expect(validatePerson(card("g1", 1, "a".repeat(61), "b", "30")).firstName).toMatch(/60 characters/);
  });

  it("refuses names that show nothing, hide or reverse text, or break lines, as the server does", () => {
    const hidden = [0x200b, 0x2060, 0xfeff, 0x200e, 0x202e, 0x3164, 0x115f, 0xffa0, 0x2800].map((code) => String.fromCodePoint(code));
    for (const bad of hidden) {
      expect(validatePerson(card("g1", 1, bad, "Silva", "9")).firstName, `U+${bad.codePointAt(0)?.toString(16)}`).toBeTruthy();
      expect(validatePerson(card("g1", 1, "Bea", `Si${bad}lva`, "9")).lastName, `inside U+${bad.codePointAt(0)?.toString(16)}`).toBe(NAME_INVISIBLE);
    }
    expect(validatePerson(card("g1", 1, "Bea\nBcc", "Silva", "9")).firstName).toBe(NAME_INVISIBLE);
    expect(validatePerson(card("g1", 1, "Bea\tX", "Silva", "9")).firstName).toBe(NAME_INVISIBLE);
    expect(validatePerson(card("g1", 1, "--", "Silva", "9")).firstName).toBe(FIRST_NAME_MISSING);
    expect(validatePerson(card("g1", 1, String.fromCodePoint(0x3164), "Silva", "9")).firstName).toBe(NAME_INVISIBLE);
    // Real names in any script stay fine, also with the joiner Persian needs.
    const mahsa = String.fromCodePoint(0x645, 0x647, 0x200c, 0x633, 0x627);
    for (const [first, last] of [["Zoë", "O'Brien-Lee"], ["李", "华"], [mahsa, "Rezaei"], ["José", "da Silva"]]) {
      expect(validatePerson(card("g1", 1, first, last, "9")), first).toEqual({});
    }
  });

  it("lets only the booker with a saved age leave the age empty", () => {
    expect(validatePerson(card(ME_KEY, 1, "Ana", "Silva", ""), true)).toEqual({});
    expect(validatePerson(card(ME_KEY, 1, "Ana", "Silva", ""), false).age).toBe(AGE_INVALID);
    // A wrong number is still wrong, saved age or not.
    expect(validatePerson(card(ME_KEY, 1, "Ana", "Silva", "abc"), true).age).toBe(AGE_INVALID);
    expect(cardComplete(card(ME_KEY, 1, "Ana", "Silva", ""), true)).toBe(true);
    expect(cardComplete(card("g1", 2, "Bea", "Silva", ""), true)).toBe(false);
  });
});

describe("choosing seats", () => {
  it("gives the first seat to the booker, the next ones to new cards", () => {
    let result = toggleSeat([], 11, ME, null);
    expect(result.cards.map((c) => [c.key, c.seatId])).toEqual([[ME_KEY, 11]]);
    result = toggleSeat(result.cards, 12, ME, null);
    result = toggleSeat(result.cards, 13, ME, null);
    expect(result.cards.map((c) => [c.key, c.seatId])).toEqual([
      [ME_KEY, 11],
      ["g1", 12],
      ["g2", 13],
    ]);
    expect(selectedSeats(result.cards)).toEqual([11, 12, 13]);
  });

  it("gives a seat back: an empty companion card goes, a typed one keeps its name", () => {
    const cards = [card(ME_KEY, 11, "Ana", "Silva"), card("g1", 12), card("g2", 13, "Bea")];
    expect(toggleSeat(cards, 12, ME, null).cards.map((c) => c.key)).toEqual([ME_KEY, "g2"]);
    const kept = toggleSeat(cards, 13, ME, null).cards;
    expect(kept.find((c) => c.key === "g2")).toEqual({ ...cards[2], seatId: null });
    // The booker's card never goes away; it only loses the seat.
    expect(toggleSeat(cards, 11, ME, null).cards[0]).toEqual({ ...cards[0], seatId: null });
  });

  it("fills the first card without a seat before making a new one", () => {
    const cards = [card(ME_KEY, null, "Ana", "Silva"), card("g1", 12, "Bea")];
    expect(toggleSeat(cards, 14, ME, null).cards.map((c) => [c.key, c.seatId])).toEqual([
      [ME_KEY, 14],
      ["g1", 12],
    ]);
  });

  it("refuses a new person once the event has no place for them", () => {
    const one = toggleSeat([], 11, ME, 0);
    expect(one.outcome).toBe("added"); // the booker is already a guest: their own seat is fine
    expect(toggleSeat(one.cards, 12, ME, 0).outcome).toBe("full");
    const two = toggleSeat(one.cards, 12, ME, 1);
    expect(two.outcome).toBe("added");
    expect(toggleSeat(two.cards, 13, ME, 1)).toEqual({ cards: two.cards, outcome: "full" });
  });

  it("never moves the booker's locked seat while people are added", () => {
    const locked: PartyCard = { ...card(ME_KEY, 11, "Ana", "Silva"), locked: true };
    const added = toggleSeat([locked], 12, ME, null).cards;
    expect(added.map((c) => [c.key, c.seatId])).toEqual([
      [ME_KEY, 11],
      ["g1", 12],
    ]);
    expect(toggleSeat(added, 11, ME, null).cards).toBe(added);
    expect(assignSeat(added, "g1", 11)).toBe(added);
    expect(lostSeats([seat(11, "taken"), seat(12, "free")], added)).toEqual([]);
  });

  it("swaps two people when one takes the other's seat", () => {
    const cards = [card(ME_KEY, 11), card("g1", 12), card("g2", 13)];
    expect(assignSeat(cards, ME_KEY, 13).map((c) => c.seatId)).toEqual([13, 12, 11]);
    expect(assignSeat(cards, "g1", null).map((c) => c.seatId)).toEqual([11, null, 13]);
  });

  it("removes a companion card but never the booker's", () => {
    const cards = [card(ME_KEY, 11), card("g1", 12)];
    expect(removeCard(cards, "g1").map((c) => c.key)).toEqual([ME_KEY]);
    expect(removeCard(cards, ME_KEY)).toBe(cards);
  });

  it("names cards You, Guest 1, Guest 2, or by the first name typed", () => {
    const cards = [card(ME_KEY, 11), card("g1", 12), card("g2", 13, "Bea")];
    expect(cards.map((c, i) => cardLabel(c, i))).toEqual(["You", "Guest 1", "Guest 2"]);
    expect(cards.map((c, i) => cardName(c, i))).toEqual(["you", "Guest 1", "Bea"]);
  });
});

describe("seats that go", () => {
  it("counts a chosen seat as lost when it is someone's, blocked or gone; mine and free are fine", () => {
    const cards = [card(ME_KEY, 11), card("g1", 12), card("g2", 13), card("g3", 14), card("g4", 15), card("g5", 16)];
    const seats = [seat(11, "free"), seat(12, "taken"), seat(13, "friend"), seat(14, "blocked"), seat(15, "mine")];
    expect(lostSeats(seats, cards)).toEqual([12, 13, 14, 16]);
  });

  it("takes only the lost seats off the cards and keeps every name and age", () => {
    const cards = [card(ME_KEY, 11, "Ana", "Silva", "40"), card("g1", 12, "Bea", "Silva", "9")];
    expect(dropSeats(cards, [12])).toEqual([cards[0], { ...cards[1], seatId: null }]);
  });
});

describe("what is sent", () => {
  it("sends trimmed names, ages as numbers, and only new people as members", () => {
    const cards = [card(ME_KEY, 11, " Ana ", "Silva", "40"), card("g1", 12, "Bea", " Silva", "09")];
    expect(confirmBody(cards, false)).toEqual({
      me: { seat_id: 11, first_name: "Ana", last_name: "Silva", age: 40 },
      members: [{ seat_id: 12, first_name: "Bea", last_name: "Silva", age: 9 }],
    });
  });

  it("leaves the booker's age out when it is saved and the field is empty", () => {
    expect(confirmBody([card(ME_KEY, 11, "Ana", "Silva", "")], true)).toEqual({ me: { seat_id: 11, first_name: "Ana", last_name: "Silva" }, members: [] });
  });

  it("sends nothing while one person is incomplete or has no seat", () => {
    expect(confirmBody([card(ME_KEY, 11, "Ana", "Silva", "40"), card("g1", 12, "Bea", "", "9")], false)).toBeNull();
    expect(confirmBody([card(ME_KEY, 11, "Ana", "Silva", "40"), card("g1", null, "Bea", "Silva", "9")], false)).toBeNull();
    expect(confirmBody([card(ME_KEY, 11, "Ana", "Silva", "")], false)).toBeNull();
  });

  it("says how many people are complete", () => {
    const cards = [card(ME_KEY, 11, "Ana", "Silva", "40"), card("g1", 12, "Bea"), card("g2", 13)];
    expect(missingSummary(cards, false)).toBe("1 of 3 people complete.");
    expect(missingSummary([cards[0]], false)).toBe("Your details are complete.");
    expect(missingSummary([card(ME_KEY, 11)], false)).toBe("0 of 1 person complete.");
    expect(missingSummary([cards[0], card("g1", 12, "Bea", "Silva", "9")], false)).toBe("All 2 people are complete.");
  });

  it("recognises a booking the server already has (a repeated click after success)", () => {
    const party: PartyView = {
      me: { guest_id: 1, first_name: "Ana", last_name: "Silva", age_saved: true, seat_id: 11, details_complete: true },
      members: [{ id: 4, first_name: "Bea", last_name: "Silva", age_saved: true, seat_id: 12, rsvp: "yes" }],
      places_left: 3,
    };
    const cards = [card(ME_KEY, 11, "Ana", "Silva", "40"), card("g1", 12, "bea ", "silva", "9")];
    expect(alreadyBooked(party, cards)).toBe(true);
    expect(alreadyBooked(party, [cards[0], card("g1", 13, "Bea", "Silva", "9")])).toBe(false);
    expect(alreadyBooked({ ...party, me: { ...party.me, seat_id: 14 } }, cards)).toBe(false);
    expect(alreadyBooked(undefined, cards)).toBe(false);
  });
});
