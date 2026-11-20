from sqlalchemy import select
from test_restaurant_helpers import book, future_day, hold, make_restaurant

from app.models import Booking, LiveVersion


def test_structured_needs_survive_booking_and_are_shown_to_staff(client, session, organiser):
    from conftest import auth_header

    place = make_restaurant(session, organiser)
    day = future_day()
    held = hold(client, place, day, "19:00", 2).json()
    response = book(
        client,
        place,
        held["hold_id"],
        2,
        occasion="birthday",
        dietary_requirements="Vegetarian",
        allergies="Peanuts",
    )
    assert response.status_code == 201, response.text
    data = response.json()["booking"]
    assert data["occasion"] == "birthday"
    assert data["allergies"] == "Peanuts"
    floor = client.get(
        f"/api/staff/{place.public_id}/floor",
        headers=auth_header(organiser),
        params={"date": day.isoformat(), "time": "19:00"},
    ).json()
    assert floor["bookings"][0]["dietary_requirements"] == "Vegetarian"
    assert floor["bookings"][0]["allergies"] == "Peanuts"


def test_arrival_notice_requires_token_valid_status_and_bumps_live_floor(
    client, session, organiser
):
    place = make_restaurant(session, organiser)
    day = future_day()
    held = hold(client, place, day, "19:00", 2).json()
    booked = book(client, place, held["hold_id"], 2).json()
    path = f"/api/b/{booked['manage_token']}/arrival"
    scope = f"venue-{place.public_id}-{day.isoformat()}"
    before = session.get(LiveVersion, scope).version
    assert client.post("/api/b/wrong-token/arrival", json={"delay_minutes": 15}).status_code == 404
    for invalid in (-1, 121, 1.5, True):
        assert client.post(path, json={"delay_minutes": invalid}).status_code == 422
    response = client.post(path, json={"delay_minutes": 15})
    assert response.status_code == 200, response.text
    assert response.json()["arrival_time"] == "19:15"
    session.expire_all()
    assert session.get(LiveVersion, scope).version > before
    assert client.get(f"/api/b/{booked['manage_token']}").json()["arrival_time"] == "19:15"
    # A notice cannot extend the reservation beyond its existing turn.
    assert client.post(path, json={"delay_minutes": 90}).status_code == 422
    changed = client.patch(f"/api/b/{booked['manage_token']}", json={"time": "19:15"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["arrival_time"] is None
    row = session.scalar(select(Booking))
    row.status = "seated"
    session.commit()
    assert client.post(path, json={"delay_minutes": 30}).status_code == 409
