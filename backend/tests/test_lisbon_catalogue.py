from datetime import date, time, timedelta
from urllib.parse import parse_qs, urlsplit

from conftest import make_user
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.requests import Request

from app.models import Venue, VenuePhoto, VenueTable
from app.restaurant_service import discovery, publishing
from app.routers.restaurants import BookingIn, HoldIn, book, hold
from app.seed.lisbon_catalogue import seed


def test_lisbon_demo_is_bookable_and_repeatable(session: Session) -> None:
    owner = make_user(session, "catalogue@example.com")
    assert seed(session, owner) == (20, 20)
    session.flush()

    venues = list(session.scalars(select(Venue).where(Venue.organiser_id == owner.id)))
    assert len(venues) == len({venue.slug for venue in venues}) == 20
    assert len(list(session.scalars(select(VenuePhoto)))) == 20
    assert all(venue.is_demo and venue.status == "published" for venue in venues)
    for venue in venues:
        assert publishing.problems(session, venue) == [], venue.name
        page = discovery.public_page(session, venue, preview=False)
        assert page["demo_booking"] and page["max_party"] >= 4
        assert venue.name in parse_qs(urlsplit(page["maps_url"]).query)["query"][0]
        cover = page["photos"][0]
        assert cover["is_cover"] and cover["alt"] and cover["credit"]["author"]
        assert cover["credit"]["file"].startswith("https://commons.wikimedia.org/wiki/File:")
        assert cover["credit"]["license_url"].startswith("https://creativecommons.org/")

    evening = date.today() + timedelta(days=7)
    diners = discovery.search_restaurants(
        session, discovery.Search(day=evening, at=time(20), party=2, available=True)
    )
    assert diners["total"] == 20
    assert all(
        card["demo_booking"] and card["cover_url"] and card["next_times"]
        for card in diners["items"]
    )

    venue = venues[0]
    request = Request({"type": "http", "headers": [], "client": ("127.0.0.1", 0)})
    held = hold(venue.public_id, HoldIn(date=evening, time=time(20), party=2), request, session)
    assert isinstance(held, dict)
    booking = book(
        venue.public_id,
        BookingIn(hold_id=held["hold_id"], party=2, name="Demo guest", email="guest@example.com"),
        request,
        session,
    )
    assert isinstance(booking, dict) and booking["booking"]["status"] == "confirmed"

    venues[0].description = "Owner edited this listing."
    session.flush()
    tables = len(list(session.scalars(select(VenueTable))))
    assert seed(session, owner) == (0, 0)
    assert venues[0].description == "Owner edited this listing."
    assert len(list(session.scalars(select(VenueTable)))) == tables
