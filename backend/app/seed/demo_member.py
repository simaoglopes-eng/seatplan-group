"""The "one account" demo: Rita Rossi is staff at two venues and books at two others.

- Work account rita@example.com (created by seed/run.ensure_demo_users).
- A member of Casa Lumen (restaurant) and of Quinta da Serra Azul (event venue),
  added by the demo organiser who owns both.
- A guest account with the same address and password, with:
  - a dinner for two at Tagus Terrace in three days (a showcase restaurant);
  - a seat she chose at the Lisbon Product Conference (Tagus Forum).
So one sign-in (POST /account/login) opens her staff pages at A and her
bookings at B.

seed() runs after the vertical seeds (it looks their venues up by name, the
newest of each), does not commit, sends no email, and returns no links.
"""

from datetime import time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.events_service.problem import venue_seats
from app.models import (
    Booking,
    Event,
    Guest,
    GuestAccount,
    Organiser,
    SeatAssignment,
    Venue,
    VenueMember,
    VenueTable,
    utc_now,
)
from app.restaurant_service import booking_rows
from app.restaurant_service.clock import now_local
from app.restaurant_service.schedule import window_for
from app.security import hash_password, hash_token, new_token
from app.seed.demo_events import DEMO_ORGANISER_EMAIL

DEMO_MEMBER_EMAIL = "rita@example.com"
DEMO_MEMBER_NAME = "Rita Rossi"
CONSENT_VERSION = "2026-11-10"  # the guest accounts' version (events_service/accounts.py)


def _newest(session: Session, kind: str, name: str) -> Venue:
    venue = session.scalars(
        select(Venue)
        .where(Venue.kind == kind, Venue.name == name, Venue.parent_venue_id.is_(None))
        .order_by(Venue.id.desc())
    ).first()
    if venue is None:
        raise RuntimeError(f"Seed {name} before the member demo.")
    return venue


def _member(session: Session, venue: Venue, owner: Organiser) -> None:
    found = session.scalars(
        select(VenueMember).where(
            VenueMember.venue_id == venue.id, VenueMember.email == DEMO_MEMBER_EMAIL
        )
    ).first()
    if found is None:
        session.add(
            VenueMember(venue_id=venue.id, email=DEMO_MEMBER_EMAIL, role="staff", added_by=owner.id)
        )


def _guest_account(session: Session, password: str) -> GuestAccount:
    """Create her guest account, or reset its name and password (a second seed)."""
    account = session.scalars(
        select(GuestAccount).where(GuestAccount.email == DEMO_MEMBER_EMAIL)
    ).first()
    if account is None:
        account = GuestAccount(
            email=DEMO_MEMBER_EMAIL,
            consent_at=utc_now(),
            consent_version=CONSENT_VERSION,
        )
        session.add(account)
    account.name = DEMO_MEMBER_NAME
    account.password_hash = hash_password(password)
    account.email_proven = True
    session.flush()
    return account


def _dinner(session: Session, account: GuestAccount) -> None:
    """Dinner for two at Tagus Terrace, three days from today, 20:00."""
    venue = _newest(session, "restaurant", "Tagus Terrace")
    day = now_local(venue).date() + timedelta(days=3)
    window = window_for(time(20, 0), 90)
    table = session.scalars(
        select(VenueTable)
        .where(
            VenueTable.venue_id == venue.id,
            VenueTable.min_party <= 2,
            VenueTable.max_party >= 2,
            VenueTable.is_active.is_(True),
        )
        .order_by(VenueTable.max_party, VenueTable.id)
    ).first()
    if table is None:
        raise RuntimeError("Tagus Terrace has no table for two.")
    booking = Booking(
        venue_id=venue.id,
        party_size=2,
        name=DEMO_MEMBER_NAME,
        email=DEMO_MEMBER_EMAIL,
        status="confirmed",
        source="diner",
        table_choice="auto",
        manage_token_hash=hash_token(new_token()),
        account_id=account.id,
    )
    booking_rows.set_times(venue, booking, day, window)
    session.add(booking)
    session.flush()
    booking_rows.write_slots(session, booking, (table.id,), window)


def _conference_seat(session: Session, account: GuestAccount) -> None:
    """She joined the Lisbon Product Conference with its public link and chose a seat."""
    event = session.scalars(
        select(Event).where(Event.name == "Lisbon Product Conference").order_by(Event.id.desc())
    ).first()
    if event is None:
        raise RuntimeError("Seed the event venues before the member demo.")
    guest = Guest(
        event_id=event.id,
        name=DEMO_MEMBER_NAME,
        email=DEMO_MEMBER_EMAIL,
        token_hash=hash_token(new_token()),
        source="self_registered",
        account_id=account.id,
        rsvp="yes",
    )
    session.add(guest)
    session.flush()
    taken = set(
        session.scalars(select(SeatAssignment.seat_id).where(SeatAssignment.event_id == event.id))
    )
    seat = next(
        seat
        for seat in venue_seats(session, event.venue_id)
        if seat.id not in taken and not seat.is_blocked and seat.reserved_tag is None
    )
    session.add(
        SeatAssignment(event_id=event.id, guest_id=guest.id, seat_id=seat.id, source="self")
    )
    session.flush()


def seed(session: Session, password: str) -> None:
    owner = session.scalars(
        select(Organiser).where(Organiser.email == DEMO_ORGANISER_EMAIL)
    ).first()
    if owner is None:
        raise RuntimeError("Create the demo users before the member demo.")
    _member(session, _newest(session, "restaurant", "Casa Lumen"), owner)
    _member(session, _newest(session, "event", "Quinta da Serra Azul"), owner)
    account = _guest_account(session, password)
    _dinner(session, account)
    _conference_seat(session, account)
    session.flush()
