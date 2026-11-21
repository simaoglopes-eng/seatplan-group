"""One account, one life: the work identity follows the guest account's password and deletion.

Review findings on the "one account" lot (plan 2026-11-18):
- a new password (an emailed code, never shown) changes the work password too
  and ends every older work session, whether the two identities were made by
  one sign-up (same hash) or apart (two hashes);
- deleting the account deletes a work identity that runs nothing, and keeps
  one that owns a venue or an event;
- someone who already had a guest account and is added to a venue's team gets
  the work identity when they sign in;
- the demo reset never leaves the two halves with two passwords;
- GET /events lists the organiser's own events first, then the member venues'.
"""

from datetime import UTC, datetime
from typing import Any

import pytest
from conftest import TEST_PASSWORD, auth_header, make_user
from fastapi.testclient import TestClient
from guest_helpers import GUEST_PASSWORD, bearer, make_account, use_inbox_code
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_events_setup import make_event

from app.config import get_settings
from app.models import Event, Organiser, Venue
from app.security import create_session_token, keyed_hash, verify_session_token

NEW_PASSWORD = "a brand new password"


def _login(client: TestClient, email: str, password: str) -> Any:
    return client.post("/api/account/login", json={"email": email, "password": password})


def _register_both(client: TestClient, email: str) -> dict[str, Any]:
    body = {"name": "Nora Novak", "email": email, "password": GUEST_PASSWORD, "consent": True}
    sent = client.post("/api/account/register", json=body)
    assert sent.status_code == 202, sent.text
    verify = {
        "email": email,
        "code": sent.json()["demo_code"],
        "signup_id": sent.json()["signup_id"],
    }
    verified = client.post("/api/guest/verify", json=verify)
    assert verified.status_code == 201, verified.text
    assert "work" in verified.json()
    return verified.json()


def _reset(client: TestClient, email: str, code: str) -> None:
    assert client.post("/api/guest/password/forgot", json={"email": email}).status_code == 202
    body = {"email": email, "code": code, "new_password": NEW_PASSWORD}
    answer = client.post("/api/guest/password/reset", json=body)
    assert answer.status_code == 200, answer.text


@pytest.mark.usefixtures("no_resend_wait")
def test_a_new_password_also_changes_the_work_password_made_by_one_sign_up(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    code = use_inbox_code(monkeypatch)
    data = _register_both(client, "nora@example.com")
    old_work = bearer(data["work"]["token"])
    assert client.get("/api/account/work", headers=old_work).status_code == 200

    _reset(client, "nora@example.com", code)
    assert _login(client, "nora@example.com", GUEST_PASSWORD).status_code == 401
    assert sorted(_login(client, "nora@example.com", NEW_PASSWORD).json()) == ["guest", "work"]
    # Whoever held the old work session is out.
    assert client.get("/api/account/work", headers=old_work).status_code == 401


def test_a_new_password_also_changes_a_work_password_hashed_apart(
    client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    code = use_inbox_code(monkeypatch)
    user = make_user(session, "apart@example.com")
    make_account(session, "apart@example.com")  # same password, its own salt
    old_work = auth_header(user)
    assert client.get("/api/account/work", headers=old_work).status_code == 200

    _reset(client, "apart@example.com", code)
    assert _login(client, "apart@example.com", TEST_PASSWORD).status_code == 401
    assert sorted(_login(client, "apart@example.com", NEW_PASSWORD).json()) == ["guest", "work"]
    assert client.get("/api/account/work", headers=old_work).status_code == 401
    # A work session made after the reset works.
    work_token = _login(client, "apart@example.com", NEW_PASSWORD).json()["work"]["token"]
    assert client.get("/api/account/work", headers=bearer(work_token)).status_code == 200


def test_a_work_token_is_signed_for_one_session_version(database_url: str) -> None:
    old = create_session_token(42)
    assert verify_session_token(old) == 42
    assert verify_session_token(old, version=1) is None
    newer = create_session_token(42, version=1)
    assert verify_session_token(newer, version=1) == 42
    assert verify_session_token(newer) is None
    # Version 0 keeps the token shape and signature from before versions,
    # so sessions made before this change stay valid.
    user_id, expires, signature = old.split(".")
    assert signature == keyed_hash(f"{user_id}.{expires}")


def _delete(client: TestClient, guest_token: str, password: str) -> Any:
    return client.post(
        "/api/guest/me/delete", headers=bearer(guest_token), json={"password": password}
    )


def test_deleting_the_account_deletes_a_work_identity_that_runs_nothing(
    client: TestClient, session: Session
) -> None:
    data = _register_both(client, "leaving@example.com")
    assert _delete(client, data["token"], GUEST_PASSWORD).json() == {"deleted": True}
    session.expire_all()
    found = session.scalars(select(Organiser).where(Organiser.email == "leaving@example.com"))
    assert found.first() is None
    assert _login(client, "leaving@example.com", GUEST_PASSWORD).status_code == 401
    assert client.get("/api/account/work", headers=bearer(data["work"]["token"])).status_code == 401


def test_deleting_the_account_keeps_a_work_identity_that_owns_a_venue(
    client: TestClient, session: Session
) -> None:
    user = make_user(session, "owner.too@example.com")
    session.add(Venue(organiser_id=user.id, kind="restaurant", name="Kept", width=1, height=1))
    session.commit()
    make_account(session, "owner.too@example.com")
    guest_token = _login(client, "owner.too@example.com", TEST_PASSWORD).json()["guest"]["token"]
    assert _delete(client, guest_token, TEST_PASSWORD).json() == {"deleted": True}
    assert sorted(_login(client, "owner.too@example.com", TEST_PASSWORD).json()) == ["work"]


def test_an_unproven_account_never_deletes_the_work_account_of_its_address(
    client: TestClient, session: Session
) -> None:
    # Demo: whoever types staff@example.com gets its code on screen. Deleting
    # that guest account must not delete the real work account of the address.
    make_user(session, "idle.worker@example.com")
    account = make_account(session, "idle.worker@example.com")
    account.email_proven = False
    session.commit()
    guest_token = _login(client, "idle.worker@example.com", TEST_PASSWORD).json()["guest"]["token"]
    assert _delete(client, guest_token, TEST_PASSWORD).json() == {"deleted": True}
    assert sorted(_login(client, "idle.worker@example.com", TEST_PASSWORD).json()) == ["work"]


def test_a_guest_added_to_a_team_gets_work_access_when_signing_in(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    make_account(session, "old.guest@example.com")
    assert sorted(_login(client, "old.guest@example.com", TEST_PASSWORD).json()) == ["guest"]

    venue = Venue(organiser_id=organiser.id, kind="restaurant", name="Team", width=1, height=1)
    session.add(venue)
    session.commit()
    added = client.post(
        f"/api/owner/venues/{venue.public_id}/members",
        headers=auth_header(organiser),
        json={"email": "old.guest@example.com"},
    )
    assert added.status_code == 201, added.text

    signed_in = _login(client, "old.guest@example.com", TEST_PASSWORD)
    assert sorted(signed_in.json()) == ["guest", "work"], signed_in.text
    work = client.get("/api/account/work", headers=bearer(signed_in.json()["work"]["token"]))
    assert [(r["name"], r["role"]) for r in work.json()["restaurants"]] == [("Team", "staff")]
    # The work identity has the guest account's password: one account.
    assert sorted(_login(client, "old.guest@example.com", TEST_PASSWORD).json()) == [
        "guest",
        "work",
    ]


def test_an_unproven_guest_on_a_team_gets_no_work_identity(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    account = make_account(session, "unproven@example.com")
    account.email_proven = False
    venue = Venue(organiser_id=organiser.id, kind="restaurant", name="Team", width=1, height=1)
    session.add(venue)
    session.commit()
    client.post(
        f"/api/owner/venues/{venue.public_id}/members",
        headers=auth_header(organiser),
        json={"email": "unproven@example.com"},
    )
    assert sorted(_login(client, "unproven@example.com", TEST_PASSWORD).json()) == ["guest"]


@pytest.mark.usefixtures("no_resend_wait")
def test_demo_reset_never_leaves_the_account_with_two_passwords(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DEMO_KEY", "a-long-demo-key-for-tests")
    get_settings.cache_clear()
    _register_both(client, "twice@example.com")
    reset = client.post("/api/demo/reset", headers={"X-Demo-Key": "a-long-demo-key-for-tests"})
    assert reset.status_code == 200, reset.text

    body = {"name": "Nora", "email": "twice@example.com", "password": NEW_PASSWORD, "consent": True}
    sent = client.post("/api/account/register", json=body)
    verify = {
        "email": "twice@example.com",
        "code": sent.json()["demo_code"],
        "signup_id": sent.json()["signup_id"],
    }
    verified = client.post("/api/guest/verify", json=verify)
    assert verified.status_code == 201, verified.text
    assert "work" in verified.json()
    assert _login(client, "twice@example.com", GUEST_PASSWORD).status_code == 401
    assert sorted(_login(client, "twice@example.com", NEW_PASSWORD).json()) == ["guest", "work"]
    # The seeded demo accounts survive the reset as before.
    assert sorted(_login(client, "rita@example.com", "demo-member-2026").json()) == [
        "guest",
        "work",
    ]


def test_events_list_the_organisers_own_first_then_member_venues(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    other_owner = make_user(session, "other.owner@example.com")
    sooner = make_event(client, other_owner, [])
    later = make_event(client, organiser, [])
    for setup, month in ((sooner, 1), (later, 6)):
        event = session.scalars(select(Event).where(Event.public_id == setup.eid)).one()
        event.starts_at = datetime(2030, month, 10, 18, tzinfo=UTC)
        event.ends_at = datetime(2030, month, 10, 23, tzinfo=UTC)
    session.commit()
    venue_id = client.get(f"/api/events/{sooner.eid}", headers=sooner.headers).json()["venue"][
        "public_id"
    ]
    client.post(
        f"/api/owner/venues/{venue_id}/members",
        headers=sooner.headers,
        json={"email": organiser.email},
    )
    listed = client.get("/api/events", headers=auth_header(organiser)).json()
    assert [(e["public_id"], e["role"]) for e in listed] == [
        (later.eid, "organiser"),
        (sooner.eid, "staff"),
    ]
    work = client.get("/api/account/work", headers=auth_header(organiser)).json()
    assert [e["public_id"] for e in work["events"]] == [later.eid, sooner.eid]
