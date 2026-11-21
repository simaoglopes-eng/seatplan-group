// One guest in the organiser's list: name, where they sit (in words, not
// colour), and the actions for that person. The row can be dragged onto the
// map; "Place" is the keyboard way to do the same. Each button's accessible
// name adds the guest's name ("Place Bea Costa"), because a list of 28
// identical "Place" buttons does not tell which guest each one is for. The
// name starts with the visible words, so speech control ("click Place") works.
//
// Party booking (guestParty.ts): a party member is indented under the guest
// who booked their seat, says "Booked by ...", shows the age the booker typed
// (the organiser is the only one who sees ages) and has no link buttons (a
// party member never gets a link). Deleting a guest who booked a party asks
// whether their people go too.
import { useState } from "react";
import type { DragEvent } from "react";
import type { OrganiserGuest, PartyChoice } from "../../api/events";
import { Badge, Button, Dialog } from "../../design/components";
import type { BadgeTone } from "../../design/components";
import { isPartyMember, namesOf } from "./guestParty";
import "./party.css";

interface GuestRowProps {
  guest: OrganiserGuest;
  seatLabel: string | null;
  selected: boolean;
  link: string | undefined;
  busy: string | null;
  onPlace: () => void;
  onCopyLink: () => void;
  onNewLink: () => Promise<boolean>;
  /** `party` is sent only for a guest who booked seats for others. */
  onDelete: (party?: PartyChoice) => Promise<boolean>;
  /** 1 when this row is a party member listed under the guest who booked them. */
  depth?: 0 | 1;
  /** On a party member: the guest who booked them, when still on the list. */
  booker?: OrganiserGuest | null;
  /** On a booker: the people they booked seats for. */
  members?: OrganiserGuest[];
}

function status(guest: OrganiserGuest, seatLabel: string | null): { tone: BadgeTone; text: string } {
  if (guest.rsvp === "no") return { tone: "neutral", text: "Not coming" };
  if (seatLabel) return { tone: "success", text: seatLabel };
  if (guest.rsvp === "pending") return { tone: "warning", text: "No reply yet" };
  return { tone: "warning", text: "No seat yet" };
}

export function GuestRow(props: GuestRowProps) {
  const { guest, seatLabel, selected, link, booker = null, members = [] } = props;
  // Both actions undo something for the guest, so both ask first.
  const [asking, setAsking] = useState<"delete" | "link" | null>(null);
  const close = () => setAsking(null);
  const badge = status(guest, seatLabel);
  const member = isPartyMember(guest);
  const hasParty = members.length > 0;
  const others = `${members.length} other ${members.length === 1 ? "person" : "people"}`;
  const deleting = props.busy === `delete-${guest.id}`;

  const onDragStart = (event: DragEvent<HTMLLIElement>): void => {
    event.dataTransfer.setData("text/plain", String(guest.id));
    event.dataTransfer.effectAllowed = "move";
  };

  const classes = ["ev-guest", selected ? "is-selected" : "", props.depth === 1 ? "ev-guest--member" : ""].filter(Boolean).join(" ");

  return (
    <li className={classes} draggable onDragStart={onDragStart}>
      <div className="ev-guest-main">
        <span className="ev-guest-name">{guest.name}</span>
        <Badge tone={badge.tone}>{badge.text}</Badge>
        {guest.needs_accessible && <Badge tone="info">Needs accessible seat</Badge>}
        {guest.source === "self_registered" && <Badge tone="info">Joined with link</Badge>}
        {guest.has_account && <Badge tone="neutral">Has an account</Badge>}
        {member && <Badge tone="info">{booker ? `Booked by ${booker.name}` : "Party member"}</Badge>}
        {hasParty && <Badge tone="info">{`Party of ${members.length + 1}`}</Badge>}
        {typeof guest.age === "number" && <span className="ev-guest-age">Age {guest.age}</span>}
      </div>
      <div className="ev-guest-actions">
        <Button
          variant={selected ? "primary" : "secondary"}
          aria-pressed={selected}
          aria-label={selected ? `Choosing seat for ${guest.name}...` : `Place ${guest.name}`}
          onClick={props.onPlace}
        >
          {selected ? "Choosing seat..." : "Place"}
        </Button>
        {member ? null : link ? (
          <Button variant="ghost" aria-label={`Copy link for ${guest.name}`} onClick={props.onCopyLink}>
            Copy link
          </Button>
        ) : (
          <Button variant="ghost" aria-label={`New link for ${guest.name}`} onClick={() => setAsking("link")}>
            New link
          </Button>
        )}
        <Button variant="ghost" aria-label={`Delete data of ${guest.name}`} onClick={() => setAsking("delete")}>
          Delete data
        </Button>
      </div>
      <Dialog
        open={asking === "link"}
        title={`Make a new link for ${guest.name}?`}
        onClose={close}
        actions={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button busy={props.busy === `link-${guest.id}`} onClick={() => void props.onNewLink().then(close)}>
              Make new link
            </Button>
          </>
        }
      >
        <p>Their current link stops working at once. Use this when a link was lost or shared by mistake, then send them the new one.</p>
      </Dialog>
      <Dialog
        open={asking === "delete"}
        title={`Delete ${guest.name}'s data?`}
        onClose={close}
        actions={
          hasParty ? (
            <>
              <Button variant="secondary" onClick={close}>
                Keep guest
              </Button>
              <Button variant="secondary" busy={deleting} onClick={() => void props.onDelete("keep").then(close)}>
                {`Delete only ${guest.name}`}
              </Button>
              <Button variant="danger" busy={deleting} onClick={() => void props.onDelete("erase").then(close)}>
                {`Delete all ${members.length + 1}`}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={close}>
                Keep guest
              </Button>
              <Button variant="danger" busy={deleting} onClick={() => void props.onDelete().then(close)}>
                Delete for good
              </Button>
            </>
          )
        }
      >
        {hasParty ? (
          <>
            <p>
              {guest.name} booked seats for {others}: {namesOf(members)}.
            </p>
            <p>
              Deleting erases names, ages, emails, seats and links. It cannot be undone. If you delete only {guest.name}, the others keep their seats
              and you manage them here.
            </p>
          </>
        ) : (
          <p>This erases their name, email, seat and personal link. It cannot be undone.</p>
        )}
      </Dialog>
    </li>
  );
}
