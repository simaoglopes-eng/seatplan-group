// One person on "Who is sitting where?": first name, last name, age and the
// seat they get. A fieldset with a legend ("You · Table 1, seat 3"), so a
// screen reader says whose details each field belongs to. Errors sit under
// their field and are tied to it (Field, Select), never shown by colour alone.
import { useId } from "react";
import type { FocusEvent } from "react";
import { Button, Field, Select } from "../../design/components";
import type { SelectOption } from "../../design/components";
import { ME_KEY, NAME_MAX } from "./partyRules";
import type { PartyCard as Card, PersonErrors } from "./partyRules";

export type CardField = "firstName" | "lastName" | "age" | "seat";

interface PartyCardProps {
  card: Card;
  /** "You" or "Guest 1": the fixed name of this card. */
  label: string;
  seatLabel: string | null;
  /** The booker with an age already saved: an empty age keeps it. */
  ageSaved: boolean;
  /** Only the errors that should show now (after leaving a field, or after pressing Confirm). */
  errors: PersonErrors & { seat?: string };
  /** The seats chosen on the map; picking one used by another card swaps the two. */
  seatOptions: SelectOption[];
  onChange: (changes: Partial<Pick<Card, "firstName" | "lastName" | "age">>) => void;
  onSeat: (seatId: number | null) => void;
  onBlur: (field: CardField) => void;
  onRemove?: () => void;
}

export function PartyCard({ card, label, seatLabel, ageSaved, errors, seatOptions, onChange, onSeat, onBlur, onRemove }: PartyCardProps) {
  const id = useId();
  const isMe = card.key === ME_KEY;
  const blur = (field: CardField) => (_event: FocusEvent) => onBlur(field);
  return (
    <fieldset className="party-card" data-card={card.key}>
      <legend className="party-card-title">
        {label} · {seatLabel ?? "No seat yet"}
      </legend>
      <div className="party-card-fields">
        <Field
          id={`${id}-first`}
          label="First name"
          value={card.firstName}
          maxLength={NAME_MAX}
          autoComplete={isMe ? "given-name" : "off"}
          error={errors.firstName}
          onChange={(e) => onChange({ firstName: e.target.value })}
          onBlur={blur("firstName")}
        />
        <Field
          id={`${id}-last`}
          label="Last name"
          value={card.lastName}
          maxLength={NAME_MAX}
          autoComplete={isMe ? "family-name" : "off"}
          error={errors.lastName}
          onChange={(e) => onChange({ lastName: e.target.value })}
          onBlur={blur("lastName")}
        />
        <Field
          id={`${id}-age`}
          className="party-age"
          label="Age"
          hint={ageSaved ? "Saved. Leave empty to keep it." : "In years."}
          value={card.age}
          inputMode="numeric"
          maxLength={3}
          autoComplete="off"
          error={errors.age}
          onChange={(e) => onChange({ age: e.target.value })}
          onBlur={blur("age")}
        />
        {card.locked ? (
          <p className="party-card-fixed">Your seat stays {seatLabel ?? "as it is"}.</p>
        ) : (
          <Select
            id={`${id}-seat`}
            label="Seat"
            options={card.seatId === null ? [{ value: "", label: "No seat yet" }, ...seatOptions] : seatOptions}
            value={card.seatId === null ? "" : String(card.seatId)}
            error={errors.seat}
            onChange={(e) => onSeat(e.target.value === "" ? null : Number(e.target.value))}
            onBlur={blur("seat")}
          />
        )}
      </div>
      {onRemove && (
        // The spoken name starts with the visible words (WCAG 2.5.3, label in name).
        <Button variant="ghost" className="party-card-remove" aria-label={`Remove from your party: ${label}`} onClick={onRemove}>
          Remove from your party
        </Button>
      )}
    </fieldset>
  );
}
