"""The organiser's guest list: add, change, erase, and send a fresh link.

Erasing a guest (GDPR "right to erasure") keeps an empty row so ids in old
plan snapshots still point somewhere, but every piece of personal data is
overwritten and the personal link stops working for good.
"""

from typing import Any

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import ApiError
from app.core.text import has_letter
from app.events_service.access import attendee_link
from app.events_service.mailer import forget_guest_emails
from app.events_service.problem import current_rows, event_guests
from app.events_service.schemas import GuestIn
from app.events_service.seating import drop_assignment, lock_event
from app.models import Acquaintance, Event, Guest, GuestGroup, Organiser, utc_now
from app.security import hash_token, new_token

ERASED_NAME = "Deleted guest"


def group_names(session: Session, event: Event) -> dict[int, str]:
    groups = session.scalars(select(GuestGroup).where(GuestGroup.event_id == event.id))
    return {group.id: group.name for group in groups}


def guest_dict(
    guest: Guest, group: str | None, seat_id: int | None, show_age: bool = True
) -> dict[str, Any]:
    """Everything the ORGANISER may see about a guest. Never the token or its hash.

    `show_age` is false for the venue's team (core/members.py): ages, often
    of children, are for the event's own organiser only (shows_ages).
    """
    return {
        "id": guest.id,
        "name": guest.name,
        "email": guest.email,
        "group": group,
        "rsvp": guest.rsvp,
        "wants_anonymous": guest.wants_anonymous,
        "needs_accessible": guest.needs_accessible,
        "dietary_note": guest.dietary_note,
        "reserved_tag": guest.reserved_tag,
        "seat_id": seat_id,
        # How the guest got on the list, and whether a guest account owns the
        # row. Never the account's id or email.
        "source": guest.source,
        "has_account": guest.account_id is not None,
        # Party booking (party.py). The age is shown to the organiser only.
        "first_name": guest.first_name,
        "last_name": guest.last_name,
        "age": guest.age_years if show_age else None,
        "booked_by_guest_id": guest.booked_by_guest_id,
    }


AGES_FOR_ORGANISER = "Only the event's organiser can see or change ages."


def shows_ages(event: Event, user: Organiser) -> bool:
    """Only the event's own organiser sees ages; the venue's team members do not."""
    return event.organiser_id == user.id


def list_guests(session: Session, event: Event, show_age: bool = True) -> list[dict[str, Any]]:
    groups = group_names(session, event)
    rows = current_rows(session, event)
    return [
        guest_dict(
            guest,
            groups.get(guest.group_id) if guest.group_id else None,
            rows[guest.id].seat_id if guest.id in rows else None,
            show_age,
        )
        for guest in event_guests(session, event)
        if guest.token_revoked_at is None
    ]


def group_id_for(
    session: Session, event: Event, name: str | None, keep_adjacent: bool
) -> int | None:
    """The id of the event's group with this name, creating the group if needed."""
    if not name:
        return None
    query = select(GuestGroup).where((GuestGroup.event_id == event.id) & (GuestGroup.name == name))
    group = session.scalars(query).first()
    if group is None:
        group = GuestGroup(event_id=event.id, name=name, keep_adjacent=keep_adjacent)
        session.add(group)
        session.flush()
    return group.id


def email_in_use(session: Session, event: Event, email: str, except_id: int | None = None) -> bool:
    query = select(Guest.id).where((Guest.event_id == event.id) & (Guest.email == email))
    return any(found != except_id for found in session.scalars(query))


def add_guest(session: Session, event: Event, body: GuestIn) -> tuple[Guest, str]:
    """Add one guest. Returns the guest and their raw link token.

    The raw token is shown once; we only keep its hash, so a lost link is
    replaced with "new link", never looked up.
    """
    if body.email and email_in_use(session, event, body.email):
        raise ApiError(409, "conflict", f"{body.email} is already on the guest list.")
    token = new_token()
    guest = Guest(
        event_id=event.id,
        name=body.name.strip(),
        email=body.email,
        token_hash=hash_token(token),
        group_id=group_id_for(session, event, body.group, body.keep_adjacent),
        wants_anonymous=body.wants_anonymous,
        needs_accessible=body.needs_accessible,
        dietary_note=body.dietary_note,
        reserved_tag=body.reserved_tag,
    )
    session.add(guest)
    session.flush()
    return guest, token


def update_guest(
    session: Session, event: Event, guest: Guest, changes: dict[str, Any], user: Organiser
) -> None:
    """Apply only the fields the organiser sent. Answering "no" frees the seat.

    `first_name`, `last_name` and `age` (stored as age_years) are the party
    booking details; both names together also set `name`. A party member
    (source "companion") always keeps both names and an age, and never gets
    an address: an address would let an account with it take the row over.
    """
    person = {key: changes.pop(key) for key in ("first_name", "last_name", "age") if key in changes}
    row = current_rows(session, event).get(guest.id)
    _check_person_changes(
        guest, changes, person, chose_seat=row is not None and row.source == "self"
    )
    if changes.get("email") and email_in_use(session, event, changes["email"], guest.id):
        raise ApiError(409, "conflict", f"{changes['email']} is already on the guest list.")
    lock_event(session, event)  # before any other write, see seating.py
    if "group" in changes:
        guest.group_id = group_id_for(session, event, changes.pop("group"), False)
    if "name" in changes:
        guest.first_name = guest.last_name = None
    for name, value in changes.items():
        setattr(guest, name, value)
    if "age" in person:
        guest.age_years = person["age"]
    if "first_name" in person or "last_name" in person:
        guest.first_name = person.get("first_name", guest.first_name)
        guest.last_name = person.get("last_name", guest.last_name)
        if guest.first_name and guest.last_name:
            guest.name = f"{guest.first_name} {guest.last_name}"
    if guest.rsvp == "no":
        drop_assignment(session, event, guest, actor=user.email)
    audit.record(
        session,
        actor=user.email,
        action="guest.update",
        entity="guest",
        entity_id=str(guest.id),
        detail={"fields": sorted([*changes, *person])},
    )


PARTY_MEMBER = "Party members are managed by the guest who booked them."


def _check_person_changes(
    guest: Guest, changes: dict[str, Any], person: dict[str, Any], chose_seat: bool = False
) -> None:
    """Refuse what update_guest must not write, before anything is changed.

    `person` holds the first_name, last_name and age the organiser sent;
    names are trimmed in place. `chose_seat` is true when the guest booked
    their current seat themselves: every chosen seat carries a first name, a
    last name and an age (party.py), so once those are saved the organiser
    may correct them but not empty them.
    """
    is_member = guest.source == "companion"
    booked_whole = (
        chose_seat
        and has_letter(guest.first_name)
        and has_letter(guest.last_name)
        and guest.age_years is not None
    )
    if is_member and changes.get("email"):
        raise ApiError(409, "party_member", PARTY_MEMBER)
    if is_member and "name" in changes:
        raise ApiError(422, "validation", "Edit the first and last name of a party member.")
    if booked_whole and "name" in changes:
        raise ApiError(
            422, "validation", "Edit the first and last name of a guest who chose their seat."
        )
    if is_member and "age" in person and person["age"] is None:
        raise ApiError(422, "validation", "age: A party member needs an age from 0 to 120.")
    if booked_whole and "age" in person and person["age"] is None:
        raise ApiError(
            422, "validation", "age: A guest who chose their seat needs an age from 0 to 120."
        )
    for key, label in (("first_name", "first name"), ("last_name", "last name")):
        if key in person:
            value = (person[key] or "").strip()
            if not has_letter(value):
                raise ApiError(422, "validation", f"{key}: Enter a {label}.")
            person[key] = value
    first = person.get("first_name", guest.first_name) or ""
    last = person.get("last_name", guest.last_name) or ""
    if len(first) + 1 + len(last) > 120:
        raise ApiError(
            422, "validation", "Shorten the first or last name (120 characters together at most)."
        )


def erase_guest(session: Session, event: Event, guest: Guest, actor: str) -> None:
    """GDPR delete: free the seat, forget who knows whom, overwrite personal data.

    `actor` is who asked: the organiser's email, or "account:<id>" when a
    guest deletes their own account. The address goes first, so freeing the
    seat cannot queue a "your seat was released" email to someone who asked to
    be forgotten. Their earlier emails in the outbox are wiped too.

    A guest account that owned the row stays written on it (only the
    account's number, no personal data), so that account cannot simply join
    again with the shared link (share.join answers "removed"). Deleting the
    account clears it (accounts.delete_account).
    """
    lock_event(session, event)  # before any other write, see seating.py
    guest.email = None
    drop_assignment(session, event, guest, actor=actor)
    forget_guest_emails(session, event, guest.id)
    session.execute(
        delete(Acquaintance).where(
            or_(Acquaintance.guest_id == guest.id, Acquaintance.knows_guest_id == guest.id)
        )
    )
    guest.first_name = guest.last_name = None
    guest.name = ERASED_NAME
    guest.dietary_note = None
    guest.needs_accessible = False
    guest.reserved_tag = None
    guest.wants_anonymous = True
    guest.birth_date = None
    guest.share_age = False
    guest.age_years = None
    guest.group_id = None
    guest.rsvp = "no"
    # A random hash nobody holds the token for: the old link can never match.
    guest.token_hash = hash_token(new_token())
    guest.token_revoked_at = utc_now()
    # The audit row names only the id: writing the name here would undo the erasure.
    audit.record(
        session, actor=actor, action="guest.erase", entity="guest", entity_id=str(guest.id)
    )


def new_link(session: Session, event: Event, guest: Guest, user: Organiser) -> dict[str, str]:
    """Replace the guest's token. The old link stops working at once.

    A party member gets no link: it would be a login to the booker's party.
    """
    if guest.source == "companion":
        raise ApiError(409, "party_member", PARTY_MEMBER)
    token = new_token()
    guest.token_hash = hash_token(token)
    audit.record(
        session, actor=user.email, action="guest.new_link", entity="guest", entity_id=str(guest.id)
    )
    return {"token": token, "link": attendee_link(token)}
