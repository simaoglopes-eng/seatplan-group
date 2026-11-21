"""A table booked while signed in belongs to that account at once.

/account promises that a table booked at a restaurant shows under Booking.
Older bookings are claimed by email only once the address is proven (an
emailed code, diner_accounts.claim_bookings). A booking made in a signed-in
session needs no such proof: the session itself shows who made it. So
POST /r/{vid}/bookings links it to the account when a valid guest session is
sent and the booking's email is the account's own. Anything else (no token,
a bad or ended one, a work token, another address) books exactly as before,
anonymously: never a 401.
"""

from itertools import cycle
from typing import Any

from conftest import auth_header
from fastapi.testclient import TestClient
from guest_helpers import account_headers, make_account
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_restaurant_helpers import future_day, hold, make_restaurant

from app.models import Booking, Organiser

TIMES = cycle(["12:00", "13:00", "14:00", "19:00", "20:00", "21:00"])


def _book(client: TestClient, place: Any, email: str, headers: dict[str, str] | None = None) -> str:
    """Hold and book a table for two (a new hour each time); the booking's public id."""
    held = hold(client, place, future_day(), next(TIMES), 2)
    assert held.status_code == 201, held.text
    body = {"hold_id": held.json()["hold_id"], "party": 2, "name": "Gina", "email": email}
    booked = client.post(f"/api/r/{place.public_id}/bookings", json=body, headers=headers or {})
    assert booked.status_code == 201, booked.text
    return str(booked.json()["booking"]["id"])


def _account_of(session: Session, public_id: str) -> int | None:
    session.expire_all()
    return session.scalars(select(Booking.account_id).where(Booking.public_id == public_id)).one()


def test_a_booking_made_while_signed_in_is_in_that_accounts_bookings(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    gina = make_account(session, "gina@example.com")
    gina.email_proven = False  # the demo code was shown on screen
    session.commit()
    headers = account_headers(gina)

    booking = _book(client, place, " Gina@Example.com ", headers)
    assert _account_of(session, booking) == gina.id
    listed = client.get("/api/diner/bookings", headers=headers).json()
    assert [item["id"] for item in listed["items"]] == [booking]


def test_any_other_booking_stays_anonymous(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    place = make_restaurant(session, organiser)
    gina = make_account(session, "gina@example.com")
    gina.email_proven = False
    session.commit()

    # Booking for someone else's address: their booking, not Gina's.
    other = _book(client, place, "friend@example.com", account_headers(gina))
    assert _account_of(session, other) is None
    # No token, a made-up one, and a work session: anonymous, and still booked.
    plain = _book(client, place, "gina@example.com")
    forged = _book(client, place, "gina@example.com", {"Authorization": "Bearer guest.1.0.9.x"})
    work = _book(client, place, "gina@example.com", auth_header(organiser))
    assert [_account_of(session, b) for b in (plain, forged, work)] == [None, None, None]
    # A session that ended (signed out everywhere) is no longer Gina.
    ended = account_headers(gina)
    gina.session_version += 1
    session.commit()
    assert _account_of(session, _book(client, place, "gina@example.com", ended)) is None
    # Nothing was claimed on the side either: the address is still unproven.
    assert client.get("/api/diner/bookings", headers=account_headers(gina)).json()["items"] == []
