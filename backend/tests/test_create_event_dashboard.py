from conftest import auth_header


def test_create_event_and_floor_together(client, organiser, staff):
    data = {
        "name": "Wedding",
        "starts_at": "2030-05-01T18:00:00Z",
        "ends_at": "2030-05-01T23:00:00Z",
    }
    assert client.post("/api/events/create-with-venue", json=data).status_code == 401
    response = client.post(
        "/api/events/create-with-venue", headers=auth_header(organiser), json=data
    )
    assert response.status_code == 201, response.text
    event = response.json()
    assert event["name"] == "Wedding"
    assert (
        client.get(f"/api/events/{event['public_id']}", headers=auth_header(organiser)).status_code
        == 200
    )
    assert (
        client.get(f"/api/venues/{event['venue_id']}", headers=auth_header(organiser)).status_code
        == 200
    )
    assert (
        client.get(f"/api/events/{event['public_id']}", headers=auth_header(staff)).status_code
        == 403
    )


def test_invalid_dates_create_neither_event_nor_venue(client, organiser):
    headers = auth_header(organiser)
    before_events = client.get("/api/events", headers=headers).json()
    before_venues = client.get("/api/venues", headers=headers).json()
    response = client.post(
        "/api/events/create-with-venue",
        headers=headers,
        json={
            "name": "Wedding",
            "starts_at": "2030-05-01T23:00:00Z",
            "ends_at": "2030-05-01T18:00:00Z",
        },
    )
    assert response.status_code == 422
    assert client.get("/api/events", headers=headers).json() == before_events
    assert client.get("/api/venues", headers=headers).json() == before_venues


def test_event_at_a_place_outside_the_directory(client, organiser, session):
    from sqlalchemy import select

    from app.models import Venue

    response = client.post(
        "/api/events/create-with-venue",
        headers=auth_header(organiser),
        json={
            "name": "Ana's 40th",
            "starts_at": "2030-06-01T19:00:00Z",
            "ends_at": "2030-06-01T23:30:00Z",
            "venue_name": "  Casa da Tia Rosa  ",
            "venue_address": "Rua das Flores 12, Sintra",
        },
    )
    assert response.status_code == 201, response.text
    venue = session.scalars(
        select(Venue).where(Venue.public_id == response.json()["venue_id"])
    ).one()
    assert venue.name == "Casa da Tia Rosa"
    assert venue.address == "Rua das Flores 12, Sintra"
    assert venue.organiser_id == organiser.id
    # Private to this organiser: no slug, so no public page and no directory entry.
    assert venue.slug is None


def test_place_fields_are_bounded(client, organiser):
    response = client.post(
        "/api/events/create-with-venue",
        headers=auth_header(organiser),
        json={
            "name": "Party",
            "starts_at": "2030-06-01T19:00:00Z",
            "ends_at": "2030-06-01T23:30:00Z",
            "venue_name": "x" * 121,
        },
    )
    assert response.status_code == 422
