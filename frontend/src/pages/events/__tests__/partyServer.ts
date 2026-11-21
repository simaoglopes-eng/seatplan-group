// A stateful fake of the attendee backend with the party routes, for the
// party booking tests. It copies what backend/app/events_service/party.py
// answers: all or nothing, a PartyView back, member seats shown as "mine" on
// the booker's map, never an age number. It serves either door: the personal
// link (/a/tok) or a guest account (/guest/events/ev1).
import type { AttendeeView, PartyConfirmIn, PartyView, PersonPatch } from "../../../api/events";
import type { MapSeat, SeatState } from "../../../api/types";
import { errorReply, startFakeServer } from "./mockServer";
import type { FakeServer } from "./mockServer";

export const LINK = "/a/tok";
export const ACCOUNT = "/guest/events/ev1";

export function seat(id: number, state: SeatState, occupant: string | null = null): MapSeat {
  return { id, table_id: 1, label: String(id - 10), x: 40 * (id - 10), y: 50, state, accessible: false, occupant };
}

/** Ana (guest 1) has replied yes and has no seat. Seats 11 to 16 at table 1; 12 is Maya's. */
export function partyView(): AttendeeView {
  return {
    venue: { name: "Quinta da Luz" },
    event: {
      public_id: "spring",
      name: "Spring Gala",
      starts_at: "2027-03-14T19:30:00Z",
      ends_at: "2027-03-14T23:30:00Z",
      privacy_mode: "first_initial",
      change_deadline: null,
      deadline_passed: false,
      live_scope: "event-spring",
    },
    me: {
      id: 1,
      name: "Ana Silva",
      shown_to_others_as: "Ana S.",
      rsvp: "yes",
      wants_anonymous: false,
      needs_accessible: false,
      seat_id: null,
      held_seat_id: null,
      held_until: null,
      knows: [2],
      age_saved: false,
      details_complete: false,
    },
    map: {
      width: 300,
      height: 120,
      zones: [],
      tables: [{ id: 1, label: "1", shape: "rect", x: 20, y: 30, w: 260, h: 40, rotation: 0 }],
      seats: [seat(11, "free"), seat(12, "friend", "Maya R."), seat(13, "free"), seat(14, "free"), seat(15, "free"), seat(16, "free")],
    },
    people: [{ id: 2, name: "Maya R.", seat_id: 12, known: true }],
    party: {
      me: { guest_id: 1, first_name: null, last_name: null, age_saved: false, seat_id: null, details_complete: false },
      members: [],
      places_left: 4,
      max_party_size: 8,
      party_size_left: 7,
    },
  };
}

export interface PartyBackend {
  server: FakeServer;
  view: AttendeeView;
  /** Ages the server received, by guest id: the page never gets them back. */
  ages: Map<number, number>;
}

function setSeat(view: AttendeeView, id: number, state: SeatState, extra: Partial<MapSeat> = {}): void {
  view.map.seats = view.map.seats.map((s) => (s.id === id ? { ...s, state, ...extra } : s));
}

function party(view: AttendeeView): PartyView {
  return view.party as PartyView;
}

/** Installs the fake at `prefix`, with the given view (default: partyView()). */
export function partyBackend(prefix = LINK, view: AttendeeView = partyView()): PartyBackend {
  const server = startFakeServer();
  const ages = new Map<number, number>();
  let nextId = 100;
  const answer = () => ({ body: party(view) });
  const occupied = (id: number) => view.map.seats.find((s) => s.id === id)?.state !== "free";

  server.routes.set(`GET ${prefix}`, () => ({ body: view }));
  server.routes.set(`GET ${prefix}/recommendations`, () => ({ body: [] }));
  server.routes.set(`GET ${prefix}/party`, answer);
  server.routes.set(`POST ${prefix}/party/confirm`, (raw) => {
    const body = raw as PartyConfirmIn;
    const mine = view.me.seat_id;
    const wanted = [body.me.seat_id, ...body.members.map((m) => m.seat_id)];
    const taken = wanted.filter((id) => id !== mine && occupied(id));
    if (taken.length > 0) return errorReply(409, "seat_taken", "Those seats were just taken.", { seat_ids: taken });
    if (body.members.length > party(view).places_left) {
      return errorReply(409, "event_full", `Only ${party(view).places_left} more people can join this event.`, { places_left: party(view).places_left });
    }
    if (mine !== null && mine !== body.me.seat_id) setSeat(view, mine, "free", { occupant: null });
    setSeat(view, body.me.seat_id, "mine", { occupant: "You" });
    view.me.seat_id = body.me.seat_id;
    if (body.me.age !== undefined) ages.set(1, body.me.age);
    Object.assign(party(view).me, {
      first_name: body.me.first_name,
      last_name: body.me.last_name,
      seat_id: body.me.seat_id,
      age_saved: ages.has(1),
      details_complete: ages.has(1),
    });
    for (const m of body.members) {
      const id = nextId++;
      ages.set(id, m.age);
      party(view).members.push({ id, first_name: m.first_name, last_name: m.last_name, age_saved: true, seat_id: m.seat_id, rsvp: "yes" });
      setSeat(view, m.seat_id, "mine", { occupant: `${m.first_name} ${m.last_name}`, party_member_id: id });
    }
    party(view).places_left -= body.members.length;
    if (party(view).party_size_left !== null) party(view).party_size_left = (party(view).party_size_left as number) - body.members.length;
    return answer();
  });
  server.routes.set(`POST ${prefix}/party/me`, (raw) => {
    const body = raw as { first_name: string; last_name: string; age?: number };
    if (body.age !== undefined) ages.set(1, body.age);
    Object.assign(party(view).me, { first_name: body.first_name, last_name: body.last_name, age_saved: ages.has(1), details_complete: ages.has(1) });
    return answer();
  });
  // Member routes are added per id by `memberRoutes` once members exist.
  return { server, view, ages };
}

/** PATCH, PUT seat and DELETE for one member id, as the backend answers them. */
export function memberRoutes(backend: PartyBackend, prefix: string, memberId: number): void {
  const { server, view, ages } = backend;
  const member = () => party(view).members.find((m) => m.id === memberId);
  server.routes.set(`PATCH ${prefix}/party/${memberId}`, (raw) => {
    const patch = raw as PersonPatch;
    const m = member();
    if (!m) return errorReply(404, "not_found", "This person is not in your party.");
    if (patch.first_name !== undefined) m.first_name = patch.first_name;
    if (patch.last_name !== undefined) m.last_name = patch.last_name;
    if (patch.age !== undefined) ages.set(memberId, patch.age);
    return { body: party(view) };
  });
  server.routes.set(`PUT ${prefix}/party/${memberId}/seat`, (raw) => {
    const seatId = (raw as { seat_id: number }).seat_id;
    const m = member();
    if (!m) return errorReply(404, "not_found", "This person is not in your party.");
    if (view.map.seats.find((s) => s.id === seatId)?.state !== "free") return errorReply(409, "seat_taken", "That seat was just taken.", { seat_ids: [seatId] });
    if (m.seat_id !== null) setSeat(view, m.seat_id, "free", { occupant: null, party_member_id: undefined });
    setSeat(view, seatId, "mine", { occupant: `${m.first_name} ${m.last_name}`, party_member_id: m.id });
    m.seat_id = seatId;
    return { body: party(view) };
  });
  server.routes.set(`DELETE ${prefix}/party/${memberId}`, () => {
    const m = member();
    if (!m) return errorReply(404, "not_found", "This person is not in your party.");
    if (m.seat_id !== null) setSeat(view, m.seat_id, "free", { occupant: null, party_member_id: undefined });
    party(view).members = party(view).members.filter((x) => x.id !== memberId);
    party(view).places_left += 1;
    if (party(view).party_size_left !== null) party(view).party_size_left = (party(view).party_size_left as number) + 1;
    ages.delete(memberId);
    return { body: party(view) };
  });
}

/** A view where Ana already sits at 11 with Bea (id 4) at 13; ages saved. */
export function bookedView(): AttendeeView {
  const view = partyView();
  view.me.seat_id = 11;
  view.me.age_saved = true;
  view.me.details_complete = true;
  view.map.seats = [seat(11, "mine", "You"), seat(12, "friend", "Maya R."), { ...seat(13, "mine", "Bea Silva"), party_member_id: 4 }, seat(14, "free"), seat(15, "free"), seat(16, "free")];
  view.party = {
    me: { guest_id: 1, first_name: "Ana", last_name: "Silva", age_saved: true, seat_id: 11, details_complete: true },
    members: [{ id: 4, first_name: "Bea", last_name: "Silva", age_saved: true, seat_id: 13, rsvp: "yes" }],
    places_left: 3,
    max_party_size: 8,
    party_size_left: 6,
  };
  return view;
}
