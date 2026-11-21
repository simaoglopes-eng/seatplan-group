// "Your party" on the Done step: the people this guest booked seats for, with
// Edit (names and age), Move (another seat) and Remove (name and age deleted,
// seat freed), plus "Add people". When the guest's own details are not
// complete yet (a seat chosen before party booking existed, or placed by the
// organiser), "Add your details" asks for them first.
//
// Ages are write-only here: the page only ever knows whether one is saved.
import { useState } from "react";
import type { AttendeeView, PartyMember, PersonPatch } from "../../api/events";
import { Badge, Button, Dialog, Field } from "../../design/components";
import { seatName } from "./format";
import { NAME_MAX, hasErrors, memberName, parseAge, splitName, validatePerson } from "./partyRules";
import type { PartyCard, PersonErrors } from "./partyRules";
import type { AttendeeState } from "./useAttendee";
import "./party.css";

interface YourPartyProps {
  state: AttendeeState;
  view: AttendeeView;
}

export function YourParty({ state, view }: YourPartyProps) {
  const party = view.party;
  const [editing, setEditing] = useState<PartyMember | null>(null);
  const [removing, setRemoving] = useState<PartyMember | null>(null);
  if (!party) return null;
  const { members, places_left: placesLeft } = party;
  const where = (seatId: number | null) => (seatId === null ? "No seat" : seatName(seatId, view.map.seats, view.map.tables));
  const { busy } = state;
  const partyActions = state.party.actions;

  return (
    <section className="party-panel" aria-labelledby="ev-your-party">
      <h3 id="ev-your-party" className="ev-subtitle">
        Your party
      </h3>
      {!party.me.details_complete && <MyDetailsCard state={state} view={view} />}
      {members.length === 0 ? (
        <p className="ev-muted">Bringing someone? Add people to choose their seats. You give each one a name and an age.</p>
      ) : (
        <ul className="party-members" aria-label="People you booked seats for">
          {members.map((member) => {
            const name = memberName(member);
            return (
              <li key={member.id} className="party-member">
                <div className="party-member-main">
                  <strong className="party-member-name">{name}</strong>
                  <span className="party-member-seat">{where(member.seat_id)}</span>
                  {member.age_saved && <Badge tone="neutral">Age saved</Badge>}
                  {member.rsvp === "no" && <Badge tone="warning">Marked not coming by the organiser</Badge>}
                </div>
                <div className="party-member-actions">
                  <Button variant="secondary" aria-label={`Edit ${name}`} onClick={() => setEditing(member)}>
                    Edit
                  </Button>
                  {member.rsvp !== "no" && (
                    <Button variant="secondary" aria-label={`Move ${name}`} onClick={() => partyActions.startMove(member.id)}>
                      Move
                    </Button>
                  )}
                  <Button variant="ghost" aria-label={`Remove ${name}`} onClick={() => setRemoving(member)}>
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {placesLeft > 0 ? (
        <Button variant="secondary" onClick={partyActions.startAdd}>
          Add people
        </Button>
      ) : (
        <p className="ev-muted">This event has no place left for more people.</p>
      )}
      {editing && (
        <EditMemberDialog
          member={editing}
          busy={busy === `edit-${editing.id}`}
          onClose={() => setEditing(null)}
          onSave={(patch) => partyActions.editMember(editing.id, patch)}
        />
      )}
      <Dialog
        open={removing !== null}
        title={removing ? `Remove ${memberName(removing)} from your party?` : ""}
        onClose={() => setRemoving(null)}
        actions={
          removing && (
            <>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Keep {memberName(removing)}
              </Button>
              <Button
                variant="danger"
                busy={busy === `remove-${removing.id}`}
                onClick={() => void partyActions.removeMember(removing.id).then(() => setRemoving(null))}
              >
                Remove
              </Button>
            </>
          )
        }
      >
        <p>Their seat becomes free for anyone, and their name and age are deleted. This cannot be undone.</p>
      </Dialog>
    </section>
  );
}

/** Text fields of one person: only what changed is sent, never an empty value. */
function patchFrom(member: PartyMember, first: string, last: string, age: string): PersonPatch {
  const patch: PersonPatch = {};
  if (first.trim() !== (member.first_name ?? "")) patch.first_name = first.trim();
  if (last.trim() !== (member.last_name ?? "")) patch.last_name = last.trim();
  const years = parseAge(age);
  if (years !== null) patch.age = years;
  return patch;
}

interface EditMemberDialogProps {
  member: PartyMember;
  busy: boolean;
  onClose: () => void;
  onSave: (patch: PersonPatch) => Promise<boolean>;
}

function EditMemberDialog({ member, busy, onClose, onSave }: EditMemberDialogProps) {
  const fallback = splitName(memberName(member));
  const [first, setFirst] = useState(member.first_name ?? fallback.first);
  const [last, setLast] = useState(member.last_name ?? fallback.last);
  const [age, setAge] = useState("");
  const [errors, setErrors] = useState<PersonErrors>({});

  const save = async (): Promise<void> => {
    const card: PartyCard = { key: "edit", seatId: member.seat_id, firstName: first, lastName: last, age };
    const found = validatePerson(card, member.age_saved);
    setErrors(found);
    if (hasErrors(found)) return;
    const patch = patchFrom(member, first, last, age);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    if (await onSave(patch)) onClose();
  };

  return (
    <Dialog
      open
      title={`Edit ${memberName(member)}`}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={busy} onClick={() => void save()}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="party-dialog-fields">
        <Field label="First name" value={first} maxLength={NAME_MAX} autoComplete="off" error={errors.firstName} onChange={(e) => setFirst(e.target.value)} />
        <Field label="Last name" value={last} maxLength={NAME_MAX} autoComplete="off" error={errors.lastName} onChange={(e) => setLast(e.target.value)} />
        <Field
          label="Age"
          hint={member.age_saved ? "Saved. Leave empty to keep it." : "In years."}
          value={age}
          inputMode="numeric"
          maxLength={3}
          autoComplete="off"
          error={errors.age}
          onChange={(e) => setAge(e.target.value)}
        />
      </div>
    </Dialog>
  );
}

/** For a guest with a seat but without a saved name or age: saved through POST .../party/me. */
function MyDetailsCard({ state, view }: YourPartyProps) {
  const me = view.party?.me;
  const fallback = splitName(view.me.name);
  const [first, setFirst] = useState(me?.first_name ?? view.me.first_name ?? fallback.first);
  const [last, setLast] = useState(me?.last_name ?? view.me.last_name ?? fallback.last);
  const [age, setAge] = useState("");
  const [errors, setErrors] = useState<PersonErrors>({});
  const ageSaved = me?.age_saved ?? false;

  const save = async (): Promise<void> => {
    const found = validatePerson({ key: "me", seatId: null, firstName: first, lastName: last, age }, ageSaved);
    setErrors(found);
    if (hasErrors(found)) return;
    const years = parseAge(age);
    const body = years === null ? { first_name: first.trim(), last_name: last.trim() } : { first_name: first.trim(), last_name: last.trim(), age: years };
    if (await state.party.actions.saveMyDetails(body)) setAge("");
  };

  return (
    <form
      className="party-card party-mine"
      aria-labelledby="ev-my-details"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      noValidate
    >
      <h4 id="ev-my-details" className="party-card-title">
        Add your details
      </h4>
      <p className="ev-muted">Every seat needs a first name, a last name and an age, yours too. Only the organiser sees ages.</p>
      <div className="party-card-fields">
        <Field label="First name" value={first} maxLength={NAME_MAX} autoComplete="given-name" error={errors.firstName} onChange={(e) => setFirst(e.target.value)} />
        <Field label="Last name" value={last} maxLength={NAME_MAX} autoComplete="family-name" error={errors.lastName} onChange={(e) => setLast(e.target.value)} />
        <Field
          label="Age"
          hint={ageSaved ? "Saved. Leave empty to keep it." : "In years."}
          value={age}
          inputMode="numeric"
          maxLength={3}
          autoComplete="off"
          error={errors.age}
          onChange={(e) => setAge(e.target.value)}
        />
      </div>
      <Button type="submit" busy={state.busy === "party-me"}>
        Save my details
      </Button>
    </form>
  );
}
