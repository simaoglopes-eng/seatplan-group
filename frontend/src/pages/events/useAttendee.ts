// Everything the attendee can do, in one hook: choose seats, confirm, release,
// RSVP, "people I know", privacy, plus the seat being looked at and friendly
// notices when something goes wrong. Choosing several seats and naming
// everyone on them (the party booking) lives in useParty.ts, which this hook
// owns. The data itself (loading, live updates) comes from useAttendeeData.
//
// The page component only draws; every API call starts here.
import { useEffect, useRef, useState } from "react";
import type { SeatRecommendation } from "../../api/events";
import { useToast } from "../../design/components";
import type { AttendeeApi } from "./attendeeApi";
import { knowsSavedMessage, lostSeat, nextBest } from "./attendeeRules";
import { seatName } from "./format";
import { asApiError, useAttendeeData } from "./useAttendeeData";
import type { Fresh } from "./useAttendeeData";
import { useParty } from "./useParty";
import type { PartyState } from "./useParty";

export type Notice =
  | { kind: "conflict"; seatId: number; suggestion: SeatRecommendation | null }
  | { kind: "expired"; seatId: number }
  | { kind: "deadline" }
  | { kind: "problem"; message: string; title?: string }
  /** Several chosen seats went at once: one line per seat, naming who it was for. */
  | { kind: "lost"; lines: string[] };

/** `attendeeApi` must stay the same object between renders (pages build it with useMemo). */
export function useAttendee(attendeeApi: AttendeeApi) {
  const toast = useToast();
  const [lookingAt, setLookingAt] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [changingSeat, setChangingSeat] = useState(false);

  // Refs let the live callback read the newest values without reconnecting.
  const lookingRef = useRef(lookingAt);
  lookingRef.current = lookingAt;
  const partyRef = useRef<PartyState | null>(null);

  /** After a live update: say so if a seat I chose, or the one I am looking at, was just taken. */
  const checkForLoss = (fresh: Fresh): void => {
    const { view, recs } = fresh;
    const chosen = new Set((partyRef.current?.cards ?? []).map((card) => card.seatId));
    // A seat I chose is the party's business (useParty.checkLive); here only the one I look at.
    const looking = lookingRef.current !== null && chosen.has(lookingRef.current) ? null : lookingRef.current;
    const lost = lostSeat(view.map.seats, null, looking);
    if (lost !== null) {
      setLookingAt(null);
      setNotice({ kind: "conflict", seatId: lost, suggestion: nextBest(recs, view.map.seats, lost) });
    }
    partyRef.current?.checkLive(fresh);
  };

  const { load, setLoad, recs, recsFailed, fetchAll, firstLoad } = useAttendeeData(attendeeApi, checkForLoss);

  useEffect(() => { void firstLoad(); }, [firstLoad]);

  const nameOf = (seatId: number): string =>
    load.status === "ready" ? seatName(seatId, load.view.map.seats, load.view.map.tables) : "this seat";

  /** Turns an API error into the right friendly notice. */
  const handleError = async (error: unknown, seatId: number | null): Promise<void> => {
    const apiError = asApiError(error);
    if (apiError.code === "not_found") {
      setLoad({ status: "error", error: apiError });
      return;
    }
    if (apiError.code === "seat_taken" && seatId !== null) {
      const fresh = await fetchAll().catch(() => null);
      setLookingAt(null);
      setNotice({ kind: "conflict", seatId, suggestion: fresh ? nextBest(fresh.recs, fresh.view.map.seats, seatId) : null });
      return;
    }
    if (apiError.code === "hold_expired" && seatId !== null) {
      setNotice({ kind: "expired", seatId });
      return;
    }
    if (apiError.code === "deadline_passed") {
      setNotice({ kind: "deadline" });
      await fetchAll().catch(() => null);
      return;
    }
    setNotice({ kind: "problem", message: apiError.message });
  };

  /** Runs one action with a busy flag, so buttons show a spinner and cannot double-submit. */
  const run = async (name: string, seatId: number | null, action: () => Promise<void>): Promise<void> => {
    setBusy(name);
    try {
      await action();
    } catch (error) {
      await handleError(error, seatId);
    } finally {
      setBusy(null);
    }
  };

  const party = useParty({
    attendeeApi,
    view: load.status === "ready" ? load.view : null,
    fetchAll,
    setBusy,
    setMessage,
    setNotice,
    setChangingSeat,
    setLookingAt,
    handleError: (error) => handleError(error, null),
    nameOf,
    toast,
  });
  partyRef.current = party;

  const actions = {
    retry: firstLoad,
    dismissNotice: () => setNotice(null),
    focusSeat: (seatId: number) => {
      setLookingAt(seatId);
      setNotice(null);
      setMessage(`Showing ${nameOf(seatId)} on the map.`);
    },
    startChange: () => {
      party.actions.clearSelection();
      setNotice(null);
      setChangingSeat(true);
      setMessage("Choose a new seat. You keep your current seat until you confirm another one.");
    },
    /** Leaves a seat change, adding people or moving someone: nothing changes. */
    cancelChange: () => party.actions.cancel(),
    rsvp: (answer: "yes" | "no") =>
      run("rsvp", null, async () => {
        await attendeeApi.rsvp(answer);
        setMessage(answer === "yes" ? "Thank you, we have noted that you are coming." : "Thank you, we have noted that you cannot come.");
        await fetchAll();
      }),
    saveKnows: (ids: number[], onDone: () => void) =>
      run("knows", null, async () => {
        if (ids.length > 0) await attendeeApi.knows(ids);
        onDone();
        // Read the fresh list first: the message depends on whether these people have seats.
        const fresh = await fetchAll();
        setMessage(knowsSavedMessage(ids, fresh.view.people));
      }),
    /** Tapping a seat: adds it to the seats chosen (or gives it back). Nothing is sent yet. */
    hold: (seatId: number) => party.actions.toggle(seatId),
    /** Sends every chosen seat and person in one go (POST .../party/confirm). */
    confirm: () => party.actions.confirm(),
    release: () =>
      run("release", null, async () => {
        await attendeeApi.release();
        setChangingSeat(false);
        setMessage("Your seat is free again. You can choose a new one at any time before the deadline.");
        await fetchAll();
      }),
    saveNameProfile: (firstName: string, lastName: string) =>
      run("name", null, async () => {
        await attendeeApi.nameProfile(firstName, lastName);
        setMessage("Your name was saved.");
        await fetchAll();
      }),
    saveAgeProfile: (birthDate: string | null, shareAge: boolean) =>
      run("age", null, async () => {
        await attendeeApi.ageProfile(birthDate, shareAge);
        setMessage("Your age preferences were saved.");
        await fetchAll();
      }),
    setAnonymous: (value: boolean) =>
      run("privacy", null, async () => {
        await attendeeApi.privacy(value);
        setMessage(value ? "Other guests now see you as Guest." : "Other guests can see your name again.");
        await fetchAll();
      }),
  };

  return { load, recs, recsFailed, lookingAt, notice, busy, message, changingSeat, party, actions };
}

export type AttendeeState = ReturnType<typeof useAttendee>;
