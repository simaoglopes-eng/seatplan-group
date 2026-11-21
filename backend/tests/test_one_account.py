"""One sign-up, two identities: bookings (guest account) and work (organiser).

POST /account/register starts a sign-up with no event; /guest/verify then
makes both the guest account and, when none exists yet, the work account with
the same address, name and password. /account/login answers with whichever
identities the password opens, and /account/work lists what the person runs.
"""

from typing import Any

import pytest
from conftest import TEST_PASSWORD, auth_header, make_user
from fastapi.testclient import TestClient
from guest_helpers import GUEST_PASSWORD, bearer, make_account
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.events_service import accounts
from app.models import EmailCode, Organiser, Venue
from app.security import hash_password, verify_guest_session, verify_session_token


def _register(client: TestClient, email: str, **extra: Any) -> Any:
    body = {"name": "Nora Novak", "email": email, "password": GUEST_PASSWORD, "consent": True}
    return client.post("/api/account/register", json={**body, **extra})


def _verify(client: TestClient, email: str, sent: Any) -> Any:
    body = {"email": email, "code": sent.json()["demo_code"], "signup_id": sent.json()["signup_id"]}
    return client.post("/api/guest/verify", json=body)


def test_one_sign_up_makes_both_identities(client: TestClient, session: Session) -> None:
    sent = _register(client, "nora@example.com")
    assert sent.status_code == 202, sent.text
    assert sorted(sent.json()) == [
        "demo_code",
        "expires_in_seconds",
        "sent_to",
        "signup_id",
        "status",
    ]
    pending = session.scalars(select(EmailCode).where(EmailCode.email == "nora@example.com")).one()
    assert pending.purpose == "register" and pending.event_id is None

    verified = _verify(client, "nora@example.com", sent)
    assert verified.status_code == 201, verified.text
    data = verified.json()
    assert data["join"] == {"status": "account_only", "event_id": None}
    assert verify_guest_session(data["token"]) is not None
    work = data["work"]
    assert work["user"] == {"email": "nora@example.com", "name": "Nora Novak", "role": "organiser"}
    user_id = verify_session_token(work["token"])
    user = session.get(Organiser, user_id)
    assert user is not None and user.email == "nora@example.com"
    assert client.get("/api/account/work", headers=bearer(work["token"])).status_code == 200
    assert client.get("/api/guest/me", headers=bearer(data["token"])).status_code == 200


def test_verify_never_touches_an_existing_work_account(
    client: TestClient, session: Session
) -> None:
    owner = make_user(session, "owner.first@example.com")
    before = owner.password_hash
    sent = _register(client, "owner.first@example.com")
    verified = _verify(client, "owner.first@example.com", sent)
    assert verified.status_code == 201, verified.text
    assert "work" not in verified.json()
    session.refresh(owner)
    assert owner.password_hash == before and owner.name == "Test Person"


def test_register_answers_the_same_for_an_existing_account(
    client: TestClient, session: Session
) -> None:
    make_account(session, "taken@example.com")
    taken = _register(client, "taken@example.com")
    fresh = _register(client, "fresh.person@example.com")
    assert taken.status_code == fresh.status_code == 202
    assert sorted(taken.json()) == sorted(set(fresh.json()) - {"demo_code"})
    assert _register(client, "x@example.com", consent=False).status_code == 422
    assert _register(client, "y@example.com", password="short").status_code == 422
    assert _register(client, "z@example.com", needs_accessible=True).status_code == 422


def _login(client: TestClient, email: str, password: str) -> Any:
    return client.post("/api/account/login", json={"email": email, "password": password})


def test_login_returns_only_the_identities_the_password_opens(
    client: TestClient, session: Session
) -> None:
    # Both identities with the same password.
    make_user(session, "both@example.com")
    make_account(session, "both@example.com")
    both = _login(client, "both@example.com", TEST_PASSWORD)
    assert both.status_code == 200, both.text
    assert sorted(both.json()) == ["guest", "work"]
    assert verify_guest_session(both.json()["guest"]["token"]) is not None
    assert verify_session_token(both.json()["work"]["token"]) is not None
    assert both.json()["work"]["user"]["email"] == "both@example.com"
    assert both.json()["guest"]["account"]["email"] == "both@example.com"

    # Only a guest account.
    make_account(session, "guest.only@example.com")
    assert sorted(_login(client, "guest.only@example.com", TEST_PASSWORD).json()) == ["guest"]

    # Both exist, but the password opens only the work account.
    make_user(session, "split@example.com")
    split_account = make_account(session, "split@example.com")
    split_account.password_hash = hash_password("another password entirely")
    session.commit()
    assert sorted(_login(client, "split@example.com", TEST_PASSWORD).json()) == ["work"]
    assert sorted(_login(client, "split@example.com", "another password entirely").json()) == [
        "guest"
    ]

    # Neither: one message, whatever exists.
    for email in ("both@example.com", "nobody@example.com"):
        wrong = _login(client, email, "wrong password here")
        assert wrong.status_code == 401
        assert wrong.json()["error"]["message"] == "Email or password is not correct."


def test_login_obeys_the_guest_failed_login_caps(
    client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(accounts, "FAILED_LOGINS_PER_HOUR", 2)
    make_user(session, "capped@example.com")
    for _ in range(2):
        assert _login(client, "capped@example.com", "wrong password here").status_code == 401
    # Even the right password is refused now, before it is checked.
    assert _login(client, "capped@example.com", TEST_PASSWORD).status_code == 429


def test_work_lists_what_the_person_runs_with_their_role(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    owned = Venue(organiser_id=organiser.id, kind="restaurant", name="Mine", width=1, height=1)
    other_owner = make_user(session, "boss@example.com")
    staffed = Venue(
        organiser_id=other_owner.id, kind="restaurant", name="Theirs", width=1, height=1
    )
    hall = Venue(
        organiser_id=other_owner.id,
        kind="event",
        name="Their hall",
        width=1,
        height=1,
        venue_type="hall",
    )
    elsewhere = Venue(organiser_id=other_owner.id, kind="restaurant", name="Not", width=1, height=1)
    session.add_all([owned, staffed, hall, elsewhere])
    session.commit()
    boss = auth_header(other_owner)
    for venue in (staffed, hall):
        answer = client.post(
            f"/api/owner/venues/{venue.public_id}/members",
            headers=boss,
            json={"email": organiser.email},
        )
        assert answer.status_code == 201, answer.text
    work = client.get("/api/account/work", headers=auth_header(organiser))
    assert work.status_code == 200, work.text
    body = work.json()
    assert body["user"]["email"] == organiser.email
    assert [(r["name"], r["role"]) for r in body["restaurants"]] == [
        ("Mine", "owner"),
        ("Theirs", "staff"),
    ]
    assert [(v["name"], v["role"], v["venue_type"]) for v in body["event_venues"]] == [
        ("Their hall", "staff", "hall")
    ]
    assert body["events"] == []
