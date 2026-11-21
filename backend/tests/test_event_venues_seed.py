"""The event venues demo and the "one account" demo (Rita Rossi), pinned to exact values.

Six invented event venues (three halls, three quintas), ten listed events
covering every event type, every one open to join through its public link;
each listed event runs on its own private copy of its venue laid out with a
one-click setup; the two older demo events get a type but stay unlisted; Rita is staff at
Casa Lumen and Quinta da Serra Azul and books at Tagus Terrace and the Lisbon
Product Conference with one sign-in.
"""

from collections import Counter
from typing import Any

from fastapi.testclient import TestClient
from guest_helpers import bearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.events_service import accounts, layouts, share
from app.events_service.problem import current_rows, event_guests, venue_seats
from app.models import Event, GuestAccount, Venue, VenueMember, VenuePhoto, utc_now
from app.seed import demo_event_venues, demo_member
from app.seed.run import ensure_demo_users, seed_all

SEATS = {
    "Tagus Forum": 144,
    "Sala Atlântico": 120,
    "Armazém da Ribeira": 48,
    "Quinta da Serra Azul": 80,
    "Quinta dos Sobreiros": 80,
    "Quinta do Vale Dourado": 80,
}
# Each listed event's own setup: (preset, seats).
SETUPS = {
    "Lisbon Product Conference": ("theatre", 100),
    "Cities and Climate Forum": ("theatre", 100),
    "Cascais Charity Gala": ("banquet", 120),
    "Blue Harbour year-end dinner": ("cabaret", 84),
    "Porto Data Workshop": ("classroom", 40),
    "Sofia and Tiago's wedding": ("banquet", 80),
    "Leonor's christening lunch": ("banquet", 80),
    "Helena's 50th birthday": ("banquet", 80),
    "Inês and Duarte's wedding": ("banquet", 80),
    "Douro harvest gala": ("banquet", 80),
}


def _seed_venues(session: Session) -> dict[str, str]:
    ensure_demo_users(session, get_settings())
    links = demo_event_venues.seed(session)
    session.commit()
    return links


def test_six_event_venues_with_ten_listed_events_of_every_type(
    client: TestClient, session: Session
) -> None:
    links = _seed_venues(session)
    assert links == {
        "event_booking": "/events",
        "event_staff": "/events/staff",
        "showcase_venue_tagus_forum": "/venues/tagus-forum",
        "showcase_venue_sala_atlantico": "/venues/sala-atlantico",
        "showcase_venue_quinta_da_serra_azul": "/venues/quinta-da-serra-azul",
        "showcase_venue_quinta_dos_sobreiros": "/venues/quinta-dos-sobreiros",
    }
    venues = session.scalars(
        select(Venue).where(Venue.parent_venue_id.is_(None)).order_by(Venue.id)
    ).all()
    assert {v.name: len(venue_seats(session, v.id)) for v in venues} == SEATS
    assert Counter(v.venue_type for v in venues) == {"hall": 3, "quinta": 3}
    assert all(
        v.kind == "event" and v.status == "published" and v.slug and v.is_demo for v in venues
    )
    assert all(v.description and v.lat is not None and v.phone for v in venues)

    events = session.scalars(select(Event).order_by(Event.id)).all()
    assert len(events) == 10
    assert Counter(e.event_type for e in events) == {
        "conference": 3,
        "gala_dinner": 2,
        "wedding": 2,
        "corporate_dinner": 1,
        "christening": 1,
        "birthday": 1,
    }
    assert all(e.listed and e.share_enabled and e.share_cap for e in events)
    copies = {e.name: session.get(Venue, e.venue_id) for e in events}
    assert {
        name: (layouts.current_preset(session, copy), len(venue_seats(session, copy.id)))
        for name, copy in copies.items()
    } == SETUPS
    halls = {v.id: v for v in venues}
    for copy in copies.values():
        hall = halls[copy.parent_venue_id]
        assert (copy.kind, copy.status, copy.slug, copy.is_demo) == ("event", "draft", None, True)
        assert (copy.width, copy.height, copy.organiser_id) == (
            hall.width,
            hall.height,
            hall.organiser_id,
        )
    assert len(session.scalars(select(Venue)).all()) == 16
    assert sum(len(event_guests(session, e)) for e in events) == 330
    assert sum(len(current_rows(session, e)) for e in events) == 149
    for event in events:  # every seated guest sits in the event's own copy
        seat_ids = {seat.id for seat in venue_seats(session, event.venue_id)}
        assert {row.seat_id for row in current_rows(session, event).values()} <= seat_ids
    now = utc_now()
    for event in events:
        assert event.change_deadline is not None and event.change_deadline > now
        assert share.places_left(session, event) > 0
        page = client.get(f"/api{share.share_path(event)}")
        assert page.status_code == 200 and page.json()["join"]["open"] is True, event.name

    photos = session.scalars(select(VenuePhoto)).all()
    assert len(photos) == 12 and sum(p.is_cover for p in photos) == 6
    assert all(p.alt_text.startswith("An illustration of") for p in photos)

    public = client.get("/api/public-events", params={"limit": 50}).json()
    assert public["total"] == 10
    halls = client.get("/api/event-venues", params={"type": "hall"}).json()["items"]
    assert sorted(v["name"] for v in halls) == [
        "Armazém da Ribeira",
        "Sala Atlântico",
        "Tagus Forum",
    ]


def test_the_seed_is_the_same_every_time(session: Session) -> None:
    ensure_demo_users(session, get_settings())
    demo_event_venues.seed(session)
    demo_event_venues.seed(session)
    session.commit()
    events = session.scalars(select(Event).order_by(Event.id)).all()
    assert len(events) == 20
    for first, second in zip(events[:10], events[10:], strict=True):
        assert [g.name for g in event_guests(session, first)] == [
            g.name for g in event_guests(session, second)
        ]
        assert len(current_rows(session, first)) == len(current_rows(session, second))


def _login(client: TestClient) -> dict[str, Any]:
    answer = client.post(
        "/api/account/login", json={"email": "rita@example.com", "password": "demo-member-2026"}
    )
    assert answer.status_code == 200, answer.text
    return answer.json()


def test_the_whole_demo_tells_the_one_account_story(client: TestClient, session: Session) -> None:
    links = seed_all(session, get_settings(), actor="test")
    assert {"event_booking", "event_staff", "wedding_share", "restaurant_staff"} <= set(links)
    assert len([name for name in links if name.startswith("showcase_venue_")]) == 4

    # The older demo events have a type but stay off the public pages.
    legacy = {
        e.name: (e.event_type, e.listed)
        for e in session.scalars(select(Event))
        if e.name in ("Ana and Bruno's wedding", "Lisbon Data Summit")
    }
    assert legacy == {
        "Ana and Bruno's wedding": ("wedding", False),
        "Lisbon Data Summit": ("conference", False),
    }
    public = str(client.get("/api/public-events", params={"limit": 50}).json())
    public += str(client.get("/api/event-venues").json())
    for name in ("wedding_share", "conference_share"):
        assert links[name].removeprefix("/j/") not in public
    assert client.get("/api/public-events", params={"limit": 50}).json()["total"] == 10

    # Restaurant discovery is unchanged: event venues are kind "event".
    found = client.get("/api/restaurants", params={"limit": 50}).json()["items"]
    assert sorted(item["name"] for item in found) == [
        "Casa Lumen",
        "Miradouro 7",
        "Pátio das Laranjeiras",
        "Tagus Terrace",
        "Tasca do Bairro",
    ]

    # Rita: one sign-in, both identities.
    both = _login(client)
    assert sorted(both) == ["guest", "work"]
    work = client.get("/api/account/work", headers=bearer(both["work"]["token"])).json()
    assert [(r["name"], r["role"]) for r in work["restaurants"]] == [("Casa Lumen", "staff")]
    assert [(v["name"], v["role"]) for v in work["event_venues"]] == [
        ("Quinta da Serra Azul", "staff")
    ]
    assert sorted((e["name"], e["role"]) for e in work["events"]) == [
        ("Leonor's christening lunch", "staff"),
        ("Sofia and Tiago's wedding", "staff"),
    ]
    work_headers = bearer(both["work"]["token"])
    casa = work["restaurants"][0]["public_id"]
    assert client.get(f"/api/staff/{casa}/schedule", headers=work_headers).status_code == 200
    christening = next(e for e in work["events"] if e["event_type"] == "christening")
    opened = client.get(f"/api/events/{christening['public_id']}", headers=work_headers)
    assert opened.status_code == 200

    guest_headers = bearer(both["guest"]["token"])
    bookings = client.get("/api/diner/bookings", headers=guest_headers).json()
    assert [b["restaurant"]["name"] for b in bookings["items"]] == ["Tagus Terrace"]
    mine = client.get("/api/guest/me", headers=guest_headers).json()["events"]
    assert [(e["name"], e["seat"] is not None) for e in mine] == [
        ("Lisbon Product Conference", True)
    ]
    assert accounts.may_show_code(session, demo_member.DEMO_MEMBER_EMAIL) is False


def test_seeding_twice_without_a_wipe_keeps_one_rita(client: TestClient, session: Session) -> None:
    seed_all(session, get_settings(), actor="test")
    links = seed_all(session, get_settings(), actor="test")
    assert links["showcase_venue_tagus_forum"] == "/venues/tagus-forum-2"
    accounts_found = session.scalars(
        select(GuestAccount).where(GuestAccount.email == "rita@example.com")
    ).all()
    assert len(accounts_found) == 1
    assert len(session.scalars(select(VenueMember)).all()) == 4
    assert sorted(_login(client)) == ["guest", "work"]
