"""The Layout tab: one-click room setups for one event, on its own copy of the room.

GET /events/{eid}/layouts (`overview`) lists the seven setups of
layout_presets.py fitted to the event's hall or quinta, each with a small
preview and its capacity, and says which one the event uses now.

POST /events/{eid}/layout (`apply_preset`) gives the event a private copy of
the hall (a "setup" venue: kind event, draft, no slug, `parent_venue_id` set)
holding the new tables and seats. Other events at the same hall keep the
hall's own plan or their own copies, so changing one event never changes
another. Names, public pages and the venue team stay the hall's
(core/parent_venue.py).

Applying with guests already seated (contract with the page):
- without `confirm`: 409 `guests_seated`, nothing changes;
- with `confirm`: under the event lock, every seated guest is re-seated on the
  new room by the optimiser (groups and acquaintances kept as auto-fill does);
  anyone who cannot fit loses their seat and is counted; holds on the old
  seats are dropped; each guest whose seat changed gets the usual seat email
  (the "seat changed" one, or "seat cancelled" for those who did not fit);
  old plans and scenarios, which name seats that no longer exist, are retired
  and a fresh history starts.

The previous copy, if any, is removed after the emails are written (they read
the old seat's label), and the new copy takes over its public id, so the
editor link stays the same.
"""

from typing import Any

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import ApiError
from app.core.layout import rebuild_neighbours
from app.core.parent_venue import shown_venue
from app.events_service import plans
from app.events_service.access import event_scope, load_venue
from app.events_service.layout_presets import (
    PRESET_KEYS,
    PRESETS,
    PresetLayout,
    PresetSeat,
    build,
    matches,
)
from app.events_service.mailer import queue_seat_email, sync_reminder
from app.events_service.problem import (
    HUMAN_SOURCES,
    active_guests,
    build_problem,
    current_rows,
    venue_seats,
)
from app.events_service.seating import lock_event, queue_change_email
from app.models import (
    Event,
    Guest,
    Hold,
    PlanSnapshot,
    Seat,
    SeatAssignment,
    SeatNeighbour,
    Venue,
    VenueTable,
    Zone,
    utc_now,
)
from app.optimiser.events_anneal import solve

# Same search as the organiser's auto-fill default (schemas.OptimiseIn).
RESEAT_SEED = 0
RESEAT_ITERATIONS = 20000
RETIRED = "retired"


def _rooms(session: Session, event: Event) -> tuple[Venue, Venue]:
    """(the venue holding the event's map now, the hall or quinta it belongs to)."""
    room = load_venue(session, event)
    hall = shown_venue(session, room) or room
    return room, hall


def _capacity(session: Session, venue_id: int) -> int:
    count = session.scalar(
        select(func.count())
        .select_from(Seat)
        .where(Seat.venue_id == venue_id, Seat.is_blocked.is_(False))
    )
    return int(count or 0)


def current_preset(session: Session, room: Venue) -> str:
    """The preset this room still is, by its geometry, else "custom".

    A hall's own plan is always "custom": only an event's setup copy can be a
    preset. A save in the editor that moves nothing keeps the preset.
    """
    if room.parent_venue_id is None:
        return "custom"
    tables = session.scalars(select(VenueTable).where(VenueTable.venue_id == room.id)).all()
    seats = session.scalars(select(Seat).where(Seat.venue_id == room.id)).all()
    table_rows = [(t.shape, t.x, t.y, t.w, t.h, t.rotation) for t in tables]
    seat_rows = [(s.x, s.y) for s in seats]
    for key in PRESET_KEYS:
        if matches(build(key, room.width, room.height), table_rows, seat_rows):
            return key
    return "custom"


def _preview_seat(seat: PresetSeat) -> dict[str, Any]:
    """Only a step-free seat carries `accessible` (true), to keep previews small."""
    found: dict[str, Any] = {"x": round(seat.x), "y": round(seat.y)}
    if seat.accessible:
        found["accessible"] = True
    return found


def _step_free(layout: PresetLayout) -> int:
    return sum(seat.accessible for table in layout.tables for seat in table.seats)


def preview(layout: PresetLayout) -> dict[str, Any]:
    """A thumbnail's worth: whole centimetres, no labels, no ids."""
    return {
        "width": round(layout.width),
        "height": round(layout.height),
        "zones": [
            {"kind": z.kind, "x": round(z.x), "y": round(z.y), "w": round(z.w), "h": round(z.h)}
            for z in layout.zones
        ],
        "tables": [
            {
                "shape": t.shape,
                "x": round(t.x),
                "y": round(t.y),
                "w": round(t.w),
                "h": round(t.h),
                "rotation": round(t.rotation),
                "seats": [_preview_seat(s) for s in t.seats],
            }
            for t in layout.tables
        ],
    }


def overview(session: Session, event: Event) -> dict[str, Any]:
    room, hall = _rooms(session, event)
    presets = []
    for key in PRESET_KEYS:
        layout = build(key, hall.width, hall.height)
        presets.append(
            {
                "key": key,
                "label": PRESETS[key].label,
                "description": PRESETS[key].description,
                "capacity": layout.capacity,
                "preview": preview(layout),
            }
        )
    return {
        "current": current_preset(session, room),
        "own_layout": room.parent_venue_id is not None,
        # The venue holding the event's map: open this one in the editor.
        "venue_id": room.public_id,
        "capacity": _capacity(session, room.id),
        "guests": len(active_guests(session, event)),
        "seated": len(current_rows(session, event)),
        "presets": presets,
    }


# ---------------------------------------------------------------- the copy


def _write_layout(session: Session, venue: Venue, layout: PresetLayout) -> None:
    for zone in layout.zones:
        session.add(
            Zone(
                venue_id=venue.id,
                name=zone.name,
                kind=zone.kind,
                x=zone.x,
                y=zone.y,
                w=zone.w,
                h=zone.h,
            )
        )
    for item in layout.tables:
        table = VenueTable(
            venue_id=venue.id,
            label=item.label,
            shape=item.shape,
            x=item.x,
            y=item.y,
            w=item.w,
            h=item.h,
            rotation=item.rotation,
            max_party=len(item.seats),
            is_accessible=any(seat.accessible for seat in item.seats),
        )
        session.add(table)
        session.flush()
        session.add_all(
            Seat(
                venue_id=venue.id,
                table_id=table.id,
                label=seat.label,
                x=seat.x,
                y=seat.y,
                is_accessible=seat.accessible,
            )
            for seat in item.seats
        )
    session.flush()
    rebuild_neighbours(session, venue.id)


def new_setup(session: Session, event: Event, hall: Venue, layout: PresetLayout) -> Venue:
    """A private copy of the hall holding `layout`. Does not move the event. No commit."""
    copy = Venue(
        organiser_id=hall.organiser_id,
        kind="event",
        name=f"{event.name}: room setup"[:120],
        timezone=hall.timezone,
        width=hall.width,
        height=hall.height,
        status="draft",
        is_demo=hall.is_demo,
        parent_venue_id=hall.id,
    )
    session.add(copy)
    session.flush()
    _write_layout(session, copy, layout)
    return copy


def _remove_copy(session: Session, copy: Venue) -> None:
    """Delete an old setup copy that no event uses any more. Children first."""
    seat_ids = select(Seat.id).where(Seat.venue_id == copy.id)
    session.execute(
        delete(SeatNeighbour).where(
            or_(SeatNeighbour.seat_id.in_(seat_ids), SeatNeighbour.neighbour_id.in_(seat_ids))
        )
    )
    for model in (Seat, VenueTable, Zone):
        session.execute(delete(model).where(model.venue_id == copy.id))
    session.delete(copy)
    session.flush()


# ---------------------------------------------------------------- applying


def _plural(count: int, word: str) -> str:
    return f"{count} {word}" if count == 1 else f"{count} {word}s"


def _step_free_loss(label: str, details: dict[str, int]) -> str:
    """The sentence for seated guests who need a step-free seat the setup lacks, or ""."""
    short = details["accessible_needed"] - details["accessible_seats"]
    if short <= 0:
        return ""
    have = details["accessible_seats"]
    seats = "Only 1 seat" if have == 1 else ("No seat" if have == 0 else f"Only {have} seats")
    verb = "is" if have <= 1 else "are"
    need = "needs" if short == 1 else "need"
    return (
        f" {seats} in the {label} setup {verb} step-free, so at least "
        f"{_plural(short, 'guest')} who {need} one will lose their seat."
    )


def _check(key: str, layout: PresetLayout, facts: dict[str, int], confirm: bool) -> dict[str, int]:
    """Refuse before any write, with the counts the confirm step shows (`details`).

    `facts`: seated, guests (coming), accessible_needed (seated guests who need
    a step-free seat: a hard rule for the re-seat), holding (seats someone is
    choosing right now; those holds are dropped).
    """
    label = PRESETS[key].label
    seated, coming = facts["seated"], facts["guests"]
    details = {
        "seated": seated,
        "capacity": layout.capacity,
        "guests": coming,
        "accessible_needed": facts["accessible_needed"],
        "accessible_seats": _step_free(layout),
        "holding": facts["holding"],
    }
    if layout.capacity == 0:
        raise ApiError(
            422,
            "too_small",
            f"This room is too small for the {label} setup. Choose another setup.",
        )
    if seated and not confirm:
        verb = "has" if seated == 1 else "have"
        raise ApiError(
            409,
            "guests_seated",
            f"{_plural(seated, 'guest')} already {verb} a seat. Applying the {label} setup "
            "will re-seat them on the new layout and email anyone whose seat changes."
            + _step_free_loss(label, details),
            details,
        )
    if layout.capacity < coming and not confirm:
        raise ApiError(
            422,
            "not_enough_seats",
            f"The {label} setup has {_plural(layout.capacity, 'seat')} but "
            f"{_plural(coming, 'guest')} {'is' if coming == 1 else 'are'} coming. "
            "Choose a larger setup, or confirm to seat as many as fit.",
            details,
        )
    return details


def _facts(
    session: Session, event: Event, rows: dict[int, SeatAssignment], coming: list[Guest]
) -> dict[str, int]:
    holding = session.scalar(
        select(func.count())
        .select_from(Hold)
        .where(Hold.scope == event_scope(event), Hold.expires_at > utc_now())
    )
    return {
        "seated": len(rows),
        "guests": len(coming),
        "accessible_needed": sum(g.needs_accessible for g in coming if g.id in rows),
        "holding": int(holding or 0),
    }


def _retire_plans(session: Session, event: Event) -> None:
    """Old scenarios and undo steps name seats of the old room: keep them, unused."""
    for snapshot in session.scalars(select(PlanSnapshot).where(PlanSnapshot.event_id == event.id)):
        if snapshot.assignments.get("kind") != RETIRED:
            # A new dict, so the JSON column notices the change.
            snapshot.assignments = {**snapshot.assignments, "kind": RETIRED}
        snapshot.is_current = False
    session.flush()


def _place(session: Session, seat: Seat | None) -> tuple[Any, ...] | None:
    """What a guest reads and sees of a seat: table label, seat label, position."""
    if seat is None:
        return None
    table = session.get(VenueTable, seat.table_id) if seat.table_id else None
    return (table.label if table else None, seat.label, round(seat.x), round(seat.y))


def _tell(
    session: Session,
    event: Event,
    guest: Guest,
    old_seat_id: int,
    new_seat_id: int | None,
    actor: str,
) -> None:
    """One audit row and the guest's seat email for this re-seat. No commit.

    No email when the new seat has the old one's table, number and place (the
    same setup rebuilt after a tweak elsewhere): nothing changed for the guest.
    Their reminder still moves to the new seat row.
    """
    entry = audit.record(
        session,
        actor=actor,
        action="seat.layout_move" if new_seat_id else "seat.release",
        entity="guest",
        entity_id=str(guest.id),
        detail={"seat_id": new_seat_id, "old_seat_id": old_seat_id},
    )
    if new_seat_id is not None:
        seat = session.get(Seat, new_seat_id)
        assert seat is not None
        if _place(session, seat) == _place(session, session.get(Seat, old_seat_id)):
            sync_reminder(session, event, guest, seat)
            return
        queue_change_email(session, event, guest, seat, old_seat_id, entry, moved_by_organiser=True)
        return
    session.flush()  # gives the audit row its id, used in the email key below
    old_seat = session.get(Seat, old_seat_id)
    if old_seat is not None:
        key = f"seat-cancelled:{guest.id}:{old_seat.id}:{entry.id}"
        queue_seat_email(
            session, kind="seat_cancelled", key=key, guest=guest, event=event, seat=old_seat
        )
    sync_reminder(session, event, guest, None)


def apply_preset(
    session: Session, event: Event, key: str, confirm: bool, actor: str
) -> dict[str, Any]:
    """Put the event on a fresh copy of its hall laid out as `key`. No commit.

    Raises 409 conflict (this setup is already in use), 422 too_small, 409
    guests_seated or 422 not_enough_seats (see the module docstring) before
    writing anything.
    """
    # lock_event reads the event's room again: a second apply that waited at
    # the lock must see the copy the first one made, not the one it removed.
    lock_event(session, event)
    room, hall = _rooms(session, event)
    if current_preset(session, room) == key:
        # Re-applying would only move everyone to identical seats and email them.
        raise ApiError(
            409, "conflict", f"The {PRESETS[key].label} setup is already in use. Nothing changed."
        )
    layout = build(key, hall.width, hall.height)
    rows = current_rows(session, event)
    coming = active_guests(session, event)
    _check(key, layout, _facts(session, event, rows, coming), confirm)

    copy = new_setup(session, event, hall, layout)
    old_seats = {guest_id: row.seat_id for guest_id, row in rows.items()}
    human = {guest_id for guest_id, row in rows.items() if row.source in HUMAN_SOURCES}
    session.execute(delete(Hold).where(Hold.scope == event_scope(event)))
    session.execute(delete(SeatAssignment).where(SeatAssignment.event_id == event.id))
    event.venue_id = copy.id
    session.flush()

    seated_guests = [guest for guest in coming if guest.id in old_seats]
    problem = build_problem(session, venue_seats(session, copy.id), seated_guests, {})
    result = solve(problem, seed=RESEAT_SEED, max_iterations=RESEAT_ITERATIONS)
    for guest_id, seat_id in sorted(result.assignment.items()):
        # A seat the guest or the organiser chose was a person's choice: the new
        # one stays protected from auto-fill as an organiser placement.
        source = "organiser" if guest_id in human else "optimiser"
        session.add(
            SeatAssignment(event_id=event.id, guest_id=guest_id, seat_id=seat_id, source=source)
        )
    session.flush()
    for guest in seated_guests:
        _tell(session, event, guest, old_seats[guest.id], result.assignment.get(guest.id), actor)

    _retire_plans(session, event)
    plans.push_history(session, event, f"Room set up as {PRESETS[key].label}")
    if room.parent_venue_id is not None:
        old_public_id = room.public_id
        _remove_copy(session, room)
        copy.public_id = old_public_id  # the editor link stays the same
        session.flush()
    return {
        **overview(session, event),
        "applied": key,
        "reseated": len(result.assignment),
        "unseated": len(seated_guests) - len(result.assignment),
    }
