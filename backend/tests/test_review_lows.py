"""Smaller review findings: profile writes, the age oracle, the demo reset, /health.

- L2: the name and age profile writes respect the change deadline and read
  the guest again after the event lock, like every other attendee write.
- Age oracle: the venue's team may not send "age" when patching a guest;
  the refusal is the same whatever is stored.
- M4: a demo reset without DEMO_MEMBER_PASSWORD gives the demo member a
  random password (logged as generated, never printed) instead of a 500.
- L1: /health says "needs_migration" when a column of NEW_COLUMNS is missing.
"""

import dataclasses
import logging
from typing import Any

import pytest
from conftest import auth_header, make_user
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from test_events_setup import make_event

from app import db
from app.config import get_settings
from app.core.errors import ApiError
from app.events_service import attendee_view
from app.events_service.guests import erase_guest
from app.models import Event, Guest, GuestAccount, Organiser
from app.security import verify_password
from app.seed import run

PAST = "2020-01-01T00:00:00Z"


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("name-profile", {"first_name": "Ana", "last_name": "Silva"}),
        ("age-profile", {"birth_date": "1990-01-01", "share_age": False}),
    ],
)
def test_profile_writes_stop_at_the_deadline(
    client: TestClient, organiser: Organiser, path: str, body: dict[str, Any]
) -> None:
    setup = make_event(client, organiser, [{"name": "Ana Silva"}], change_deadline=PAST)
    answer = client.post(f"/api/a/{setup.tokens['Ana Silva']}/{path}", json=body)
    assert answer.status_code == 409, answer.text
    assert answer.json()["error"]["code"] == "deadline_passed"


@pytest.mark.parametrize("which", ["name", "age"])
def test_profile_writes_never_land_on_a_row_erased_meanwhile(
    client: TestClient, organiser: Organiser, session: Session, which: str
) -> None:
    """The route found the guest, then the organiser erased them before the lock."""
    make_event(client, organiser, [{"name": "Ana Silva"}])
    me = session.scalars(select(Guest).where(Guest.name == "Ana Silva")).one()
    with db.new_session() as other:
        guest = other.get(Guest, me.id)
        assert guest is not None
        erase_guest(other, other.get(Event, guest.event_id), guest, actor="test")  # type: ignore[arg-type]
        other.commit()
    with pytest.raises(ApiError) as gone:
        if which == "name":
            attendee_view.set_name_profile(session, me, "Ana", "Silva")
        else:
            attendee_view.set_age_profile(session, me, None, False)
    assert gone.value.status == 404
    session.rollback()
    session.expire_all()
    erased = session.get(Guest, me.id)
    assert erased is not None
    assert (erased.first_name, erased.birth_date) == (None, None)


def test_taking_the_age_back_works_after_the_deadline(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    """Withdrawing consent stays as easy as giving it; sharing more still waits."""
    setup = make_event(client, organiser, [{"name": "Ana Silva"}])
    token = setup.tokens["Ana Silva"]
    shared = {"birth_date": "1990-01-01", "share_age": True}
    assert client.post(f"/api/a/{token}/age-profile", json=shared).status_code == 200
    event = session.scalars(select(Event).where(Event.public_id == setup.eid)).one()
    event.change_deadline = event.starts_at.replace(year=2020)
    session.commit()

    again = client.post(f"/api/a/{token}/age-profile", json=shared)
    assert again.status_code == 200, again.text  # the same answer, nothing new shared
    other_date = client.post(
        f"/api/a/{token}/age-profile", json={"birth_date": "1991-01-01", "share_age": True}
    )
    assert other_date.json()["error"]["code"] == "deadline_passed"
    off = client.post(
        f"/api/a/{token}/age-profile", json={"birth_date": "1990-01-01", "share_age": False}
    )
    assert off.status_code == 200, off.text
    back_on = client.post(f"/api/a/{token}/age-profile", json=shared)
    assert back_on.json()["error"]["code"] == "deadline_passed"
    cleared = client.post(
        f"/api/a/{token}/age-profile", json={"birth_date": None, "share_age": False}
    )
    assert cleared.status_code == 200, cleared.text
    session.expire_all()
    ana = session.get(Guest, setup.guests["Ana Silva"])
    assert ana is not None and (ana.birth_date, ana.share_age) == (None, False)


def test_the_venue_team_cannot_probe_ages(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = make_event(client, organiser, [{"name": "Ana Silva"}, {"name": "Bea Costa"}])
    venue_id = client.get(f"/api/events/{setup.eid}", headers=setup.headers).json()["venue"][
        "public_id"
    ]
    added = client.post(
        f"/api/owner/venues/{venue_id}/members",
        headers=setup.headers,
        json={"email": "eve.member@example.com"},
    )
    assert added.status_code == 201, added.text
    team = auth_header(make_user(session, "eve.member@example.com"))
    ana = setup.guests["Ana Silva"]
    with_age = client.patch(
        f"/api/events/{setup.eid}/guests/{ana}", headers=setup.headers, json={"age": 30}
    )
    assert with_age.status_code == 200
    answers = [
        client.patch(f"/api/events/{setup.eid}/guests/{gid}", headers=team, json={"age": None})
        for gid in (ana, setup.guests["Bea Costa"], 999_999)
    ]
    assert {a.status_code for a in answers} == {403}
    assert len({a.text for a in answers}) == 1
    assert answers[0].json()["error"]["message"] == (
        "Only the event's organiser can see or change ages."
    )
    # Other changes still work for the team, and the organiser still sets ages.
    renamed = client.patch(
        f"/api/events/{setup.eid}/guests/{ana}", headers=team, json={"dietary_note": "Vegan"}
    )
    assert renamed.status_code == 200 and renamed.json()["age"] is None
    session.expire_all()
    assert session.get(Guest, ana).age_years == 30  # type: ignore[union-attr]


def test_a_demo_reset_without_the_member_password_still_seeds(
    session: Session, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """As on a Postgres deployment where DEMO_MEMBER_PASSWORD was never set."""
    deployed = dataclasses.replace(get_settings(), database_url="postgresql+psycopg://x/y")
    assert deployed.is_postgres
    monkeypatch.setenv("DEMO_ORGANISER_PASSWORD", "organiser-private-1")
    monkeypatch.setenv("DEMO_STAFF_PASSWORD", "staff-private-1")
    monkeypatch.delenv("DEMO_MEMBER_PASSWORD", raising=False)
    real = run.secrets.token_urlsafe  # the same module every token comes from
    monkeypatch.setattr(
        run.secrets,
        "token_urlsafe",
        lambda n=None: "made-up-random-password" if n == 24 else real(n),
    )
    with caplog.at_level(logging.WARNING, logger="seatplan.seed"):
        run.seed_all(session, deployed, actor="test")
    assert "DEMO_MEMBER_PASSWORD is not set" in caplog.text
    assert "made-up-random-password" not in caplog.text
    work = session.scalars(select(Organiser).where(Organiser.email == run.DEMO_MEMBER_EMAIL)).one()
    guest = session.scalars(
        select(GuestAccount).where(GuestAccount.email == run.DEMO_MEMBER_EMAIL)
    ).one()
    # One password for both halves of her account, and not the public default.
    assert verify_password("made-up-random-password", work.password_hash)
    assert verify_password("made-up-random-password", guest.password_hash)
    assert not verify_password("demo-member-2026", work.password_hash)
    # The other two still refuse to start without their variables.
    monkeypatch.delenv("DEMO_STAFF_PASSWORD")
    with pytest.raises(RuntimeError):
        run.seed_all(session, deployed, actor="test")
    session.rollback()


def test_health_says_needs_migration_when_a_new_column_is_missing(
    client: TestClient, app: Any
) -> None:
    assert client.get("/api/health").json()["schema"] == "ready"
    from app.routers import health

    health._READY.clear()  # as in a process that has not seen this database yet
    with db.get_engine().begin() as connection:
        connection.execute(text("ALTER TABLE events DROP COLUMN max_party_size"))
    answer = client.get("/api/health")
    assert answer.status_code == 503
    assert answer.json()["schema"] == "needs_migration"
    assert answer.json()["status"] == "degraded"
    for line in db.create_all():  # what python -m app.seed.migrate runs
        assert "Added column" not in line or line == "Added column events.max_party_size"
    healed = client.get("/api/health")
    assert healed.status_code == 200 and healed.json()["schema"] == "ready"
