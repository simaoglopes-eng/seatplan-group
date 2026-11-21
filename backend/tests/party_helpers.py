"""Helpers for the party booking tests (not a test file itself).

A "door" is how a booker reaches their page: the personal link
(/api/a/{token}) or a signed-in guest account (/api/guest/events/{eid}).
Both doors call the same service code, so most tests run through both.
"""

from dataclasses import dataclass, field
from typing import Any

from fastapi.testclient import TestClient
from guest_helpers import bearer, shared_event, sign_up
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_events_setup import EventSetup, make_event

from app.models import AuditLog, Guest, Organiser, SeatAssignment


@dataclass
class Door:
    base: str
    headers: dict[str, str] = field(default_factory=dict)

    def get(self, client: TestClient, path: str = "") -> Any:
        return client.get(f"{self.base}{path}", headers=self.headers)

    def post(self, client: TestClient, path: str, body: Any) -> Any:
        return client.post(f"{self.base}{path}", headers=self.headers, json=body)

    def patch(self, client: TestClient, path: str, body: Any) -> Any:
        return client.patch(f"{self.base}{path}", headers=self.headers, json=body)

    def put(self, client: TestClient, path: str, body: Any) -> Any:
        return client.put(f"{self.base}{path}", headers=self.headers, json=body)

    def delete(self, client: TestClient, path: str) -> Any:
        return client.delete(f"{self.base}{path}", headers=self.headers)

    def confirm(self, client: TestClient, body: dict[str, Any]) -> Any:
        return self.post(client, "/party/confirm", body)

    def page(self, client: TestClient) -> dict[str, Any]:
        response = self.get(client)
        assert response.status_code == 200, response.text
        return response.json()


def link_door(setup: EventSetup, name: str) -> Door:
    return Door(f"/api/a/{setup.tokens[name]}")


def account_door(
    client: TestClient,
    organiser: Organiser,
    email: str = "kai.account@example.com",
    name: str = "Kai Lobo",
    invited: list[dict[str, Any]] | None = None,
    **kwargs: Any,
) -> tuple[EventSetup, Door, str]:
    """An event with its shared link on and one account that joined it.

    Returns the set-up, the account's door and the raw account session token.
    """
    setup, token = shared_event(client, organiser, invited or [], **kwargs)
    session_token = sign_up(client, token, email, name=name)["token"]
    return setup, Door(f"/api/guest/events/{setup.eid}", bearer(session_token)), session_token


def person(seat_id: int, first: str, last: str, age: Any) -> dict[str, Any]:
    return {"seat_id": seat_id, "first_name": first, "last_name": last, "age": age}


def party_body(
    my_seat: int,
    members: list[dict[str, Any]] | None = None,
    first: str = "Ana",
    last: str = "Silva",
    age: Any = 40,
) -> dict[str, Any]:
    me: dict[str, Any] = {"seat_id": my_seat, "first_name": first, "last_name": last}
    if age is not None:
        me["age"] = age
    return {"me": me, "members": members or []}


def counts(session: Session) -> tuple[int, int, int]:
    """(guests, seat_assignments, audit_log) rows: proof that nothing was written."""
    session.expire_all()
    return (
        session.scalar(select(func.count()).select_from(Guest)) or 0,
        session.scalar(select(func.count()).select_from(SeatAssignment)) or 0,
        session.scalar(select(func.count()).select_from(AuditLog)) or 0,
    )


def companions(session: Session, booker_id: int) -> list[Guest]:
    session.expire_all()
    query = select(Guest).where(Guest.booked_by_guest_id == booker_id).order_by(Guest.id)
    return list(session.scalars(query))


def seat_of(page: dict[str, Any], seat_id: int) -> dict[str, Any]:
    return next(seat for seat in page["map"]["seats"] if seat["id"] == seat_id)


def invited_event(
    client: TestClient, organiser: Organiser, names: list[str], **kwargs: Any
) -> EventSetup:
    guests = [{"name": n, "email": f"{n.split()[0].lower()}@example.com"} for n in names]
    return make_event(client, organiser, guests, **kwargs)
