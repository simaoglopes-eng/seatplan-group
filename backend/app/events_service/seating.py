"""Event seat confirmation and release.

Selecting a seat in the UI is non-exclusive. Confirmation takes the event
write lock and inserts or updates the assignment; the database unique
constraint is the final guard against two guests getting the same seat.
All event writes take the same lock first to prevent deadlocks.
"""

from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import audit, live
from app.core.errors import ApiError, SeatTaken
from app.core.holds import commit_or_seat_taken
from app.events_service.access import event_scope, require_before_deadline
from app.events_service.mailer import queue_seat_email, sync_reminder
from app.events_service.problem import current_rows, guest_specs, seat_spec
from app.events_service.seatmap import holder_key
from app.models import AuditLog, Event, Guest, Hold, Seat, SeatAssignment, utc_now
from app.optimiser.events_model import seat_allows


def lock_event(session: Session, event: Event) -> None:
    """Take the event's write lock: call this before any other write.

    Bumping the live version updates one row per event, and Postgres lets only
    one open transaction update a row. Doing it first gives every transaction
    on the event the same lock order. It also tells listeners about the change
    when we commit, so later bumps in the same transaction are not needed.

    The event's room is read again once the lock is held: a room setup
    (layouts.py) moves the event to another venue, and a request that loaded
    the event before that commit would otherwise check seats against the old
    room. Only `venue_id` is reloaded, so field changes the caller made before
    the lock are kept. Read seats and other room data after this call.
    """
    live.bump(session, event_scope(event))
    session.refresh(event, ["venue_id"])


GUEST_GONE = "Guest not found."


def recheck_after_lock(session: Session, guest: Guest) -> None:
    """Read the acting guest again now that the event lock is held. Call it
    straight after lock_event, before writing anything on the guest.

    The route found the guest before the lock (by link or by account). While
    the request waited for the lock, the organiser may have erased the row or
    given it a new link, or the account may have left the event. Writing on
    the old copy would put names, an age and a seat back on an erased row,
    where nobody can see or delete them again. So the row must still be the
    one the caller proved they own: not erased, same link, same account.
    """
    proved = (guest.token_hash, guest.account_id)
    session.refresh(guest)
    if guest.token_revoked_at is not None or (guest.token_hash, guest.account_id) != proved:
        raise ApiError(404, "not_found", GUEST_GONE)


def taken_message(seat: Seat) -> str:
    return (
        f"Seat {seat.label} was just taken by someone else. "
        "Please choose another seat; the map shows what is still free."
    )


def seat_for_guest(session: Session, event: Event, guest: Guest, seat_id: int) -> Seat:
    """The seat, if it belongs to this event's venue and the hard rules allow it."""
    seat = session.get(Seat, seat_id)
    if seat is None or seat.venue_id != event.venue_id:
        raise ApiError(404, "not_found", "Seat not found.")
    # The same per-seat rules the optimiser uses (blocked, reserved, accessible).
    if not seat_allows(seat_spec(seat), guest_specs(session, [guest])[0]):
        raise ApiError(409, "conflict", "This seat is not available to you. Please pick another.")
    return seat


def _owned_by_other(session: Session, event: Event, guest: Guest, seat: Seat) -> bool:
    rows = current_rows(session, event).values()
    return any(row.seat_id == seat.id and row.guest_id != guest.id for row in rows)


def require_coming(guest: Guest) -> None:
    if guest.rsvp == "no":
        raise ApiError(409, "conflict", "You said you are not coming. Answer yes first.")


def hold_seat(session: Session, event: Event, guest: Guest, seat_id: int) -> Hold:
    """Reject obsolete clients that assume a selection reserves a seat."""
    raise ApiError(
        410,
        "hold_removed",
        "Seat holds are no longer used. Update the page and confirm your selection.",
    )


def confirm_seat(
    session: Session, event: Event, guest: Guest, seat_id: int, token: str | None = None
) -> SeatAssignment:
    """Assign the seat to the first guest to confirm. Changing seat frees the old one at once.

    `token` is the guest's own link token, so their email can link straight back.
    The guest's first name, last name and age must be saved first (422
    details_required); the page sends them with POST .../party/confirm.
    """
    # Imported here: party.py imports this module.
    from app.events_service.party import require_details

    require_before_deadline(event)
    require_coming(guest)
    lock_event(session, event)
    recheck_after_lock(session, guest)  # erased or answered "no" meanwhile?
    require_coming(guest)
    seat = seat_for_guest(session, event, guest, seat_id)  # after the lock: the room in use
    # The event lock serialises confirmations; uniqueness remains the final guard.
    # A preview is never exclusive, and confirmation does not require one.
    if _owned_by_other(session, event, guest, seat):
        raise SeatTaken(taken_message(seat))
    # Every chosen seat carries a first name, a last name and an age (party.py).
    # Checked after the seat, so a taken seat still answers "seat_taken".
    require_details(guest)
    row = current_rows(session, event).get(guest.id)
    old_seat_id = row.seat_id if row else None
    if row is None:
        row = SeatAssignment(event_id=event.id, guest_id=guest.id, seat_id=seat.id, source="self")
        session.add(row)
    else:
        # An UPDATE of the same row: the old seat is released in this very
        # transaction, and the UNIQUE constraint checks the new one.
        row.seat_id = seat.id
        row.source = "self"
        row.created_at = utc_now()
    flush_or_seat_taken(session, seat)  # the UNIQUE constraints decide right here
    entry = _audit(session, guest, "seat.confirm", seat, {"old_seat_id": old_seat_id})
    queue_change_email(session, event, guest, seat, old_seat_id, entry, token)
    commit_or_seat_taken(session)
    return row


def queue_change_email(
    session: Session,
    event: Event,
    guest: Guest,
    seat: Seat,
    old_seat_id: int | None,
    entry: AuditLog,
    token: str | None = None,
    moved_by_organiser: bool = False,
) -> None:
    """Queue "seat confirmed" or "seat changed" after a seat write, and move the
    guest's reminder to the new seat. No commit.

    Nothing is queued when the seat did not change: that check is also what
    stops a repeated confirm from sending a second email. The audit row's id
    (`entry`, one row per seat action) only makes the key unique per action,
    so two real moves to the same seat never share a key.
    """
    if old_seat_id == seat.id:
        return
    session.flush()  # gives the audit row its id, used in the email key below
    kind = "seat_confirmed" if old_seat_id is None else "seat_changed"
    key = f"seat-{kind}:{guest.id}:{seat.id}:{entry.id}"
    old_seat = session.get(Seat, old_seat_id) if old_seat_id else None
    queue_seat_email(
        session,
        kind=kind,
        key=key,
        guest=guest,
        event=event,
        seat=seat,
        old_seat=old_seat,
        token=token,
        moved_by_organiser=moved_by_organiser,
    )
    sync_reminder(session, event, guest, seat, token)


def release_seat(session: Session, event: Event, guest: Guest, token: str | None = None) -> None:
    """The guest gives their seat back. Refused while their party members are coming."""
    # Imported here: party.py imports this module.
    from app.events_service.party import refuse_while_party_coming

    require_before_deadline(event)
    lock_event(session, event)  # the party is counted under the lock (drop_assignment locks too)
    refuse_while_party_coming(session, guest)
    if not drop_assignment(session, event, guest, actor=f"guest:{guest.id}", token=token):
        raise ApiError(404, "not_found", "You do not have a seat to release.")
    session.commit()


def drop_assignment(
    session: Session,
    event: Event,
    guest: Guest,
    actor: str,
    token: str | None = None,
    notify: bool = True,
) -> bool:
    """Lock the event, delete the guest's seat and holds, audit, queue the emails. No commit.

    Returns False when the guest had no seat (holds are still dropped).
    `token` is the guest's own link token when the guest is the one acting.
    `notify=False` sends no "seat released" email (a guest deleting their
    account asked us to stop writing); the reminder is cancelled either way.
    """
    lock_event(session, event)
    session.execute(
        delete(Hold).where(
            (Hold.scope == event_scope(event)) & (Hold.holder_key == holder_key(guest))
        )
    )
    row = current_rows(session, event).get(guest.id)
    if row is None:
        return False
    seat = session.get(Seat, row.seat_id)
    session.delete(row)
    entry = audit.record(
        session,
        actor=actor,
        action="seat.release",
        entity="guest",
        entity_id=str(guest.id),
        detail={"seat_id": row.seat_id},
    )
    session.flush()  # gives the audit row its id, used in the email key below
    if seat is not None and notify:
        key = f"seat-cancelled:{guest.id}:{seat.id}:{entry.id}"
        kind = "seat_cancelled"
        queue_seat_email(
            session, kind=kind, key=key, guest=guest, event=event, seat=seat, token=token
        )
    sync_reminder(session, event, guest, None, token)
    return True


def _audit(
    session: Session,
    guest: Guest,
    action: str,
    seat: Seat,
    extra: dict[str, int | None] | None = None,
) -> AuditLog:
    return audit.record(
        session,
        actor=f"guest:{guest.id}",
        action=action,
        entity="seat",
        entity_id=str(seat.id),
        detail={"guest_id": guest.id, **(extra or {})},
    )


def flush_or_seat_taken(session: Session, seat: Seat) -> None:
    """Send the seat write to the database now and turn a UNIQUE clash into 409.

    We flush straight after changing the seat row, before anything else runs a
    query: SQLAlchemy would otherwise flush on that query and the clash would
    surface somewhere unexpected.
    """
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise SeatTaken(taken_message(seat)) from None
