"""Event seats are allocated at confirmation, not at selection."""

import threading

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_events_setup import make_event

from app.models import Organiser, SeatAssignment


def test_first_confirmation_wins(
    client: TestClient, organiser: Organiser, session: Session
) -> None:
    setup = make_event(
        client,
        organiser,
        [
            {"name": "Alice", "email": "alice@example.com"},
            {"name": "Bob", "email": "bob@example.com"},
        ],
    )
    seat = setup.seats[0][0]
    bob = setup.tokens["Bob"]
    alice = setup.tokens["Alice"]
    assert client.post(f"/api/a/{bob}/confirm", json={"seat_id": seat}).status_code == 200
    result = client.post(f"/api/a/{alice}/confirm", json={"seat_id": seat})
    assert result.status_code == 409
    assert result.json()["error"]["code"] == "seat_taken"
    session.expire_all()
    assert (
        len(list(session.scalars(select(SeatAssignment).where(SeatAssignment.seat_id == seat))))
        == 1
    )


def test_simultaneous_confirmations_have_one_winner(
    client: TestClient, organiser: Organiser
) -> None:
    setup = make_event(
        client,
        organiser,
        [
            {"name": "Alice", "email": "alice@example.com"},
            {"name": "Bob", "email": "bob@example.com"},
        ],
    )
    barrier = threading.Barrier(2)
    statuses = []

    def confirm(name: str) -> None:
        barrier.wait()
        statuses.append(
            client.post(
                f"/api/a/{setup.tokens[name]}/confirm", json={"seat_id": setup.seats[0][0]}
            ).status_code
        )

    threads = [threading.Thread(target=confirm, args=(name,)) for name in ("Alice", "Bob")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(statuses) == [200, 409]
