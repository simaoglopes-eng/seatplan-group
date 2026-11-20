"""Six invented event venues (three halls, three quintas) with upcoming public events.

Each sits in a real area (Lisbon, Cascais, Porto, Sintra, Alentejo, Douro) so
the map and the distances make sense, but every name, street number, phone
and picture is invented. The pictures are drawn by seed/demo_photos.py.

| Venue                  | Type   | Where              | Floor plan                        |
|------------------------|--------|--------------------|-----------------------------------|
| Tagus Forum            | hall   | Parque das Nações  | theatre rows, three sections      |
| Sala Atlântico         | hall   | Cascais            | round tables of 10 (galas)        |
| Armazém da Ribeira     | hall   | Porto              | classroom tables facing a board   |
| Quinta da Serra Azul   | quinta | Sintra             | round tables of 8                 |
| Quinta dos Sobreiros   | quinta | Alentejo (Évora)   | round tables of 8                 |
| Quinta do Vale Dourado | quinta | Douro (Régua)      | round tables of 8                 |

Every venue is published with a slug, so it has a public page. The floor
plan above is the hall's own; each of its events runs on its own copy of the
hall (a private "setup" venue, events_service/layouts.py) laid out with the
one-click setup that suits it: banquet for weddings, galas, birthdays and
christenings, cabaret for the corporate dinner, theatre for the conferences at
Tagus Forum and classroom for the workshop at Armazém da Ribeira. Its events
are listed, with the shared link on and a cap, and start 9 to 54 days from today,
so they are always upcoming. About a third of the places already have a guest
and some of those chose a seat, so the maps look alive. Every event type has
at least one event.

seed() adds the rows (it assumes the demo organiser exists), does not commit,
and returns the entry links by name. One random.Random(SEED) makes the same
guests and seats on every run for the same date.
"""

import math
import random
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.layout import rebuild_neighbours
from app.events_service import layouts, share
from app.events_service.layout_presets import build
from app.events_service.problem import event_guests, venue_seats
from app.models import Event, Organiser, Seat, SeatAssignment, Venue, VenueTable, Zone, utc_now
from app.seed import demo_photos
from app.seed.demo_events import DEMO_ORGANISER_EMAIL, _group, _guest, _people
from app.seed.demo_restaurant import free_slug

SEED = 2026
ZONE = ZoneInfo("Europe/Lisbon")


@dataclass(frozen=True)
class DemoEvent:
    name: str
    event_type: str
    days_ahead: int
    start: time  # local time at the venue
    hours: int
    privacy: str
    invited: int  # guests on the list already (all said yes)
    seated: int  # of those, how many chose a seat
    share_cap: int  # newcomers through the public link


@dataclass(frozen=True)
class EventVenueSpec:
    slug: str
    name: str
    venue_type: str  # "hall" or "quinta"
    layout: str  # "theatre", "rounds8", "rounds10" or "classroom"
    address: str
    lat: float
    lng: float
    phone: str
    description: str
    photos: tuple[tuple[str, str], ...]  # (scene, alt text), the first is the cover
    events: tuple[DemoEvent, ...]
    linked: bool  # gets a showcase_venue_<slug> link on the demo page


VENUES = (
    EventVenueSpec(
        slug="tagus-forum",
        name="Tagus Forum",
        venue_type="hall",
        layout="theatre",
        address="Alameda dos Oceanos 21, Lisboa",
        lat=38.7680,
        lng=-9.0940,
        phone="+351 210 000 201",
        description="A bright auditorium by the river in Parque das Nações, with 144 seats in three sections, a stage and a large screen. Made for conferences and talks.",
        photos=(
            ("auditorium", "An illustration of an auditorium with rows of seats and a screen"),
            ("loft_workshop", "An illustration of a breakout room with tables and a whiteboard"),
        ),
        events=(
            DemoEvent(
                "Lisbon Product Conference",
                "conference",
                12,
                time(9, 0),
                8,
                "full_name",
                50,
                24,
                40,
            ),
            DemoEvent(
                "Cities and Climate Forum",
                "conference",
                40,
                time(9, 30),
                7,
                "full_name",
                36,
                12,
                60,
            ),
        ),
        linked=True,
    ),
    EventVenueSpec(
        slug="sala-atlantico",
        name="Sala Atlântico",
        venue_type="hall",
        layout="rounds10",
        address="Avenida Marginal 88, Cascais",
        lat=38.6979,
        lng=-9.4215,
        phone="+351 214 000 202",
        description="A ballroom on the Cascais seafront with tall windows, chandeliers and twelve round tables of ten. For galas, award nights and company dinners.",
        photos=(
            ("ballroom", "An illustration of a ballroom with chandeliers and round tables"),
            ("river_terrace", "An illustration of a terrace by the sea at sunset"),
        ),
        events=(
            DemoEvent(
                "Cascais Charity Gala",
                "gala_dinner",
                19,
                time(20, 0),
                5,
                "first_initial",
                40,
                18,
                30,
            ),
            DemoEvent(
                "Blue Harbour year-end dinner",
                "corporate_dinner",
                33,
                time(20, 0),
                4,
                "full_name",
                44,
                20,
                20,
            ),
        ),
        linked=True,
    ),
    EventVenueSpec(
        slug="armazem-da-ribeira",
        name="Armazém da Ribeira",
        venue_type="hall",
        layout="classroom",
        address="Rua da Fonte Taurina 30, Porto",
        lat=41.1408,
        lng=-8.6127,
        phone="+351 220 000 203",
        description="An old riverside warehouse in Porto turned into a workshop room: brick walls, a whiteboard and classroom tables for 48.",
        photos=(
            ("loft_workshop", "An illustration of a brick room with classroom tables"),
            ("auditorium", "An illustration of a small stage with a screen"),
        ),
        events=(
            DemoEvent(
                "Porto Data Workshop",
                "conference",
                26,
                time(9, 30),
                7,
                "full_name",
                18,
                8,
                20,
            ),
        ),
        linked=False,
    ),
    EventVenueSpec(
        slug="quinta-da-serra-azul",
        name="Quinta da Serra Azul",
        venue_type="quinta",
        layout="rounds8",
        address="Estrada da Pena 140, Sintra",
        lat=38.7876,
        lng=-9.3904,
        phone="+351 219 000 204",
        description="A white manor house in the Sintra hills, with a lawn, old trees and a dinner hall of ten round tables. Weddings and family days.",
        photos=(
            ("garden_quinta", "An illustration of a white quinta with a lawn and round tables"),
            ("orange_patio", "An illustration of a patio with trees and string lights"),
        ),
        events=(
            DemoEvent(
                "Sofia and Tiago's wedding",
                "wedding",
                23,
                time(15, 0),
                10,
                "first_initial",
                40,
                22,
                16,
            ),
            DemoEvent(
                "Leonor's christening lunch",
                "christening",
                9,
                time(12, 30),
                5,
                "first_initial",
                24,
                10,
                12,
            ),
        ),
        linked=True,
    ),
    EventVenueSpec(
        slug="quinta-dos-sobreiros",
        name="Quinta dos Sobreiros",
        venue_type="quinta",
        layout="rounds8",
        address="Estrada de Arraiolos km 7, Évora",
        lat=38.6050,
        lng=-7.9500,
        phone="+351 266 000 205",
        description="A farmhouse among cork oaks in the Alentejo plain, with long summer evenings and ten round tables under the trees.",
        photos=(
            ("cork_oaks", "An illustration of a white farmhouse among cork oaks at sunset"),
            ("garden_quinta", "An illustration of round tables on a lawn"),
        ),
        events=(
            DemoEvent(
                "Helena's 50th birthday",
                "birthday",
                16,
                time(13, 0),
                6,
                "first_initial",
                22,
                9,
                16,
            ),
            DemoEvent(
                "Inês and Duarte's wedding",
                "wedding",
                54,
                time(16, 0),
                10,
                "first_initial",
                30,
                14,
                20,
            ),
        ),
        linked=True,
    ),
    EventVenueSpec(
        slug="quinta-do-vale-dourado",
        name="Quinta do Vale Dourado",
        venue_type="quinta",
        layout="rounds8",
        address="Estrada Nacional 222, Peso da Régua",
        lat=41.1630,
        lng=-7.7890,
        phone="+351 254 000 206",
        description="A wine estate on the Douro terraces, above the river. Harvest dinners and celebrations in the old cellar hall.",
        photos=(
            ("vineyard_terraces", "An illustration of vineyard terraces above a river"),
            ("tasca", "An illustration of a warm cellar hall with hanging lamps"),
        ),
        events=(
            DemoEvent(
                "Douro harvest gala",
                "gala_dinner",
                47,
                time(19, 30),
                5,
                "first_initial",
                26,
                12,
                20,
            ),
        ),
        linked=False,
    ),
)


# ---------------------------------------------------------------- floor plans


def _round(session: Session, venue: Venue, label: str, cx: float, cy: float, size: int) -> None:
    """A round table, seats evenly around it, seat 1 at the top."""
    radius = 50 if size <= 8 else 60
    table = VenueTable(
        venue_id=venue.id,
        label=label,
        shape="round",
        x=cx - radius,
        y=cy - radius,
        w=2 * radius,
        h=2 * radius,
        max_party=size,
    )
    session.add(table)
    session.flush()
    for index in range(size):
        angle = -math.pi / 2 + index * 2 * math.pi / size
        session.add(
            Seat(
                venue_id=venue.id,
                table_id=table.id,
                label=str(index + 1),
                x=round(cx + (radius + 25) * math.cos(angle), 1),
                y=round(cy + (radius + 25) * math.sin(angle), 1),
            )
        )


def _rounds(session: Session, venue: Venue, tables: int, size: int, columns: int) -> None:
    gap = 240 if size <= 8 else 270
    for index in range(tables):
        row, column = divmod(index, columns)
        _round(session, venue, f"T{index + 1}", 160 + column * gap, 300 + row * gap, size)
    # Two step-free places at the table nearest the door.
    nearest = session.scalars(
        select(Seat).join(VenueTable).where(VenueTable.venue_id == venue.id).order_by(Seat.id)
    ).all()[:2]
    for seat in nearest:
        seat.is_accessible = True


def _row(
    session: Session,
    venue: Venue,
    label: str,
    at: tuple[float, float],
    seats: int,
    numbering: tuple[str, int],
) -> None:
    """A row of chairs (theatre) or a table with chairs on one side (classroom).

    `numbering` is (prefix, first number): ("A", 7) labels the seats A7, A8...
    """
    left, top = at
    prefix, first = numbering
    table = VenueTable(
        venue_id=venue.id,
        label=label,
        shape="row",
        x=left,
        y=top,
        w=seats * 50,
        h=40,
        max_party=seats,
    )
    session.add(table)
    session.flush()
    for index in range(seats):
        session.add(
            Seat(
                venue_id=venue.id,
                table_id=table.id,
                label=f"{prefix}{first + index}",
                x=left + 25 + index * 50,
                y=top + 20,
            )
        )


def _theatre(session: Session, venue: Venue) -> None:
    """8 rows (A to H), three sections of 6: the aisles break each row."""
    for row_index, row in enumerate("ABCDEFGH"):
        for section_index, section in enumerate(("Left", "Centre", "Right")):
            at = (120 + section_index * 340, 180 + row_index * 64)
            _row(session, venue, f"{row} {section}", at, 6, (row, section_index * 6 + 1))


def _classroom(session: Session, venue: Venue) -> None:
    """Six rows of two tables for four, facing the board."""
    for row_index in range(6):
        for side, left in enumerate((140, 520)):
            label = f"Row {row_index + 1} {'left' if side == 0 else 'right'}"
            at = (left, 200 + row_index * 90)
            _row(session, venue, label, at, 4, (f"R{row_index + 1}-", side * 4 + 1))


SIZES = {
    "theatre": (1300, 760),
    "classroom": (900, 800),
    "rounds8": (1300, 900),
    "rounds10": (1300, 1100),
}


def _floor_plan(session: Session, venue: Venue, layout: str) -> None:
    session.add(
        Zone(
            venue_id=venue.id,
            name="Stage" if layout in ("theatre", "classroom") else "Dance floor",
            kind="stage",
            x=450,
            y=30,
            w=400,
            h=100,
        )
    )
    if layout == "theatre":
        _theatre(session, venue)
    elif layout == "classroom":
        _classroom(session, venue)
    elif layout == "rounds10":
        _rounds(session, venue, tables=12, size=10, columns=4)
    else:
        _rounds(session, venue, tables=10, size=8, columns=5)
    session.flush()
    rebuild_neighbours(session, venue.id)


# ---------------------------------------------------------------- events


def _local(day: datetime, at: time) -> datetime:
    return datetime.combine(day.date(), at, tzinfo=ZONE).astimezone(UTC)


def _invite(session: Session, event: Event, spec: DemoEvent, rng: random.Random) -> None:
    """`spec.invited` guests in small groups; the first `spec.seated` choose a seat.

    Seats are taken in order, table by table, so a group sits together, and
    the maps show full tables next to empty ones.
    """
    people = iter(_people(rng, spec.invited))
    left, number = spec.invited, 1
    while left > 0:
        size = min(left, rng.randint(2, 5))
        group = _group(session, event, f"Group {number}", keep_adjacent=True)
        for _ in range(size):
            _guest(session, event, next(people), group)
        left -= size
        number += 1
    guests = event_guests(session, event)
    seats = [
        seat
        for seat in venue_seats(session, event.venue_id)
        if not seat.is_blocked and seat.reserved_tag is None
    ]
    for guest, seat in zip(guests[: spec.seated], seats, strict=False):
        session.add(
            SeatAssignment(event_id=event.id, guest_id=guest.id, seat_id=seat.id, source="self")
        )
    session.flush()


def setup_for(venue_layout: str, event_type: str) -> str:
    """The one-click setup a seeded event uses (see the module docstring)."""
    if event_type == "conference":
        return "classroom" if venue_layout == "classroom" else "theatre"
    if event_type == "corporate_dinner":
        return "cabaret"
    return "banquet"


def _event(
    session: Session,
    venue: Venue,
    owner: Organiser,
    spec: DemoEvent,
    rng: random.Random,
    venue_layout: str,
) -> Event:
    today = datetime.now(ZONE)
    starts_at = _local(today + timedelta(days=spec.days_ahead), spec.start)
    event = Event(
        venue_id=venue.id,
        organiser_id=owner.id,
        name=spec.name,
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=spec.hours),
        privacy_mode=spec.privacy,
        change_deadline=starts_at - timedelta(days=2),
        event_type=spec.event_type,
        listed=True,
        share_cap=spec.share_cap,
    )
    session.add(event)
    session.flush()
    layout = build(setup_for(venue_layout, spec.event_type), venue.width, venue.height)
    event.venue_id = layouts.new_setup(session, event, venue, layout).id
    session.flush()
    share.switch_on(event)
    _invite(session, event, spec, rng)
    return event


def _owner(session: Session) -> Organiser:
    owner = session.scalars(
        select(Organiser).where(Organiser.email == DEMO_ORGANISER_EMAIL)
    ).first()
    if owner is None:
        raise RuntimeError("Create the demo users before seeding the event venues.")
    return owner


def seed(session: Session) -> dict[str, str]:
    owner = _owner(session)
    rng = random.Random(SEED)
    links: dict[str, str] = {"event_booking": "/events", "event_staff": "/events/staff"}
    for spec in VENUES:
        width, height = SIZES[spec.layout]
        slug = free_slug(session, spec.slug)
        venue = Venue(
            organiser_id=owner.id,
            kind="event",
            venue_type=spec.venue_type,
            name=spec.name,
            is_demo=True,
            timezone="Europe/Lisbon",
            width=width,
            height=height,
            slug=slug,
            status="published",
            published_at=utc_now(),
            description=spec.description,
            address=spec.address,
            lat=spec.lat,
            lng=spec.lng,
            phone=spec.phone,
        )
        session.add(venue)
        session.flush()
        _floor_plan(session, venue, spec.layout)
        demo_photos.add_photos(session, venue, spec.photos)
        for event_spec in spec.events:
            _event(session, venue, owner, event_spec, rng, spec.layout)
        if spec.linked:
            links[f"showcase_venue_{spec.slug.replace('-', '_')}"] = f"/venues/{slug}"
    session.flush()
    return links
