// "Who is sitting where?": the part of the seat step after Continue. One card
// per chosen seat, the guest's own first (filled in with what is known about
// them), then everyone coming with them. Confirm stays unavailable until every
// person has a first name, a last name and an age, and a seat; a summary next
// to it says how many people are complete. Pressing it early shows every
// missing field and moves the focus to the first one.
//
// Nothing here is sent until Confirm: useParty sends one request that books
// all seats or none. Going back to the map keeps everything typed.
import { useEffect, useId, useRef, useState } from "react";
import type { AttendeeView } from "../../api/events";
import { Button } from "../../design/components";
import { seatName } from "./format";
import { PartyCard } from "./PartyCard";
import type { CardField } from "./PartyCard";
import { ME_KEY, cardLabel, confirmBody, missingSummary, validatePerson } from "./partyRules";
import type { PartyCard as Card } from "./partyRules";
import { SeatNotice } from "./SeatNotice";
import { StepTitle } from "./StepTitle";
import { myAgeSaved } from "./useParty";
import type { AttendeeState } from "./useAttendee";
import "./party.css";

export const SEAT_MISSING = "Choose a seat on the map for this person.";

interface WhoSitsWhereProps {
  state: AttendeeState;
  view: AttendeeView;
}

export function WhoSitsWhere({ state, view }: WhoSitsWhereProps) {
  const { party, busy, notice, actions } = state;
  const { cards } = party;
  const { map } = view;
  const ageSaved = myAgeSaved(view);
  const sectionRef = useRef<HTMLElement>(null);
  const summaryId = useId();
  // A field shows its error once the guest has left it, or once they pressed Confirm.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);

  const name = (id: number) => seatName(id, map.seats, map.tables);
  const ready = confirmBody(cards, ageSaved) !== null;
  const count = cards.length;
  const confirmLabel = `Confirm ${count} ${count === 1 ? "seat" : "seats"}`;
  const seatOptions = cards
    .filter((card) => card.seatId !== null && !card.locked)
    .map((card) => ({ value: String(card.seatId), label: name(card.seatId as number) }));

  // After an early Confirm: put the focus on the first field that still needs something.
  useEffect(() => {
    if (focusRequest === 0) return;
    sectionRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);

  const visibleErrors = (card: Card) => {
    const all = { ...validatePerson(card, card.key === ME_KEY && ageSaved), seat: card.seatId === null ? SEAT_MISSING : undefined };
    const shown = (field: CardField) => showAll || touched.has(`${card.key}.${field}`);
    return {
      firstName: shown("firstName") ? all.firstName : undefined,
      lastName: shown("lastName") ? all.lastName : undefined,
      age: shown("age") ? all.age : undefined,
      seat: shown("seat") ? all.seat : undefined,
    };
  };

  const onConfirm = (): void => {
    if (busy === "party-confirm") return;
    if (!ready) {
      setShowAll(true);
      setFocusRequest((n) => n + 1);
      return;
    }
    void actions.confirm();
  };

  return (
    <section ref={sectionRef} className="ev-seat-step party-step" aria-labelledby="ev-who">
      <StepTitle id="ev-who" focusOnMount>
        Who is sitting where?
      </StepTitle>
      <p>Add a first name, a last name and an age for every seat, yours included. Then confirm all seats at once.</p>
      {notice && (
        <SeatNotice notice={notice} seats={map.seats} tables={map.tables} busy={false} onHold={actions.hold} onDismiss={actions.dismissNotice} />
      )}
      <p className="party-note">Other guests see names the way the organiser chose. Ages are only seen by the organiser.</p>
      <div className="party-cards">
        {cards.map((card, index) => {
          const label = cardLabel(card, index);
          return (
            <PartyCard
              key={card.key}
              card={card}
              label={label}
              seatLabel={card.seatId === null ? null : name(card.seatId)}
              ageSaved={card.key === ME_KEY && ageSaved}
              errors={visibleErrors(card)}
              seatOptions={seatOptions}
              onChange={(changes) => party.actions.editCard(card.key, changes)}
              onSeat={(seatId) => party.actions.assignSeat(card.key, seatId)}
              onBlur={(field) => setTouched((current) => new Set(current).add(`${card.key}.${field}`))}
              onRemove={card.key === ME_KEY ? undefined : () => party.actions.removeCard(card.key)}
            />
          );
        })}
      </div>
      <div className="party-footer" role="region" aria-label="Confirm your seats">
        <p id={summaryId} className="party-summary">
          {missingSummary(cards, ageSaved)}
        </p>
        <div className="party-footer-actions">
          <Button variant="secondary" onClick={party.actions.backToMap}>
            Back to the map
          </Button>
          <button
            type="button"
            className="btn btn-primary party-confirm"
            aria-disabled={!ready || busy === "party-confirm" ? true : undefined}
            aria-busy={busy === "party-confirm" || undefined}
            aria-describedby={summaryId}
            onClick={onConfirm}
          >
            {busy === "party-confirm" && <span className="btn-spinner" aria-hidden="true" />}
            <span className="btn-label">{confirmLabel}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
