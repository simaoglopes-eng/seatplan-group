// Step 3: the seat map. Order on a phone, top to bottom: any notice, the
// recommendations, the map, the seat you are looking at, the seats chosen so
// far, the legend, your privacy switch, and a sticky bar with Continue.
//
// One seat is for the guest, more seats are for anyone coming with them
// (the party booking, useParty.ts). Continue leads to "Who is sitting
// where?" (WhoSitsWhere.tsx), where every person gets a name and an age.
// The same map also serves "Add people" (the guest's own seat stays) and
// "Move" (one seat for one person already in the party).
import { useMemo, useRef } from "react";
import type { AttendeeView, SeatRecommendation } from "../../api/events";
import { Button, Legend } from "../../design/components";
import { SeatMap } from "../../seatmap/SeatMap";
import { AnonymousSwitch } from "./AnonymousSwitch";
import { seatName } from "./format";
import { seatsNextToFriends } from "./friendSeats";
import { HoldBar } from "./HoldBar";
import { ME_KEY, cardLabel, memberName, partyLimitText, splitName } from "./partyRules";
import { RecommendationStrip } from "./RecommendationStrip";
import { SeatNotice } from "./SeatNotice";
import { StepTitle } from "./StepTitle";
import type { AttendeeState } from "./useAttendee";
import "./party.css";

interface SeatStepProps {
  state: AttendeeState;
  view: AttendeeView;
  moved: boolean;
}

export function SeatStep({ state, view, moved }: SeatStepProps) {
  const { map, me } = view;
  const { lookingAt, notice, busy, actions, party } = state;
  const mapRef = useRef<HTMLDivElement>(null);
  const nearFriends = useMemo(() => seatsNextToFriends(map.seats), [map.seats]);
  // The brass halo marks every seat worth a look: the optimiser's picks near people
  // you know, and free seats next to friends. A pick with no match is not "good" for you.
  const highlight = useMemo(() => {
    const matches = (state.recs ?? []).filter((r) => r.match !== "none").map((r) => r.seat_id);
    return new Set([...matches, ...nearFriends]);
  }, [state.recs, nearFriends]);
  const name = (id: number) => seatName(id, map.seats, map.tables);

  const moving = party.mode.kind === "move" ? (view.party?.members.find((m) => m.id === (party.mode as { memberId: number }).memberId) ?? null) : null;
  const chosen = useMemo(
    () => party.cards.filter((card) => card.seatId !== null && !card.locked),
    [party.cards],
  );
  // Memoised, so the map's seat layer keeps its memo between renders.
  const selectedIds = useMemo(() => {
    const ids = chosen.map((card) => card.seatId as number);
    if (party.moveSeat !== null) ids.push(party.moveSeat);
    return new Set(ids);
  }, [chosen, party.moveSeat]);
  // Free seats can be chosen, and a chosen seat can be tapped again to give it back.
  const selectable = useMemo(() => {
    const free = new Set(map.seats.filter((s) => s.state === "free").map((s) => s.id));
    return (id: number) => free.has(id) || selectedIds.has(id);
  }, [map.seats, selectedIds]);

  const showOnMap = (seatId: number): void => {
    actions.focusSeat(seatId);
    // Optional call: older browsers and the test DOM have no scrollIntoView.
    mapRef.current?.scrollIntoView?.({ block: "center" });
  };

  const title = moving
    ? `Choose a new seat for ${memberName(moving)}`
    : party.mode.kind === "add"
      ? "Add people to your party"
      : state.changingSeat
        ? "Choose a new seat"
        : "Choose your seat";
  const limit = partyLimitText(view.party);
  const intro = moving
    ? `Tap one free seat, then move ${memberName(moving)} there. Their current seat stays theirs until then.`
    : party.mode.kind === "add"
      ? ["Tap a free seat for each person coming with you. Your own seat stays as it is.", limit].filter(Boolean).join(" ")
      : ["Tap one seat for you, then more seats for anyone coming with you.", limit, "The first person to confirm gets the seat."].filter(Boolean).join(" ");
  const firstOf = (m: NonNullable<typeof moving>) => m.first_name ?? splitName(memberName(m)).first;

  return (
    <section className="ev-seat-step" aria-labelledby="ev-seat">
      <StepTitle id="ev-seat" focusOnMount={moved || party.phaseMoved}>
        {title}
      </StepTitle>
      <p>{intro}</p>
      {notice && (
        <SeatNotice notice={notice} seats={map.seats} tables={map.tables} busy={false} onHold={actions.hold} onDismiss={actions.dismissNotice} />
      )}
      {party.mode.kind !== "move" && (
        <>
          <h3 className="ev-subtitle">Recommended for you</h3>
          <RecommendationStrip recs={state.recs} failed={state.recsFailed} seats={map.seats} tables={map.tables} focusedId={lookingAt} onFocus={showOnMap} />
        </>
      )}
      <div className="ev-map-intro"><div><p className="ev-map-eyebrow">EXPLORE THE ROOM</p><h3>Find your place.</h3></div><p>Tap a free seat on the map to select it. Tap it again to give it back.</p></div>
      <div ref={mapRef} className="ev-map">
        <SeatMap
          label={`Seat map, ${view.event.name}`}
          zones={map.zones}
          tables={map.tables}
          seats={map.seats}
          selectedId={party.moveSeat ?? lookingAt}
          selectedIds={selectedIds}
          highlight={highlight}
          // Seats chosen here, also once confirmed, are never read out as someone else's.
          ownIds={selectedIds}
          // "Show on map" zooms in on the seat, so it is big enough to tap on a phone.
          focusId={lookingAt}
          selectable={selectable}
          onSelect={actions.hold}
        />
      </div>
      {lookingAt !== null && !selectedIds.has(lookingAt) && (
        <FocusedSeat label={name(lookingAt)} rec={state.recs?.find((r) => r.seat_id === lookingAt)} busy={false} onHold={() => actions.hold(lookingAt)} />
      )}
      {party.mode.kind !== "move" && chosen.length > 0 && (
        <div className="party-chosen">
          <h3 className="ev-subtitle">Seats you chose</h3>
          <ul className="party-chips" aria-label="Seats you chose">
            {chosen.map((card) => {
              const index = party.cards.indexOf(card);
              const who = card.key === ME_KEY ? "You" : card.firstName.trim() || cardLabel(card, index);
              const seat = name(card.seatId as number);
              return (
                <li key={card.key}>
                  {/* The spoken name starts with the visible words (WCAG 2.5.3, label in name). */}
                  <button type="button" className="party-chip" aria-label={`${who} · ${seat}: remove from your selection`} onClick={() => actions.hold(card.seatId as number)}>
                    <span>
                      <strong>{who}</strong> · {seat}
                    </span>
                    <svg viewBox="0 0 16 16" aria-hidden="true" className="party-chip-x">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {party.mode.kind !== "move" && <NearFriends ids={nearFriends} name={name} onShow={showOnMap} />}
      <h3 className="ev-subtitle">What the symbols mean</h3>
      <Legend states={["free", "friend", "held", "taken", "mine", "blocked"]} showAccessible showRecommended />
      {party.mode.kind === "book" && <AnonymousSwitch value={me.wants_anonymous} busy={busy === "privacy"} onChange={actions.setAnonymous} />}
      {(state.changingSeat || party.mode.kind !== "book") && (
        <Button variant="ghost" onClick={actions.cancelChange}>
          {moving ? `Keep ${firstOf(moving)}'s current seat` : party.mode.kind === "add" ? "Cancel adding people" : "Keep my current seat"}
        </Button>
      )}
      {moving && party.moveSeat !== null && (
        <HoldBar
          seatLabels={[name(party.moveSeat)]}
          busy={busy === `move-${moving.id}`}
          actionLabel={`Move ${firstOf(moving)} here`}
          onAction={() => void party.actions.moveMember()}
        />
      )}
      {!moving && chosen.length > 0 && (
        <HoldBar seatLabels={chosen.map((card) => name(card.seatId as number))} busy={false} actionLabel="Continue" onAction={party.actions.continueToDetails} />
      )}
    </section>
  );
}

interface FocusedSeatProps {
  label: string;
  rec: SeatRecommendation | undefined;
  busy: boolean;
  onHold: () => void;
}

/** The seat picked from the recommendations, with its reasons and a Select button. */
function FocusedSeat({ label, rec, busy, onHold }: FocusedSeatProps) {
  return (
    <div className="ev-focused" aria-live="polite">
      <p className="ev-focused-name">
        <strong>{label}</strong>
      </p>
      {rec && rec.reasons.length > 0 && <p className="ev-muted">{rec.reasons.join(". ")}.</p>}
      <Button busy={busy} onClick={onHold}>
        Select this seat
      </Button>
    </div>
  );
}

interface NearFriendsProps {
  ids: Set<number>;
  name: (id: number) => string;
  onShow: (id: number) => void;
}

/** Words, not only a halo: the free seats next to people you know, as buttons. */
function NearFriends({ ids, name, onShow }: NearFriendsProps) {
  if (ids.size === 0) return null;
  return (
    <div className="ev-near">
      <h3 className="ev-subtitle">Free next to someone you know</h3>
      <ul className="ev-chips">
        {Array.from(ids).map((id) => (
          <li key={id}>
            <button type="button" className="ev-chip" onClick={() => onShow(id)}>
              {name(id)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
