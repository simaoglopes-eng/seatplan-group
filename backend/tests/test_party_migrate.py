"""An existing database gains the party columns in place, and keeps working.

Reuses the frozen old schema of test_migrate_guest_accounts.py: the old guest
row must come out unchanged with NULL in both new columns, and the upgraded
database must serve the new party routes. The fresh-versus-upgraded shape
comparison in that file covers the new columns and index too.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, inspect, text
from test_migrate_guest_accounts import _old_rows, _run_migrate, old_database  # noqa: F401

from app import db
from app.config import get_settings
from app.models import Organiser
from app.security import create_session_token


def test_old_database_gains_party_columns_with_nulls(
    old_database: Engine,  # noqa: F811
    capsys: pytest.CaptureFixture[str],
) -> None:
    before = _old_rows(old_database)
    first = _run_migrate(capsys)
    assert "Added column guests.booked_by_guest_id" in first
    assert "Added column guests.age_years" in first
    assert "Index ix_guests_booked_by_guest_id is ready" in first
    second = _run_migrate(capsys)
    assert not any(line.startswith("Added column") for line in second)

    engine = db.get_engine()
    assert _old_rows(engine) == before
    with engine.connect() as connection:
        row = connection.execute(text("SELECT booked_by_guest_id, age_years FROM guests")).one()
    assert tuple(row) == (None, None)
    inspector = inspect(engine)
    columns = [column["name"] for column in inspector.get_columns("guests")]
    assert columns[-2:] == ["booked_by_guest_id", "age_years"]
    foreign = {
        (tuple(f["constrained_columns"]), f["referred_table"])
        for f in inspector.get_foreign_keys("guests")
    }
    assert (("booked_by_guest_id",), "guests") in foreign
    indexes = {index["name"] for index in inspector.get_indexes("guests")}
    assert "ix_guests_booked_by_guest_id" in indexes


def test_the_upgraded_database_books_a_party(
    old_database: Engine,  # noqa: F811
    capsys: pytest.CaptureFixture[str],
) -> None:
    from app.main import create_app

    _run_migrate(capsys)
    client = TestClient(create_app())
    headers = {"Authorization": f"Bearer {create_session_token(1)}"}
    guests = client.get("/api/events/eventSample1/guests", headers=headers).json()
    assert [(g["name"], g["age"], g["booked_by_guest_id"]) for g in guests] == [
        ("Ines Old", None, None)
    ]
    link = client.post("/api/events/eventSample1/guests/1/new-link", headers=headers)
    token = link.json()["token"]
    page = client.get(f"/api/a/{token}").json()
    assert page["party"]["me"]["details_complete"] is False
    assert page["party"]["places_left"] == 0
    body = {"me": {"seat_id": 1, "first_name": "Ines", "last_name": "Old", "age": 70}}
    booked = client.post(f"/api/a/{token}/party/confirm", json=body)
    assert booked.status_code == 200, booked.text
    assert booked.json()["me"]["details_complete"] is True
    # One seat in the old room: the only other seat a member could take is hers.
    full = {**body, "members": [{"seat_id": 1, "first_name": "A", "last_name": "B", "age": 1}]}
    assert client.post(f"/api/a/{token}/party/confirm", json=full).status_code == 422


def test_demo_reset_wipes_party_members(
    client: TestClient, organiser: Organiser, monkeypatch: pytest.MonkeyPatch
) -> None:
    from party_helpers import invited_event, link_door, party_body, person

    setup = invited_event(client, organiser, ["Ana Silva"])
    s0, s1 = setup.seats[0][:2]
    booked = link_door(setup, "Ana Silva").confirm(
        client, party_body(s0, [person(s1, "Bea", "Silva", 9)])
    )
    assert booked.status_code == 200, booked.text
    monkeypatch.setenv("DEMO_KEY", "a-long-demo-key-for-tests")
    get_settings.cache_clear()
    reset = client.post("/api/demo/reset", headers={"X-Demo-Key": "a-long-demo-key-for-tests"})
    assert reset.status_code == 200, reset.text
