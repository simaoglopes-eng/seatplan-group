"""Party booking: one guest chooses several seats and names everyone on them.

The guest who books (the "booker") reaches this through either door of
attendee_view.py: the personal link (/a/{token}) or a guest account
(/guest/events/{eid}). Each person they bring is a Guest row of its own,
with source "companion" and booked_by_guest_id pointing at the booker. Such a
row has no email, no account and a hash of a token nobody is given, so it
can never log in; only the booker (and the organiser) manage it.

Seats are first come, first served, as for one seat (seating.confirm_seat):
there are no holds. POST .../party/confirm takes the event lock, checks every
seat, then writes the booker's seat, the new members and their seats in one
transaction. If anything is wrong nothing is written, and the error names the
seats (details.seat_ids) so the page can keep every name that was typed.

The age typed for each person is for the organiser only: it is stored in
guests.age_years, which nothing shown to guests or visitors reads. The booker
gets back only `age_saved` (true or false), never the number.

Two limits stop one booker from taking a whole event (core/limits.py): the
event's party size (events.max_party_size, the booker's own seat included)
and a lifetime number of companion rows, since each removal leaves an
emptied row behind.
"""

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import audit, limits
from app.core.errors import ApiError
from app.core.text import has_letter
from app.events_service.access import is_active, require_before_deadline
from app.events_service.guests import erase_guest
from app.events_service.problem import current_rows, guest_specs, seat_spec
from app.events_service.schemas import MyDetailsIn, PartyConfirmIn, PersonPatch
from app.events_service.seating import (
    lock_event,
    queue_change_email,
    recheck_after_lock,
    require_coming,
    taken_message,
)
from app.events_service.share import party_room
from app.models import Event, Guest, GuestGroup, Seat, SeatAssignment, utc_now
from app.optimiser.events_model import GuestSpec, seat_allows
from app.security import hash_token, new_token

MEMBER_SOURCE = "companion"
NOT_IN_PARTY = "This person is not in your party."
NAME_LIMIT = 120  # guests.name is VARCHAR(120)
# A new party member has no tag and no accessibility need: only the plain rules apply.
NEW_MEMBER_SPEC = GuestSpec(
    id=0,
    group_id=None,
    keep_adjacent=False,
    needs_accessible=False,
    reserved_tag=None,
    knows=frozenset(),
)


# ---------------------------------------------------------------- reading


def is_party_member(guest: Guest) -> bool:
    return guest.source == MEMBER_SOURCE


def age_saved(guest: Guest) -> bool:
    """Whether an age is stored. The number itself is for the organiser only."""
    return guest.age_years is not None


def details_complete(guest: Guest) -> bool:
    """First name, last name and age are all saved. A name without a letter is no name."""
    return (
        has_letter(guest.first_name) and has_letter(guest.last_name) and guest.age_years is not None
    )


DETAILS_REQUIRED = (
    "Add your first name, last name and age before you confirm a seat. "
    "Reload the page to see the form."
)


def require_details(guest: Guest) -> None:
    """Every chosen seat carries a first name, a last name and an age (the one-seat confirm)."""
    if not details_complete(guest):
        raise ApiError(422, "details_required", DETAILS_REQUIRED)


def members_of(session: Session, booker: Guest) -> list[Guest]:
    """The booker's party members that are not erased, oldest first.

    Members the organiser marked "no" are included, so the booker still sees
    and can remove them.
    """
    query = (
        select(Guest)
        .where(
            (Guest.booked_by_guest_id == booker.id)
            & (Guest.event_id == booker.event_id)
            & Guest.token_revoked_at.is_(None)
        )
        .order_by(Guest.id)
    )
    return list(session.scalars(query))


def max_party_size(event: Event) -> int | None:
    """Seats one guest may book, their own included; None means no limit."""
    if event.max_party_size is None:
        return limits.DEFAULT_MAX_PARTY_SIZE
    return event.max_party_size or None


def party_size_left(session: Session, event: Event, booker: Guest) -> int | None:
    """How many more people this booker may bring under the party limit; None: no limit.

    The booker counts as one, and so does each member still coming. A member
    the organiser marked "no" or that was removed frees a place.
    """
    limit = max_party_size(event)
    if limit is None:
        return None
    coming = sum(1 for member in members_of(session, booker) if is_active(member))
    return max(0, limit - 1 - coming)


def party_changes_allowed(event: Event) -> int:
    """Companion rows one booker may create over the event's life, erased ones included."""
    limit = max_party_size(event)
    if limit is None:
        return limits.PARTY_CHANGES_NO_LIMIT
    return limits.PARTY_CHANGES_FACTOR * limit


def companions_created(session: Session, booker: Guest) -> int:
    """Every companion row this booker ever created, erased ones too (erase_guest keeps the link)."""
    query = select(func.count()).where(
        (Guest.booked_by_guest_id == booker.id) & (Guest.event_id == booker.event_id)
    )
    return session.scalar(query) or 0


def _seats_word(count: int) -> str:
    return "1 seat" if count == 1 else f"{count} seats"


def _people(count: int) -> str:
    return "1 other person" if count == 1 else f"{count} other people"


def refuse_while_party_coming(session: Session, booker: Guest) -> None:
    """A booker may not leave (answer "no", give the seat back) while members are coming."""
    coming = [member for member in members_of(session, booker) if is_active(member)]
    if coming:
        raise ApiError(
            409,
            "party_exists",
            f"You booked seats for {_people(len(coming))}. "
            "Remove them in Your party first, or ask the organiser.",
        )


def party_view(session: Session, event: Event, me: Guest) -> dict[str, Any]:
    """PartyView: the booker's own details and their members. No age numbers."""
    rows = current_rows(session, event)

    def seat_of(guest: Guest) -> int | None:
        return rows[guest.id].seat_id if guest.id in rows else None

    return {
        "me": {
            "guest_id": me.id,
            "first_name": me.first_name,
            "last_name": me.last_name,
            "age_saved": age_saved(me),
            "seat_id": seat_of(me),
            "details_complete": details_complete(me),
        },
        "members": [
            {
                "id": member.id,
                "first_name": member.first_name,
                "last_name": member.last_name,
                "age_saved": age_saved(member),
                "seat_id": seat_of(member),
                "rsvp": member.rsvp,
            }
            for member in members_of(session, me)
        ],
        "places_left": party_room(session, event, me),
        # The party limit, the booker's own seat included; None: no limit.
        "max_party_size": max_party_size(event),
        # How many more people the limit still allows; None: no limit.
        "party_size_left": party_size_left(session, event, me),
    }


def load_member(session: Session, me: Guest, member_id: int) -> Guest:
    """One of the booker's own members, or the same 404 for anything else."""
    member = session.get(Guest, member_id)
    if (
        member is None
        or member.booked_by_guest_id != me.id
        or member.event_id != me.event_id
        or member.token_revoked_at is not None
    ):
        raise ApiError(404, "not_found", NOT_IN_PARTY)
    return member


# ---------------------------------------------------------------- checks


def clean_name(first: str, last: str) -> tuple[str, str]:
    """Trim both halves; 422 when one is blank (or has no letter) or the whole name is too long.

    The characters themselves were checked by the request model (NamePart).
    """
    first, last = first.strip(), last.strip()
    if not has_letter(first):
        raise ApiError(422, "validation", "first_name: Enter a first name.")
    if not has_letter(last):
        raise ApiError(422, "validation", "last_name: Enter a last name.")
    if len(first) + 1 + len(last) > NAME_LIMIT:
        raise ApiError(
            422,
            "validation",
            f"Shorten the first or last name ({NAME_LIMIT} characters together at most).",
        )
    return first, last


def _require_booker(me: Guest) -> None:
    # A party member has no door of their own; this only guards the service.
    if me.booked_by_guest_id is not None:
        raise ApiError(404, "not_found", "Guest not found.")


def _recheck(session: Session, me: Guest, member: Guest | None = None) -> None:
    """After lock_event: the booker, and the member if any, as they are now.

    The route found both before the lock; meanwhile another request may have
    erased the booker (organiser, account deletion) or removed the member
    (another tab). See seating.recheck_after_lock. Nothing is written before.
    """
    recheck_after_lock(session, me)
    _require_booker(me)
    if member is not None:
        session.refresh(member)
        if (
            member.token_revoked_at is not None
            or member.booked_by_guest_id != me.id
            or member.event_id != me.event_id
        ):
            raise ApiError(404, "not_found", NOT_IN_PARTY)


def _require_my_age(me: Guest, age: int | None) -> None:
    if age is None and me.age_years is None:
        raise ApiError(422, "validation", "age: Enter your age.")


def _seats_taken(seats: list[Seat]) -> ApiError:
    if len(seats) == 1:
        message = taken_message(seats[0])
    else:
        labels = ", ".join(seat.label for seat in seats)
        message = (
            f"Seats {labels} were just taken by someone else. "
            "Please choose other seats; the map shows what is still free."
        )
    return ApiError(409, "seat_taken", message, details={"seat_ids": [s.id for s in seats]})


def _write_or_seat_taken(session: Session, seat_ids: list[int], commit: bool = False) -> None:
    """Flush (or commit) now; a UNIQUE clash on the seats becomes 409 with the seat ids.

    `seat_ids` is empty when the clash cannot be pinned to one seat: the page
    then reloads the map and works out which of its seats are gone.
    """
    try:
        if commit:
            session.commit()
        else:
            session.flush()
    except IntegrityError:
        session.rollback()
        raise ApiError(
            409,
            "seat_taken",
            "One of these seats was just taken by someone else. "
            "Please choose again; the map shows what is still free.",
            details={"seat_ids": seat_ids},
        ) from None


def _check_party_limits(session: Session, event: Event, me: Guest, adding: int) -> None:
    """409 when `adding` new members would pass the party size or the lifetime limit.

    Call after lock_event and session.refresh(event): both read the members
    and the event's setting as they are now. Nothing is written before.
    """
    left = party_size_left(session, event, me)
    if left is not None and adding > left:
        limit = max_party_size(event)
        raise ApiError(
            409,
            "party_too_large",
            f"You can book up to {_seats_word(limit or 0)} for this event, your own included. "
            + (
                f"You can add {left} more {'person' if left == 1 else 'people'}."
                if left
                else "Ask the organiser if you need more."
            ),
            details={"max_party_size": limit, "party_size_left": left},
        )
    allowed = party_changes_allowed(event)
    if companions_created(session, me) + adding > allowed:
        raise ApiError(
            409,
            "party_changes_exhausted",
            "You have added as many people as one person can for this event, "
            "counting the people you removed. Ask the organiser to add or change people for you.",
        )


def _full(room: int) -> ApiError:
    if room == 0:
        message = "This event is full. Every place has a guest."
    elif room == 1:
        message = "Only 1 more person can join this event."
    else:
        message = f"Only {room} more people can join this event."
    return ApiError(409, "event_full", message, details={"places_left": room})


def _record(session: Session, me: Guest, action: str, detail: dict[str, Any]) -> Any:
    """Audit a party change. Ids and field names only: never a name or an age."""
    return audit.record(
        session,
        actor=f"guest:{me.id}",
        action=action,
        entity="guest",
        entity_id=str(me.id),
        detail=detail,
    )


def ensure_party_group(session: Session, event: Event, me: Guest) -> int:
    """The group the booker's members join, so the optimiser keeps them together.

    A booker already in a group (the organiser's) keeps it and the members
    join it. Otherwise a new keep-adjacent group is made, named by id so it can
    never merge with a group the organiser typed. No commit; call after the lock.
    """
    if me.group_id is not None:
        return me.group_id
    group = GuestGroup(event_id=event.id, name=f"Party of guest #{me.id}", keep_adjacent=True)
    session.add(group)
    session.flush()
    me.group_id = group.id
    return group.id


# ---------------------------------------------------------------- writing


def confirm_party(
    session: Session, event: Event, me: Guest, body: PartyConfirmIn, token: str | None
) -> dict[str, Any]:
    """Seat the booker and add every new member, all or nothing. Commits.

    `token` is the booker's own link token (None for a guest account), so the
    seat email can link back. Repeating a request that already succeeded is
    refused (the members' seats are now taken), so nobody is added twice.
    """
    require_before_deadline(event)
    require_coming(me)
    _require_booker(me)
    # Everything that needs no database is checked before the lock, and
    # nothing is changed before it (see seating.lock_event).
    my_first, my_last = clean_name(body.me.first_name, body.me.last_name)
    _require_my_age(me, body.me.age)
    people = [(clean_name(m.first_name, m.last_name), m.age, m.seat_id) for m in body.members]
    my_seat_id = body.me.seat_id
    member_seat_ids = [seat_id for _name, _age, seat_id in people]
    seat_ids = [my_seat_id, *member_seat_ids]
    if len(set(seat_ids)) != len(seat_ids):
        raise ApiError(422, "validation", "Each seat can be chosen once.")

    lock_event(session, event)  # seats are read after it: a room setup may have moved the event
    # The link's cap and switch and the party limit, as they are now (as share.join does).
    session.refresh(event)
    _recheck(session, me)  # erased, re-linked or answered "no" while we waited?
    require_coming(me)
    _require_my_age(me, body.me.age)
    found = {seat.id: seat for seat in session.scalars(select(Seat).where(Seat.id.in_(seat_ids)))}
    missing = [i for i in seat_ids if i not in found or found[i].venue_id != event.venue_id]
    if missing:
        raise ApiError(404, "not_found", "Seat not found.", details={"seat_ids": missing})
    refused = []
    if not seat_allows(seat_spec(found[my_seat_id]), guest_specs(session, [me])[0]):
        refused.append(my_seat_id)
    refused += [i for i in member_seat_ids if not seat_allows(seat_spec(found[i]), NEW_MEMBER_SPEC)]
    if refused:
        labels = ", ".join(found[i].label for i in refused)
        raise ApiError(
            409,
            "conflict",
            f"These seats are not available to your party: {labels}. Please pick others.",
            details={"seat_ids": refused},
        )

    rows = current_rows(session, event)
    owner_of = {row.seat_id: row.guest_id for row in rows.values()}
    my_row = rows.get(me.id)
    old_seat_id = my_row.seat_id if my_row else None
    taken = [my_seat_id] if owner_of.get(my_seat_id, me.id) != me.id else []
    # A member may take the booker's current seat: the booker moves off it below.
    taken += [i for i in member_seat_ids if i in owner_of and owner_of[i] != me.id]
    if taken:
        raise _seats_taken([found[i] for i in taken])
    if people:
        _check_party_limits(session, event, me, len(people))
        room = party_room(session, event, me)
        if len(people) > room:
            raise _full(room)

    me.first_name, me.last_name = my_first, my_last
    me.name = f"{my_first} {my_last}"
    if body.me.age is not None:
        me.age_years = body.me.age
    if my_row is None:
        my_row = SeatAssignment(
            event_id=event.id, guest_id=me.id, seat_id=my_seat_id, source="self"
        )
        session.add(my_row)
    else:
        my_row.seat_id, my_row.source, my_row.created_at = my_seat_id, "self", utc_now()
    # The booker's move is written first, so a member can then take the old seat.
    _write_or_seat_taken(session, [my_seat_id])

    added: list[Guest] = []
    if people:
        group_id = ensure_party_group(session, event, me)
        for (first, last), age, _seat_id in people:
            member = Guest(
                event_id=event.id,
                name=f"{first} {last}",
                first_name=first,
                last_name=last,
                age_years=age,
                email=None,
                # A hash of a token nobody is given: a party member never has a link.
                token_hash=hash_token(new_token()),
                source=MEMBER_SOURCE,
                booked_by_guest_id=me.id,
                rsvp="yes",
                # The booker decides for the people they bring: when they
                # appear as "Guest", so do their people (attendee_view.set_privacy).
                wants_anonymous=me.wants_anonymous,
                needs_accessible=False,
                reserved_tag=None,
                group_id=group_id,
            )
            session.add(member)
            added.append(member)
        session.flush()  # gives the members their ids
        for member, seat_id in zip(added, member_seat_ids, strict=True):
            session.add(
                SeatAssignment(
                    event_id=event.id, guest_id=member.id, seat_id=seat_id, source="self"
                )
            )
        _write_or_seat_taken(session, [])

    entry = _record(
        session,
        me,
        "party.confirm",
        {
            "seat_ids": seat_ids,
            "member_ids": [member.id for member in added],
            "old_seat_id": old_seat_id,
        },
    )
    # Members have no address, so only the booker's own seat is emailed.
    queue_change_email(session, event, me, found[my_seat_id], old_seat_id, entry, token)
    _write_or_seat_taken(session, [], commit=True)
    return party_view(session, event, me)


def set_my_details(session: Session, event: Event, me: Guest, body: MyDetailsIn) -> dict[str, Any]:
    """The booker's own first name, last name and age, without changing seats. Commits."""
    require_before_deadline(event)
    _require_booker(me)
    first, last = clean_name(body.first_name, body.last_name)
    _require_my_age(me, body.age)
    lock_event(session, event)
    _recheck(session, me)
    _require_my_age(me, body.age)
    me.first_name, me.last_name = first, last
    me.name = f"{first} {last}"
    if body.age is not None:
        me.age_years = body.age
    _record(session, me, "party.me", {})
    session.commit()
    return party_view(session, event, me)


EMPTY_FIELD = {
    "first_name": "first_name: Enter a first name.",
    "last_name": "last_name: Enter a last name.",
    "age": "age: Enter an age from 0 to 120.",
}


def edit_member(
    session: Session, event: Event, me: Guest, member_id: int, body: PersonPatch
) -> dict[str, Any]:
    """Change one member's names or age. Only the fields sent change. Commits."""
    require_before_deadline(event)
    member = load_member(session, me, member_id)
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise ApiError(422, "validation", "Change the first name, the last name or the age.")
    for field, value in changes.items():
        if value is None:
            raise ApiError(422, "validation", EMPTY_FIELD[field])
    clean_name(  # refuse a bad name before the lock
        changes.get("first_name", member.first_name or ""),
        changes.get("last_name", member.last_name or ""),
    )
    lock_event(session, event)
    _recheck(session, me, member)
    first, last = clean_name(  # again with the member as they are now
        changes.get("first_name", member.first_name or ""),
        changes.get("last_name", member.last_name or ""),
    )
    member.first_name, member.last_name = first, last
    member.name = f"{first} {last}"
    if "age" in changes:
        member.age_years = changes["age"]
    _record(session, me, "party.edit", {"member_id": member.id, "fields": sorted(changes)})
    session.commit()
    return party_view(session, event, me)


def _require_member_coming(member: Guest) -> None:
    if member.rsvp == "no":
        raise ApiError(409, "conflict", "The organiser marked this person as not coming.")


def move_member(
    session: Session, event: Event, me: Guest, member_id: int, seat_id: int
) -> dict[str, Any]:
    """Give one member another seat; their old seat is free at once. Commits."""
    require_before_deadline(event)
    member = load_member(session, me, member_id)
    _require_member_coming(member)
    lock_event(session, event)
    _recheck(session, me, member)
    _require_member_coming(member)
    seat = session.get(Seat, seat_id)
    if seat is None or seat.venue_id != event.venue_id:
        raise ApiError(404, "not_found", "Seat not found.", details={"seat_ids": [seat_id]})
    if not seat_allows(seat_spec(seat), guest_specs(session, [member])[0]):
        raise ApiError(
            409,
            "conflict",
            "This seat is not available to your party. Please pick another.",
            details={"seat_ids": [seat_id]},
        )
    rows = current_rows(session, event)
    if any(row.seat_id == seat.id and row.guest_id != member.id for row in rows.values()):
        raise _seats_taken([seat])
    row = rows.get(member.id)
    old_seat_id = row.seat_id if row else None
    if row is None:
        session.add(
            SeatAssignment(event_id=event.id, guest_id=member.id, seat_id=seat.id, source="self")
        )
    else:
        row.seat_id, row.source, row.created_at = seat.id, "self", utc_now()
    _write_or_seat_taken(session, [seat.id])
    _record(
        session,
        me,
        "party.move",
        {"member_id": member.id, "seat_id": seat.id, "old_seat_id": old_seat_id},
    )
    _write_or_seat_taken(session, [seat.id], commit=True)
    return party_view(session, event, me)


def remove_member(session: Session, event: Event, me: Guest, member_id: int) -> dict[str, Any]:
    """Take one member out of the party: an erasure (the row stays, emptied). Commits."""
    require_before_deadline(event)
    member = load_member(session, me, member_id)
    lock_event(session, event)  # erase_guest locks too; the recheck needs the lock first
    _recheck(session, me, member)
    erase_guest(session, event, member, actor=f"guest:{me.id}")
    session.commit()
    return party_view(session, event, me)


def erase_party(session: Session, event: Event, booker: Guest, actor: str) -> list[int]:
    """Erase every member the booker brought (organiser delete, account deletion). No commit."""
    erased = []
    for member in members_of(session, booker):
        erase_guest(session, event, member, actor)
        erased.append(member.id)
    return erased


def erase_with_party(
    session: Session, event: Event, guest: Guest, actor: str, choice: str | None
) -> list[int] | None:
    """The organiser deletes a guest who may have booked a party. No commit.

    With members not erased and no `choice`, nothing changes: 409 has_party,
    so the page can ask. "erase" erases the members first; "keep" erases only
    the booker, and the members stay seated for the organiser to manage.
    Returns the erased member ids, or None when no choice was given.
    """
    members = members_of(session, guest)
    if members and choice is None:
        raise ApiError(
            409,
            "has_party",
            f"{guest.name} booked seats for {_people(len(members))}. "
            "Choose whether to delete them too.",
            details={"party_size": len(members), "member_ids": [m.id for m in members]},
        )
    erased = erase_party(session, event, guest, actor) if choice == "erase" else []
    erase_guest(session, event, guest, actor)
    return erased if choice is not None else None
