// The party booking's state and calls: the seats chosen on the map (one card
// per person, the guest first), the "Who is sitting where?" phase, and the
// "Your party" actions (edit, move, remove a person, add people, save my own
// details). useAttendee owns this hook and hands it what it needs, so every
// API call of the attendee page still starts in one place.
//
// Seats are first come, first served (no holds, design D1): one POST
// .../party/confirm writes everything or nothing. When it is refused because
// seats went, only those seats are taken off the cards; every name and age
// typed stays, and the guest picks new seats on the map.
//
// Ages are personal data, often of children: they live only in this state
// while the guest types, go to the server once, and are never put in a
// message, a toast, the URL or browser storage.
import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ApiError } from "../../api/client";
import type { AttendeeView, MyDetailsIn, PartyMember, PersonPatch, SeatRecommendation } from "../../api/events";
import type { useToast } from "../../design/components";
import type { AttendeeApi } from "./attendeeApi";
import { nextBest } from "./attendeeRules";
import {
  ME_KEY,
  alreadyBooked,
  assignSeat,
  cardName,
  confirmBody,
  dropSeats,
  lostSeats,
  memberName,
  removeCard,
  splitName,
  toggleSeat,
  updateCard,
} from "./partyRules";
import type { PartyCard } from "./partyRules";
import { asApiError } from "./useAttendeeData";
import type { Fresh } from "./useAttendeeData";

/** What the seat step is for: the guest's own booking, adding people, or moving one person. */
export type PartyMode = { kind: "book" } | { kind: "add" } | { kind: "move"; memberId: number };

/** On the map, or filling in "Who is sitting where?". */
export type PartyPhase = "map" | "details";

/** Notices the attendee page shows (SeatNotice); the party adds "lost" and "info". */
export type PartyNotice =
  | { kind: "conflict"; seatId: number; suggestion: SeatRecommendation | null }
  | { kind: "lost"; lines: string[] }
  | { kind: "problem"; message: string; title?: string };

export interface PartyDeps {
  attendeeApi: AttendeeApi;
  view: AttendeeView | null;
  fetchAll: () => Promise<Fresh>;
  setBusy: Dispatch<SetStateAction<string | null>>;
  setMessage: (message: string) => void;
  setNotice: (notice: PartyNotice | null) => void;
  setChangingSeat: (value: boolean) => void;
  setLookingAt: (seatId: number | null) => void;
  /** The attendee page's general error handling (deadline, broken link, any other problem). */
  handleError: (error: unknown) => Promise<void>;
  nameOf: (seatId: number) => string;
  toast: ReturnType<typeof useToast>;
}

/** The booker's card, filled with what the server already knows about them. */
export function myCard(view: AttendeeView, seatId: number | null, locked = false): PartyCard {
  const party = view.party?.me;
  const fallback = splitName(view.me.name);
  return {
    key: ME_KEY,
    seatId,
    firstName: party?.first_name ?? view.me.first_name ?? fallback.first,
    lastName: party?.last_name ?? view.me.last_name ?? fallback.last,
    age: "",
    locked,
  };
}

/** True when the booker already has an age saved, so their age field may stay empty. */
export function myAgeSaved(view: AttendeeView): boolean {
  return view.party?.me.age_saved ?? view.me.age_saved ?? false;
}

function seatIdsOf(error: ApiError): number[] | null {
  const facts = error.details?.details as { seat_ids?: unknown } | undefined;
  const ids = facts?.seat_ids;
  return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === "number") : null;
}

export function useParty(deps: PartyDeps) {
  const [mode, setMode] = useState<PartyMode>({ kind: "book" });
  const [phase, setPhase] = useState<PartyPhase>("map");
  const [cards, setCards] = useState<PartyCard[]>([]);
  // Move mode only: the one seat picked for the person being moved.
  const [moveSeat, setMoveSeat] = useState<number | null>(null);
  // True once the guest went from the map to the details or back: the new heading then takes focus.
  const [phaseMoved, setPhaseMoved] = useState(false);

  // Latest values for the live-update check, which runs outside React's render.
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const moveRef = useRef(moveSeat);
  moveRef.current = moveSeat;
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const { attendeeApi, fetchAll, setBusy, setMessage, setNotice, nameOf, toast } = deps;

  const reset = (): void => {
    setMode({ kind: "book" });
    setPhase("map");
    setCards([]);
    setMoveSeat(null);
  };

  const goToPhase = (next: PartyPhase): void => {
    setPhase(next);
    setPhaseMoved(true);
  };

  const membersOf = (view: AttendeeView | null): PartyMember[] => view?.party?.members ?? [];
  const memberById = (id: number): PartyMember | undefined => membersOf(depsRef.current.view).find((m) => m.id === id);

  /** "Table 1, seat 4 was just taken. Choose another seat for Bea." for each seat that went. */
  const lostLines = (current: PartyCard[], seatIds: readonly number[]): string[] =>
    current.flatMap((card, index) => {
      if (card.seatId === null || !seatIds.includes(card.seatId)) return [];
      return [`${nameOf(card.seatId)} was just taken. Choose another seat for ${cardName(card, index)}.`];
    });

  /**
   * Seats went: take them off the cards, say which, and go back to the map. Names and ages stay.
   * `sent` is the cards as they were when the guest pressed Confirm: a live update may already
   * have taken the seats off the cards meanwhile, and the message must still name each person.
   */
  const loseSeats = (seatIds: readonly number[], fresh: Fresh | null, why: "taken" | "room", sent: PartyCard[] = cardsRef.current): void => {
    const meCard = sent.find((card) => card.key === ME_KEY);
    const onlyMine = seatIds.length === 1 && meCard?.seatId === seatIds[0] && sent.filter((c) => c.seatId !== null).length === 1;
    const lines = lostLines(sent, seatIds);
    if (why === "room") {
      setNotice({ kind: "problem", title: "The room changed", message: "The room changed. Please choose your seats again." });
    } else if (onlyMine) {
      // Booking just one seat: the familiar message with the next best seat as a one-tap button.
      const seatId = seatIds[0];
      setNotice({ kind: "conflict", seatId, suggestion: fresh ? nextBest(fresh.recs, fresh.view.map.seats, seatId) : null });
    } else if (lines.length > 0) {
      setNotice({ kind: "lost", lines });
    }
    setCards(dropSeats(cardsRef.current, seatIds));
    goToPhase("map");
  };

  /** After a live update: did a chosen seat go meanwhile? Called by useAttendee. */
  const checkLive = ({ view, recs }: Fresh): void => {
    const lost = lostSeats(view.map.seats, cardsRef.current);
    if (lost.length > 0) loseSeats(lost, { view, recs }, "taken");
    const picked = moveRef.current;
    if (picked !== null) {
      const state = view.map.seats.find((seat) => seat.id === picked)?.state;
      if (state !== "free") {
        setMoveSeat(null);
        setNotice({ kind: "conflict", seatId: picked, suggestion: null });
      }
    }
  };

  /** Runs one party call with the shared busy flag; `onError` handles the party-only answers first. */
  const run = async (name: string, action: () => Promise<void>, onError?: (error: ApiError) => Promise<boolean>): Promise<boolean> => {
    setBusy(name);
    try {
      await action();
      return true;
    } catch (raw) {
      const error = asApiError(raw);
      const handled = onError ? await onError(error) : false;
      if (!handled) await depsRef.current.handleError(error);
      return false;
    } finally {
      setBusy(null);
    }
  };

  /** A person who is not (or no longer) in the party: fetch the truth and say so. */
  const goneMember = async (error: ApiError): Promise<boolean> => {
    if (error.code !== "not_found" || seatIdsOf(error) !== null) return false;
    setNotice({ kind: "problem", message: error.message });
    reset();
    await fetchAll().catch(() => null);
    return true;
  };

  const placesLeft = (): number | null => depsRef.current.view?.party?.places_left ?? null;

  const actions = {
    /** Tapping a seat on the map (or "Select this seat"): add it to the selection or give it back. */
    toggle: (seatId: number): void => {
      const view = depsRef.current.view;
      if (!view) return;
      setNotice(null);
      if (mode.kind === "move") {
        const next = moveRef.current === seatId ? null : seatId;
        setMoveSeat(next);
        depsRef.current.setLookingAt(next);
        const member = memberById(mode.memberId);
        setMessage(next === null ? `${nameOf(seatId)} is no longer selected.` : `${nameOf(seatId)} selected for ${member ? memberName(member) : "this person"}.`);
        return;
      }
      const locked = mode.kind === "add";
      const me = myCard(view, locked ? view.me.seat_id : null, locked);
      const result = toggleSeat(cardsRef.current, seatId, me, placesLeft());
      if (result.outcome === "full") {
        const room = placesLeft() ?? 0;
        setNotice({
          kind: "problem",
          title: "No more places",
          message:
            room === 0
              ? "This event has no place left for anyone else, so you can only choose your own seat."
              : `This event has room for ${room} more ${room === 1 ? "person" : "people"} besides you, so you cannot choose more seats.`,
        });
        setMessage(`${nameOf(seatId)} was not added: no more places.`);
        return;
      }
      setCards(result.cards);
      depsRef.current.setLookingAt(result.outcome === "added" ? seatId : null);
      if (result.outcome === "removed") {
        setMessage(`${nameOf(seatId)} is no longer selected.`);
        return;
      }
      const index = result.cards.findIndex((card) => card.seatId === seatId);
      const who = cardName(result.cards[index], index);
      setMessage(`${nameOf(seatId)} selected for ${who}. Confirm to claim it; it remains available until then.`);
    },

    /** From the map to "Who is sitting where?". */
    continueToDetails: (): void => {
      setNotice(null);
      goToPhase("details");
    },
    backToMap: (): void => goToPhase("map"),
    editCard: (key: string, changes: Partial<Pick<PartyCard, "firstName" | "lastName" | "age">>): void => setCards((current) => updateCard(current, key, changes)),
    assignSeat: (key: string, seatId: number | null): void => setCards((current) => assignSeat(current, key, seatId)),
    removeCard: (key: string): void => {
      setCards((current) => removeCard(current, key));
      setMessage("That person was taken off the list. Their seat is free for anyone again.");
    },

    /** Confirm every seat and person in one go. */
    confirm: (): Promise<void> => {
      const view = depsRef.current.view;
      const current = cardsRef.current;
      const body = view ? confirmBody(current, myAgeSaved(view)) : null;
      if (!body) return Promise.resolve();
      const count = current.length;
      const succeeded = (): void => {
        reset();
        setNotice(null);
        depsRef.current.setChangingSeat(false);
        depsRef.current.setLookingAt(null);
        const words = count === 1 ? `${nameOf(body.me.seat_id)} is now your seat.` : `${count} seats are confirmed for your party.`;
        setMessage(`Done. ${words}`);
        toast.show(count === 1 ? `${nameOf(body.me.seat_id)} is yours.` : `${count} seats are yours.`, "success");
      };
      return run(
        "party-confirm",
        async () => {
          await attendeeApi.partyConfirm(body);
          succeeded();
          await fetchAll().catch(() => null);
        },
        async (error) => {
          const ids = seatIdsOf(error);
          if (error.code === "seat_taken") {
            const fresh = await fetchAll().catch(() => null);
            // The fresh map decides: a seat that is now "mine" is not lost. The server
            // also names seats of this guest's own party, for example when a first
            // Confirm worked but its answer never arrived and the guest pressed again.
            // Only without a fresh map do the seats the server named count.
            const lost = fresh ? lostSeats(fresh.view.map.seats, current) : (ids ?? []);
            if (lost.length === 0 && fresh && alreadyBooked(fresh.view.party, current)) {
              succeeded();
              return true;
            }
            if (lost.length === 0) {
              setNotice({ kind: "problem", message: error.message });
              return true;
            }
            loseSeats(lost, fresh, "taken", current);
            return true;
          }
          if (error.code === "not_found" && ids !== null) {
            const fresh = await fetchAll().catch(() => null);
            const gone = fresh ? [...new Set([...ids, ...lostSeats(fresh.view.map.seats, current)])] : ids;
            loseSeats(gone, fresh, "room", current);
            return true;
          }
          if (error.code === "conflict" && ids !== null) {
            setCards(dropSeats(cardsRef.current, ids));
            setNotice({ kind: "problem", title: "Some seats cannot be booked", message: error.message });
            goToPhase("map");
            return true;
          }
          if (error.code === "event_full" || error.code === "validation") {
            setNotice({ kind: "problem", message: error.message });
            await fetchAll().catch(() => null);
            return true;
          }
          return false;
        },
      ).then(() => undefined);
    },

    /** "Add people": back to the map, the guest's own seat kept as it is. */
    startAdd: (): void => {
      const view = depsRef.current.view;
      if (!view || view.me.seat_id === null) return;
      setNotice(null);
      setMode({ kind: "add" });
      setPhase("map");
      setPhaseMoved(true);
      setCards([myCard(view, view.me.seat_id, true)]);
      setMessage("Choose a free seat for each person coming with you. Your own seat stays as it is.");
    },
    /** "Move": the map in one-seat mode for this person. */
    startMove: (memberId: number): void => {
      setNotice(null);
      setMode({ kind: "move", memberId });
      setPhase("map");
      setPhaseMoved(true);
      setMoveSeat(null);
      const member = memberById(memberId);
      setMessage(`Choose a new seat for ${member ? memberName(member) : "this person"}. They keep their current seat until you move them.`);
    },
    /** Leaves adding or moving (or a seat change) without any change. */
    cancel: (): void => {
      reset();
      depsRef.current.setChangingSeat(false);
      depsRef.current.setLookingAt(null);
      setNotice(null);
    },
    /** Starts a fresh selection, for "Change seat". */
    clearSelection: (): void => reset(),

    moveMember: (): Promise<boolean> => {
      if (mode.kind !== "move" || moveSeat === null) return Promise.resolve(false);
      const { memberId } = mode;
      const seatId = moveSeat;
      const member = memberById(memberId);
      const name = member ? memberName(member) : "This person";
      return run(
        `move-${memberId}`,
        async () => {
          await attendeeApi.partyMove(memberId, seatId);
          reset();
          depsRef.current.setLookingAt(null);
          setMessage(`Done. ${name} now sits at ${nameOf(seatId)}.`);
          toast.show(`${name} now sits at ${nameOf(seatId)}.`, "success");
          await fetchAll().catch(() => null);
        },
        async (error) => {
          if (await goneMember(error)) return true;
          if (error.code === "seat_taken" || (error.code === "not_found" && seatIdsOf(error) !== null)) {
            const fresh = await fetchAll().catch(() => null);
            setMoveSeat(null);
            setNotice({ kind: "conflict", seatId, suggestion: fresh ? nextBest(fresh.recs, fresh.view.map.seats, seatId) : null });
            return true;
          }
          if (error.code === "conflict") {
            setMoveSeat(null);
            setNotice({ kind: "problem", message: error.message });
            return true;
          }
          return false;
        },
      );
    },

    editMember: (memberId: number, patch: PersonPatch): Promise<boolean> =>
      run(
        `edit-${memberId}`,
        async () => {
          await attendeeApi.partyEdit(memberId, patch);
          setMessage("The changes were saved.");
          await fetchAll().catch(() => null);
        },
        async (error) => {
          if (await goneMember(error)) return true;
          if (error.code === "validation") {
            setNotice({ kind: "problem", message: error.message });
            return true;
          }
          return false;
        },
      ),

    removeMember: (memberId: number): Promise<boolean> => {
      const member = memberById(memberId);
      const name = member ? memberName(member) : "That person";
      return run(
        `remove-${memberId}`,
        async () => {
          await attendeeApi.partyRemove(memberId);
          setMessage(`${name} was removed from your party. Their seat is free again.`);
          toast.show(`${name} was removed from your party.`, "success");
          await fetchAll().catch(() => null);
        },
        goneMember,
      );
    },

    saveMyDetails: (body: MyDetailsIn): Promise<boolean> =>
      run(
        "party-me",
        async () => {
          await attendeeApi.partyMe(body);
          setMessage("Your details were saved.");
          await fetchAll().catch(() => null);
        },
        async (error) => {
          if (error.code === "validation") {
            setNotice({ kind: "problem", message: error.message });
            return true;
          }
          return false;
        },
      ),
  };

  return { mode, phase, cards, moveSeat, phaseMoved, checkLive, actions };
}

export type PartyState = ReturnType<typeof useParty>;
