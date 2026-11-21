"""Migrate marks the places create-with-venue made before venues.made_with_event existed.

Reuses the frozen old schema of test_migrate_guest_accounts.py. Only a venue
with that route's exact shape and no venue.create audit row is marked; a hall
made through POST /venues (audited) and the old sample hall stay NULL, and so
keep counting in the event venue limit. The mark is set once, in the run that
adds the column.
"""

import pytest
from sqlalchemy import Engine, text
from test_migrate_guest_accounts import _run_migrate, old_database  # noqa: F401

from app import db

ROW = (
    "INSERT INTO venues (id, public_id, organiser_id, kind, name, timezone, width, height) "
    "VALUES (:id, :pid, 1, 'event', :name, 'UTC', 1000, 800)"
)
AUDIT = (
    "INSERT INTO audit_log (id, at, actor, action, entity, entity_id, detail) "
    "VALUES (1, '2026-11-20 10:00:00', 'olga.owner@example.com', 'venue.create', "
    "'venue', 'venueHall', '{}')"
)


def _marks(engine: Engine) -> dict[str, bool | None]:
    with engine.connect() as connection:
        rows = connection.execute(text("SELECT public_id, made_with_event FROM venues")).all()
    return {pid: (None if mark is None else bool(mark)) for pid, mark in rows}


def test_only_places_made_with_an_event_are_marked_once(
    old_database: Engine,  # noqa: F811
    capsys: pytest.CaptureFixture[str],
) -> None:
    with old_database.begin() as connection:
        connection.execute(text(ROW), {"id": 2, "pid": "venuePlace", "name": "Quinta"})
        connection.execute(text(ROW), {"id": 3, "pid": "venueHall", "name": "Hall"})
        connection.execute(text(AUDIT))
    first = _run_migrate(capsys)
    assert "Marked 1 places made with their event" in first
    engine = db.get_engine()
    assert _marks(engine) == {"venueSample1": None, "venuePlace": True, "venueHall": None}
    # Later runs leave every row alone, a new unaudited one included.
    with engine.begin() as connection:
        connection.execute(text(ROW), {"id": 4, "pid": "venueLater", "name": "Later"})
    second = _run_migrate(capsys)
    assert not any(line.startswith("Marked") for line in second)
    assert _marks(engine)["venueLater"] is None
