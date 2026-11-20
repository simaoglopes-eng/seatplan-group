from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from test_events_setup import choose, make_event

from app.events_service.age import age_at
from app.models import Guest, Organiser


def test_birthday_boundary():
    assert age_at(date(2000, 5, 2), date(2030, 5, 1)) == 29
    assert age_at(date(2000, 5, 2), date(2030, 5, 2)) == 30


def test_age_visibility_and_recommendation_privacy(
    client: TestClient, organiser: Organiser, session: Session
):
    setup = make_event(
        client,
        organiser,
        [{"name": "Viewer Person"}, {"name": "Other Person"}],
        privacy_mode="full_name",
    )
    viewer, other = setup.tokens["Viewer Person"], setup.tokens["Other Person"]

    def profile(token, born, share):
        return client.post(
            f"/api/a/{token}/age-profile", json={"birth_date": born, "share_age": share}
        )

    assert profile(viewer, "2000-01-01", False).status_code == 200
    assert profile(other, "2001-01-01", False).status_code == 200
    choose(client, setup, "Other Person", setup.seats[1][0])
    hidden = client.get(f"/api/a/{viewer}").json()
    assert (
        next(s for s in hidden["map"]["seats"] if s["id"] == setup.seats[1][0])["occupant"]
        == "Other Person"
    )
    assert "similar ages" not in str(client.get(f"/api/a/{viewer}/recommendations").json())
    assert profile(other, "2001-01-01", True).status_code == 200
    shown = client.get(f"/api/a/{viewer}").json()
    assert (
        next(s for s in shown["map"]["seats"] if s["id"] == setup.seats[1][0])["occupant"]
        == "Other Person, 29"
    )
    recs = client.get(f"/api/a/{viewer}/recommendations").json()
    assert recs[0]["seat_id"] in setup.seats[1]
    assert "similar ages" in str(recs[0]["reasons"])
    assert "2001-01-01" not in str(shown)
    assert client.post(f"/api/a/{other}/privacy", json={"wants_anonymous": True}).status_code == 200
    assert "similar ages" not in str(client.get(f"/api/a/{viewer}/recommendations").json())
    assert profile(other, "2099-01-01", True).status_code == 422
    assert profile(other, None, True).status_code == 422
    assert client.delete(
        f"/api/events/{setup.eid}/guests/{setup.guests['Other Person']}", headers=setup.headers
    ).status_code in (200, 204)
    session.expire_all()
    assert session.get(Guest, setup.guests["Other Person"]).birth_date is None


def test_separate_names_follow_privacy_and_are_erased(
    client: TestClient, organiser: Organiser, session: Session
):
    setup = make_event(client, organiser, [{"name": "Viewer Person"}, {"name": "Old Name"}])
    viewer, other = setup.tokens["Viewer Person"], setup.tokens["Old Name"]
    response = client.post(
        f"/api/a/{other}/name-profile", json={"first_name": "  Maria  ", "last_name": "  Silva "}
    )
    assert response.status_code == 200
    assert response.json()["shown_to_others_as"] == "Maria S."
    own = client.get(f"/api/a/{other}").json()["me"]
    assert (own["first_name"], own["last_name"]) == ("Maria", "Silva")
    choose(client, setup, "Old Name", setup.seats[0][0])
    view = client.get(f"/api/a/{viewer}").json()
    assert "Maria S." in str(view)
    assert "Silva" not in str(view)
    assert (
        client.post(
            f"/api/a/{other}/name-profile", json={"first_name": " ", "last_name": "Silva"}
        ).status_code
        == 422
    )
    assert client.delete(
        f"/api/events/{setup.eid}/guests/{setup.guests['Old Name']}", headers=setup.headers
    ).status_code in (200, 204)
    session.expire_all()
    guest = session.get(Guest, setup.guests["Old Name"])
    assert guest.first_name is None and guest.last_name is None
