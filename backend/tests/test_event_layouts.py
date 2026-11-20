"""Room setups for one event: the Layout tab and its own copy of the room.

GET /events/{eid}/layouts lists the seven setups fitted to the hall, with a
preview and a capacity; POST /events/{eid}/layout applies one. The event then
moves to its own private copy of the hall (a "setup" venue), so changing one
event never changes another at the same hall, and the public pages, emails
and names keep showing the hall itself.

Security first: only the event's organiser, the hall's owner and the hall's
team reach the setup or fine-tune it in the editor; a guest's seat is never
silently moved (409 until confirmed), and a re-seat keeps everyone it can.
"""

from typing import Any

from conftest import auth_header, make_user
from fastapi.testclient import TestClient
from guest_helpers import account_headers, make_account, outbox
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from test_events_setup import EventSetup, add_guest, choose, make_event
from test_public_events import _listed_event

from app.events_service import layout_presets
from app.models import (
    Event,
    Guest,
    Hold,
    LiveVersion,
    Organiser,
    PlanSnapshot,
    Seat,
    SeatAssignment,
    Venue,
    VenueTable,
)

PEOPLE = [{"name": f"Guest {n}", "email": f"guest{n}@example.com"} for n in range(1, 5)]


def _layouts(client: TestClient, setup: EventSetup) -> dict[str, Any]:
    answer = client.get(f"/api/events/{setup.eid}/layouts", headers=setup.headers)
    assert answer.status_code == 200, answer.text
    return answer.json()


def _apply(client: TestClient, setup: EventSetup, preset: str, confirm: bool | None = None) -> Any:
    body: dict[str, Any] = {"preset": preset}
    if confirm is not None:
        body["confirm"] = confirm
    return client.post(f"/api/events/{setup.eid}/layout", headers=setup.headers, json=body)


def _event(session: Session, setup: EventSetup) -> Event:
    session.expire_all()
    return session.scalars(select(Event).where(Event.public_id == setup.eid)).one()


def _rows(session: Session, event: Event) -> dict[int, SeatAssignment]:
    found = session.scalars(select(SeatAssignment).where(SeatAssignment.event_id == event.id))
    return {row.guest_id: row for row in found}


def _hall_rows(session: Session, venue_id: int) -> list[tuple[Any, ...]]:
    tables = session.scalars(select(VenueTable).where(VenueTable.venue_id == venue_id)).all()
    seats = session.scalars(select(Seat).where(Seat.venue_id == venue_id)).all()
    return [(t.id, t.x, t.y) for t in tables] + [(s.id, s.x, s.y) for s in seats]


def test_the_layout_tab_lists_seven_setups_fitted_to_the_hall(
    client: TestClient, organiser: Organiser
) -> None:
    setup = make_event(client, organiser, PEOPLE)
    data = _layouts(client, setup)
    assert data["current"] == "custom" and data["own_layout"] is False
    assert (data["capacity"], data["guests"], data["seated"]) == (8, 4, 0)
    assert [p["key"] for p in data["presets"]] == list(layout_presets.PRESET_KEYS)
    for preset in data["presets"]:
        expected = layout_presets.build(preset["key"], 1000, 500)
        assert preset["capacity"] == expected.capacity > 0
        assert preset["label"] == layout_presets.PRESETS[preset["key"]].label
        assert preset["description"]
        preview = preset["preview"]
        assert (preview["width"], preview["height"]) == (1000, 500)
        assert sum(len(t["seats"]) for t in preview["tables"]) == preset["capacity"]
        step_free = sum(s.accessible for t in expected.tables for s in t.seats)
        marked = sum(1 for t in preview["tables"] for s in t["seats"] if "accessible" in s)
        assert marked == step_free
        for table in preview["tables"]:
            assert set(table) == {"shape", "x", "y", "w", "h", "rotation", "seats"}
            # Only a step-free seat says so, to keep the thumbnail small.
            for seat in table["seats"]:
                assert set(seat) in ({"x", "y"}, {"x", "y", "accessible"})
                assert seat.get("accessible", True) is True
            assert all(isinstance(v, int) for v in (table["x"], table["y"], table["w"]))
    # Small enough for a thumbnail: whole numbers, no labels, no ids.
    assert len(str(data["presets"])) < 40_000


def test_applying_a_setup_gives_the_event_its_own_private_copy(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    setup = make_event(client, organiser, PEOPLE)
    hall_id = _event(session, setup).venue_id
    hall_before = _hall_rows(session, hall_id)
    hall_public = session.get(Venue, hall_id).public_id

    applied = _apply(client, setup, "banquet")
    assert applied.status_code == 200, applied.text
    body = applied.json()
    assert body["current"] == "banquet" and body["own_layout"] is True
    assert body["capacity"] == layout_presets.build("banquet", 1000, 500).capacity == 30
    assert (body["guests"], body["seated"], body["reseated"], body["unseated"]) == (4, 0, 0, 0)

    event = _event(session, setup)
    copy = session.get(Venue, event.venue_id)
    assert copy is not None and copy.id != hall_id and copy.parent_venue_id == hall_id
    assert copy.public_id == body["venue_id"] != hall_public
    assert (copy.kind, copy.status, copy.slug, copy.organiser_id) == (
        "event",
        "draft",
        None,
        organiser.id,
    )
    assert (copy.width, copy.height) == (1000, 500)
    assert len(session.scalars(select(Seat).where(Seat.venue_id == copy.id)).all()) == 30
    assert _hall_rows(session, hall_id) == hall_before

    # Names stay the hall's; the map comes from the copy.
    opened = client.get(f"/api/events/{setup.eid}", headers=setup.headers).json()
    assert opened["venue"] == {"public_id": copy.public_id, "name": "Hall"}
    assert opened["event"]["venue_name"] == "Hall"
    assert len(opened["map"]["seats"]) == 30
    listed = client.get("/api/events", headers=setup.headers).json()
    assert [e["venue_name"] for e in listed] == ["Hall"]
    # The copy is never listed as a venue, and is no venue for a new event.
    venues = client.get("/api/venues", headers=setup.headers).json()
    assert [v["public_id"] for v in venues] == [hall_public]
    work = client.get("/api/account/work", headers=setup.headers).json()
    assert [v["public_id"] for v in work["event_venues"]] == [hall_public]
    assert [e["venue_public_id"] for e in work["events"]] == [hall_public]
    new_event = {
        "venue_id": copy.public_id,
        "name": "Sneaky",
        "starts_at": "2030-05-02T18:00:00Z",
        "ends_at": "2030-05-02T23:00:00Z",
    }
    refused = client.post("/api/events", headers=setup.headers, json=new_event)
    assert refused.status_code == 404
    team = client.get(f"/api/owner/venues/{copy.public_id}/members", headers=setup.headers)
    assert team.status_code == 404
    assert _layouts(client, setup)["current"] == "banquet"


def test_seated_guests_are_never_moved_without_confirm(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    setup = make_event(client, organiser, PEOPLE)
    choose(client, setup, "Guest 1", setup.seats[0][0])
    choose(client, setup, "Guest 2", setup.seats[0][1])
    before = _event(session, setup)
    venue_before, rows_before = before.venue_id, _rows(session, before)

    for confirm in (None, False):
        refused = _apply(client, setup, "theatre", confirm)
        assert refused.status_code == 409
        assert refused.json() == {
            "error": {
                "code": "guests_seated",
                "message": (
                    "2 guests already have a seat. Applying the Theatre setup will re-seat "
                    "them on the new layout and email anyone whose seat changes."
                ),
                "details": {
                    "seated": 2,
                    "capacity": 28,
                    "guests": 4,
                    "accessible_needed": 0,
                    "accessible_seats": 4,
                    "holding": 0,
                },
            }
        }
    after = _event(session, setup)
    assert after.venue_id == venue_before
    assert {g: r.seat_id for g, r in _rows(session, after).items()} == {
        g: r.seat_id for g, r in rows_before.items()
    }
    # Other errors keep their old shape: no "details" key.
    missing = client.get("/api/events/nope/layouts", headers=setup.headers)
    assert missing.status_code == 404 and "details" not in missing.json()["error"]


def test_confirm_reseats_everyone_keeps_groups_releases_holds_and_emails(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    people = [{"name": f"Family {n}", "group": "Family", "keep_adjacent": True} for n in range(3)]
    people = [{**p, "email": f"family{n}@example.com"} for n, p in enumerate(people)]
    people += [{"name": "Solo", "email": "solo@example.com"}, {"name": "Waiting"}]
    setup = make_event(client, organiser, people, tables=2, per_table=4)
    choose(client, setup, "Family 0", setup.seats[0][0])
    choose(client, setup, "Family 1", setup.seats[1][0])
    choose(client, setup, "Family 2", setup.seats[1][2])
    choose(client, setup, "Solo", setup.seats[0][2])
    held = client.post(
        f"/api/a/{setup.tokens['Waiting']}/hold", json={"seat_id": setup.seats[0][3]}
    )
    assert held.status_code == 200, held.text
    event = _event(session, setup)
    old_seats = {g: r.seat_id for g, r in _rows(session, event).items()}
    version_before = session.get(LiveVersion, f"event-{setup.eid}").version

    applied = _apply(client, setup, "banquet", confirm=True)
    assert applied.status_code == 200, applied.text
    body = applied.json()
    assert (body["seated"], body["reseated"], body["unseated"]) == (4, 4, 0)

    event = _event(session, setup)
    rows = _rows(session, event)
    assert set(rows) == set(old_seats)
    new_seats = {g: session.get(Seat, r.seat_id) for g, r in rows.items()}
    assert all(seat.venue_id == event.venue_id for seat in new_seats.values())
    # The family sits at one table; people who chose stay protected from auto-fill.
    family = [setup.guests[f"Family {n}"] for n in range(3)]
    assert len({new_seats[g].table_id for g in family}) == 1
    assert {r.source for r in rows.values()} == {"organiser"}
    assert session.scalars(select(Hold).where(Hold.scope == f"event-{setup.eid}")).all() == []
    assert session.get(LiveVersion, f"event-{setup.eid}").version > version_before

    changed = [m for m in outbox(session, "seat_changed") if "has changed" in m.subject]
    assert sorted(m.to_email for m in changed) == [
        "family0@example.com",
        "family1@example.com",
        "family2@example.com",
        "solo@example.com",
    ]
    for mail in changed:
        assert "Before: seat " in mail.body_text and "seat none" not in mail.body_text
        assert " at table T" in mail.body_text.split("Before: seat ")[1].split(".")[0]
    # Old plans name seats that are gone: there is nothing to undo past the new room.
    undo = client.post(f"/api/events/{setup.eid}/undo", headers=setup.headers)
    assert undo.status_code == 409
    assert client.get(f"/api/events/{setup.eid}/scenarios", headers=setup.headers).json() == []
    kinds = {snap.assignments["kind"] for snap in session.scalars(select(PlanSnapshot))}
    assert kinds <= {"history", "retired"}


def _small_hall_event(
    client: TestClient, session: Session, organiser: Organiser, seats: int, guests: int
) -> EventSetup:
    """A 400 x 400 cm room with one row of `seats` chairs, `guests` people coming."""
    headers = auth_header(organiser)
    venue = client.post(
        "/api/venues",
        headers=headers,
        json={"kind": "event", "name": "Small room", "width": 400, "height": 400},
    ).json()["public_id"]
    layout = {
        "zones": [],
        "tables": [
            {
                "key": "r",
                "label": "Row",
                "shape": "row",
                "x": 20,
                "y": 100,
                "w": 30 * seats,
                "h": 30,
                "max_party": seats,
            }
        ],
        "seats": [
            {"key": f"s{n}", "table_key": "r", "label": str(n + 1), "x": 35 + 30 * n, "y": 115}
            for n in range(seats)
        ],
    }
    saved = client.put(f"/api/venues/{venue}/layout", headers=headers, json=layout)
    assert saved.status_code == 200, saved.text
    seat_ids = [s["id"] for s in sorted(saved.json()["seats"], key=lambda s: int(s["label"]))]
    event = client.post(
        "/api/events",
        headers=headers,
        json={
            "venue_id": venue,
            "name": "Small meeting",
            "starts_at": "2030-05-01T09:00:00Z",
            "ends_at": "2030-05-01T12:00:00Z",
        },
    ).json()["public_id"]
    setup = EventSetup(eid=event, headers=headers, seats=[seat_ids])
    for n in range(guests):
        add_guest(client, setup, {"name": f"Person {n}", "email": f"person{n}@example.com"})
    return setup


def test_a_setup_smaller_than_the_guest_list_needs_confirm(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    setup = _small_hall_event(client, session, organiser, seats=10, guests=10)
    assert layout_presets.build("boardroom", 400, 400).capacity == 8
    too_small = _apply(client, setup, "banquet", confirm=True)
    assert too_small.status_code == 422
    assert too_small.json()["error"]["message"] == (
        "This room is too small for the Banquet setup. Choose another setup."
    )

    refused = _apply(client, setup, "boardroom")
    assert refused.status_code == 422
    assert refused.json()["error"] == {
        "code": "not_enough_seats",
        "message": (
            "The Boardroom setup has 8 seats but 10 guests are coming. "
            "Choose a larger setup, or confirm to seat as many as fit."
        ),
        "details": {
            "seated": 0,
            "capacity": 8,
            "guests": 10,
            "accessible_needed": 0,
            "accessible_seats": 2,
            "holding": 0,
        },
    }
    accepted = _apply(client, setup, "boardroom", confirm=True)
    assert accepted.status_code == 200, accepted.text
    assert (accepted.json()["capacity"], accepted.json()["seated"]) == (8, 0)


def test_who_cannot_fit_stays_unseated_is_counted_and_told(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    setup = _small_hall_event(client, session, organiser, seats=10, guests=10)
    for n, seat_id in enumerate(setup.seats[0]):
        guest_id = setup.guests[f"Person {n}"]
        placed = client.put(
            f"/api/events/{setup.eid}/assignments/{guest_id}",
            headers=setup.headers,
            json={"seat_id": seat_id},
        )
        assert placed.status_code == 200, placed.text
    refused = _apply(client, setup, "boardroom")
    assert refused.status_code == 409
    assert refused.json()["error"]["details"] == {
        "seated": 10,
        "capacity": 8,
        "guests": 10,
        "accessible_needed": 0,
        "accessible_seats": 2,
        "holding": 0,
    }

    applied = _apply(client, setup, "boardroom", confirm=True)
    assert applied.status_code == 200, applied.text
    body = applied.json()
    assert (body["seated"], body["reseated"], body["unseated"]) == (8, 8, 2)
    cancelled = outbox(session, "seat_cancelled")
    assert len(cancelled) == 2
    assert all("seat none" not in mail.body_text for mail in cancelled)


def test_another_event_at_the_same_hall_is_never_touched(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    first = make_event(client, organiser, PEOPLE)
    hall_id = _event(session, first).venue_id
    hall = session.get(Venue, hall_id)
    second_id = client.post(
        "/api/events",
        headers=first.headers,
        json={
            "venue_id": hall.public_id,
            "name": "Second party",
            "starts_at": "2030-06-01T18:00:00Z",
            "ends_at": "2030-06-01T23:00:00Z",
        },
    ).json()["public_id"]
    second = EventSetup(eid=second_id, headers=first.headers, seats=first.seats)
    for person in PEOPLE:
        add_guest(client, second, person)
    choose(client, first, "Guest 1", first.seats[0][0])
    choose(client, second, "Guest 1", second.seats[0][0])
    choose(client, second, "Guest 2", second.seats[1][1])
    hold = client.post(
        f"/api/a/{second.tokens['Guest 3']}/hold", json={"seat_id": second.seats[1][2]}
    )
    assert hold.status_code == 200
    other = _event(session, second)
    other_rows = {g: r.seat_id for g, r in _rows(session, other).items()}
    other_holds = [
        (h.resource_id, h.holder_key)
        for h in session.scalars(select(Hold).where(Hold.scope == f"event-{second_id}"))
    ]
    hall_before = _hall_rows(session, hall_id)

    for preset in ("banquet", "cabaret"):
        assert _apply(client, first, preset, confirm=True).status_code == 200

    other = _event(session, second)
    assert other.venue_id == hall_id
    assert {g: r.seat_id for g, r in _rows(session, other).items()} == other_rows
    assert [
        (h.resource_id, h.holder_key)
        for h in session.scalars(select(Hold).where(Hold.scope == f"event-{second_id}"))
    ] == other_holds
    assert _hall_rows(session, hall_id) == hall_before
    assert _layouts(client, second)["current"] == "custom"


def test_a_new_setup_replaces_the_copy_and_keeps_its_link(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    setup = make_event(client, organiser, PEOPLE)
    choose(client, setup, "Guest 1", setup.seats[0][0])
    first = _apply(client, setup, "banquet", confirm=True).json()
    second = _apply(client, setup, "cabaret", confirm=True).json()
    assert second["venue_id"] == first["venue_id"] and second["current"] == "cabaret"
    session.expire_all()
    copies = session.scalars(select(Venue).where(Venue.parent_venue_id.is_not(None))).all()
    assert [c.public_id for c in copies] == [first["venue_id"]]
    total = session.scalar(select(func.count()).select_from(Seat))
    assert total == 8 + layout_presets.build("cabaret", 1000, 500).capacity
    event = _event(session, setup)
    (row,) = _rows(session, event).values()
    assert session.get(Seat, row.seat_id).venue_id == copies[0].id


def _layout_body(detail: dict[str, Any]) -> dict[str, Any]:
    """The editor's GET answer turned back into a PUT body, unchanged."""
    fields = {
        "zones": ("id", "key", "name", "kind", "x", "y", "w", "h"),
        "tables": (
            "id",
            "key",
            "label",
            "shape",
            "x",
            "y",
            "w",
            "h",
            "rotation",
            "min_party",
            "max_party",
            "is_accessible",
            "high_chair_ok",
            "combine_group",
        ),
        "seats": ("id", "key", "label", "x", "y", "is_accessible", "is_blocked", "reserved_tag"),
    }
    zone_keys = {z["id"]: z["key"] for z in detail["zones"]}
    table_keys = {t["id"]: t["key"] for t in detail["tables"]}
    body: dict[str, Any] = {}
    for name, keep in fields.items():
        body[name] = [{k: row[k] for k in keep} for row in detail[name]]
    for table, raw in zip(body["tables"], detail["tables"], strict=True):
        table["zone_key"] = zone_keys.get(raw["zone_id"])
    for seat, raw in zip(body["seats"], detail["seats"], strict=True):
        seat["table_key"] = table_keys[raw["table_id"]]
    return body


def test_every_setup_opens_and_saves_unchanged_in_the_editor(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    setup = make_event(client, organiser, PEOPLE)
    choose(client, setup, "Guest 1", setup.seats[0][0])
    for key in layout_presets.PRESET_KEYS:
        venue_id = _apply(client, setup, key, confirm=True).json()["venue_id"]
        detail = client.get(f"/api/venues/{venue_id}", headers=setup.headers)
        assert detail.status_code == 200, detail.text
        saved = client.put(
            f"/api/venues/{venue_id}/layout",
            headers=setup.headers,
            json=_layout_body(detail.json()),
        )
        assert saved.status_code == 200, (key, saved.text)
        assert _layouts(client, setup)["current"] == key
        assert _layouts(client, setup)["seated"] == 1


def test_only_the_event_people_fine_tune_its_setup_in_the_editor(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    setup = make_event(client, organiser, PEOPLE)
    hall = session.get(Venue, _event(session, setup).venue_id)
    venue_id = _apply(client, setup, "banquet").json()["venue_id"]
    detail = client.get(f"/api/venues/{venue_id}", headers=setup.headers).json()
    body = _layout_body(detail)

    member = make_user(session, "mia.member@example.com")
    added = client.post(
        f"/api/owner/venues/{hall.public_id}/members",
        headers=setup.headers,
        json={"email": member.email},
    )
    assert added.status_code == 201
    stranger_owner = make_user(session, "other.owner@example.com")
    stranger = make_event(client, stranger_owner, [])
    other_member = make_user(session, "otto.member@example.com")
    other_hall = session.get(Venue, _event(session, stranger).venue_id)
    client.post(
        f"/api/owner/venues/{other_hall.public_id}/members",
        headers=stranger.headers,
        json={"email": other_member.email},
    )
    staff = make_user(session, "sam.staff@example.com", role="staff")

    for user, expected in (
        (organiser, (200, 200)),
        (member, (200, 200)),
        (stranger_owner, (404, 404)),
        (other_member, (404, 404)),
        # The demo staff role never runs events: no setup to read, no organiser login.
        (staff, (404, 403)),
    ):
        headers = auth_header(user)
        got = client.get(f"/api/venues/{venue_id}", headers=headers)
        put = client.put(f"/api/venues/{venue_id}/layout", headers=headers, json=body)
        assert (got.status_code, put.status_code) == expected, user.email

    # The hall itself stays owner-only in the editor, members included.
    hall_detail = client.get(f"/api/venues/{hall.public_id}", headers=setup.headers).json()
    hall_body = _layout_body(hall_detail)
    member_put = client.put(
        f"/api/venues/{hall.public_id}/layout", headers=auth_header(member), json=hall_body
    )
    assert member_put.status_code == 404

    # A real change in the editor makes the setup "custom".
    body["tables"][0]["x"] += 10
    for seat in body["seats"]:
        if seat["table_key"] == body["tables"][0]["key"]:
            seat["x"] += 10
    moved = client.put(f"/api/venues/{venue_id}/layout", headers=setup.headers, json=body)
    assert moved.status_code == 200
    assert _layouts(client, setup)["current"] == "custom"


def test_the_hall_team_runs_the_event_on_its_setup(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    setup = make_event(client, organiser, PEOPLE)
    hall = session.get(Venue, _event(session, setup).venue_id)
    _apply(client, setup, "theatre")
    member = make_user(session, "mia.member@example.com")
    headers = auth_header(member)
    assert client.get(f"/api/events/{setup.eid}", headers=headers).status_code == 404
    client.post(
        f"/api/owner/venues/{hall.public_id}/members",
        headers=setup.headers,
        json={"email": member.email},
    )
    assert client.get(f"/api/events/{setup.eid}", headers=headers).status_code == 200
    assert client.get(f"/api/events/{setup.eid}/layouts", headers=headers).status_code == 200
    assert _apply(client, EventSetup(setup.eid, headers, []), "banquet").status_code == 200
    listed = client.get("/api/events", headers=headers).json()
    assert [(e["public_id"], e["role"], e["venue_name"]) for e in listed] == [
        (setup.eid, "staff", "Hall")
    ]
    work = client.get("/api/account/work", headers=headers).json()
    assert [v["public_id"] for v in work["event_venues"]] == [hall.public_id]
    assert [e["venue_public_id"] for e in work["events"]] == [hall.public_id]


def test_public_pages_and_guests_still_see_the_hall(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    setup, token = _listed_event(client, session, organiser, "quinta-inventada")
    hall = session.get(Venue, _event(session, setup).venue_id)
    assert _apply(client, setup, "banquet").status_code == 200

    public = client.get("/api/public-events").json()
    assert public["total"] == 1
    item = public["items"][0]
    assert item["venue"]["slug"] == "quinta-inventada" and item["venue"]["name"] == "Hall"
    assert item["places_left"] > 0
    venues = client.get("/api/event-venues").json()["items"]
    assert [(v["slug"], v["upcoming_count"]) for v in venues] == [("quinta-inventada", 1)]
    page = client.get("/api/event-venues/quinta-inventada").json()
    assert [e["public_id"] for e in page["upcoming"]] == [setup.eid]
    visitor = client.get(f"/api/j/{token}").json()
    assert visitor["venue"] == {"name": "Hall"}
    assert len(visitor["map"]["seats"]) == layout_presets.build("banquet", 1000, 500).capacity

    # A guest account on the event sees the hall in "my events".
    account = make_account(session, "joiner@example.com")
    event = _event(session, setup)
    session.add(
        Guest(
            event_id=event.id,
            name="Joiner",
            email=account.email,
            token_hash="x" * 64,
            account_id=account.id,
            source="self_registered",
            rsvp="yes",
        )
    )
    session.commit()
    mine = client.get("/api/guest/me", headers=account_headers(account)).json()["events"]
    assert [e["venue_name"] for e in mine] == [hall.name]


def test_unknown_setups_and_strangers_are_refused(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    setup = make_event(client, organiser, PEOPLE)
    assert _apply(client, setup, "dinner_party").status_code == 422
    body = {"preset": "banquet", "extra": 1}
    extra = client.post(f"/api/events/{setup.eid}/layout", headers=setup.headers, json=body)
    assert extra.status_code == 422
    stranger = auth_header(make_user(session, "stranger@example.com"))
    assert client.get(f"/api/events/{setup.eid}/layouts", headers=stranger).status_code == 404
    refused = client.post(
        f"/api/events/{setup.eid}/layout", headers=stranger, json={"preset": "banquet"}
    )
    assert refused.status_code == 404
    assert client.get(f"/api/events/{setup.eid}/layouts").status_code == 401
    assert _event(session, setup).venue_id == session.scalar(select(func.min(Venue.id)))
    assert _layouts(client, setup)["own_layout"] is False


def test_account_holders_get_their_seat_picture_on_every_setup(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    """Everyone who joins with the public link has an account: their seat email
    carries a picture drawn from the event's own copy, on every setup."""
    people = [{"name": f"Member {n}", "email": f"member{n}@example.com"} for n in range(30)]
    setup = make_event(client, organiser, people, tables=4, per_table=8)
    for n in range(30):
        account = make_account(session, f"member{n}@example.com", f"Member {n}")
        guest = session.get(Guest, setup.guests[f"Member {n}"])
        guest.account_id = account.id
    session.commit()
    seats = [seat for table in setup.seats for seat in table]
    for n in range(30):
        placed = client.put(
            f"/api/events/{setup.eid}/assignments/{setup.guests[f'Member {n}']}",
            headers=setup.headers,
            json={"seat_id": seats[n]},
        )
        assert placed.status_code == 200, placed.text
    for key in layout_presets.PRESET_KEYS:
        before = {m.id for m in outbox(session, "seat_changed")}
        applied = _apply(client, setup, key, confirm=True)
        assert applied.status_code == 200, (key, applied.text)
        body = applied.json()
        assert body["reseated"] + body["unseated"] == body["seated"] + body["unseated"]
        new = [m for m in outbox(session, "seat_changed") if m.id not in before]
        assert len(new) == body["reseated"] > 0, key
        assert all(m.image_png for m in new), key
        assert all("Hall" in m.body_text and "room setup" not in m.body_text for m in new)


def test_the_usual_event_flows_work_on_a_setup_copy(
    client: TestClient, session: Session, organiser: Organiser, monkeypatch: Any
) -> None:
    from guest_helpers import open_link, sign_up

    setup = make_event(client, organiser, PEOPLE)
    old_hall_seat = setup.seats[0][0]
    choose(client, setup, "Guest 1", old_hall_seat)
    token_link = open_link(client, setup)
    assert _apply(client, setup, "banquet", confirm=True).status_code == 200
    event = _event(session, setup)
    copy_seats = [
        s.id for s in session.scalars(select(Seat).where(Seat.venue_id == event.venue_id))
    ]
    taken = {r.seat_id for r in _rows(session, event).values()}
    free = [seat_id for seat_id in copy_seats if seat_id not in taken]

    # The attendee page shows the copy; a seat of the hall is no longer a seat here.
    page = setup.page(client, "Guest 2")
    assert page["venue"] == {"name": "Hall"} and len(page["map"]["seats"]) == 30
    token = setup.tokens["Guest 2"]
    assert client.post(f"/api/a/{token}/hold", json={"seat_id": old_hall_seat}).status_code == 404
    choose(client, setup, "Guest 2", free[0])

    # Someone joins with the shared link and picks a seat of the copy.
    joined = sign_up(client, token_link, "joiner@example.com", "Joiner")
    headers = {"Authorization": f"Bearer {joined['token']}"}
    mine = client.get(f"/api/guest/events/{setup.eid}", headers=headers)
    assert mine.status_code == 200, mine.text
    assert len(mine.json()["map"]["seats"]) == 30
    held = client.post(
        f"/api/guest/events/{setup.eid}/hold", headers=headers, json={"seat_id": free[1]}
    )
    assert held.status_code == 200, held.text
    done = client.post(
        f"/api/guest/events/{setup.eid}/confirm", headers=headers, json={"seat_id": free[1]}
    )
    assert done.status_code == 200, done.text

    # Auto-fill, apply its scenario, undo it.
    scenario = client.post(
        f"/api/events/{setup.eid}/optimise/autofill", headers=setup.headers, json={"seed": 1}
    )
    assert scenario.status_code == 200, scenario.text
    sid = scenario.json()["id"]
    assert set(scenario.json()["assignments"].values()) <= set(copy_seats)
    applied = client.post(f"/api/events/{setup.eid}/scenarios/{sid}/apply", headers=setup.headers)
    assert applied.status_code == 200 and applied.json()["conflicts"] == []
    assert _layouts(client, setup)["seated"] == 5
    undone = client.post(f"/api/events/{setup.eid}/undo", headers=setup.headers)
    assert undone.status_code == 200, undone.text
    assert _layouts(client, setup)["seated"] == 3

    # Print and export read the copy.
    chart = client.get(f"/api/events/{setup.eid}/chart", headers=setup.headers)
    assert chart.status_code == 200
    assert {t["label"] for t in chart.json()["tables"]} >= {"T1"}
    exported = client.get(f"/api/events/{setup.eid}/export.csv", headers=setup.headers)
    assert exported.status_code == 200 and "Guest 1" in exported.text


def test_the_confirm_step_names_guests_who_would_lose_a_step_free_seat(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    """Needing a step-free seat is a hard rule for the re-seat. A setup with
    fewer step-free seats than the seated guests who need one cannot keep
    them all: the 409 says so before anything changes, with the counts."""
    people = [
        {"name": f"W{n}", "email": f"w{n}@example.com", "needs_accessible": n < 6} for n in range(7)
    ]
    setup = make_event(client, organiser, people, tables=2, per_table=4)
    event = _event(session, setup)
    for seat in session.scalars(select(Seat).where(Seat.venue_id == event.venue_id)):
        seat.is_accessible = True
    session.commit()
    for n in range(7):
        choose(client, setup, f"W{n}", setup.seats[n // 4][n % 4])
    banquet = layout_presets.build("banquet", 1000, 500)
    step_free = sum(seat.accessible for table in banquet.tables for seat in table.seats)
    assert step_free == 4

    refused = _apply(client, setup, "banquet")
    assert refused.status_code == 409
    error = refused.json()["error"]
    assert error["details"] == {
        "seated": 7,
        "capacity": 30,
        "guests": 7,
        "accessible_needed": 6,
        "accessible_seats": 4,
        "holding": 0,
    }
    assert "Only 4 seats in the Banquet setup are step-free" in error["message"]
    assert "at least 2 guests who need one will lose their seat" in error["message"]

    applied = _apply(client, setup, "banquet", confirm=True).json()
    assert (applied["reseated"], applied["unseated"]) == (5, 2)

    # The previews show where the step-free seats are.
    preview = next(p for p in _layouts(client, setup)["presets"] if p["key"] == "banquet")
    marked = [s for t in preview["preview"]["tables"] for s in t["seats"] if s.get("accessible")]
    assert len(marked) == 4


def test_the_step_free_sentence_reads_right_for_one_and_for_none() -> None:
    from app.events_service.layouts import _step_free_loss

    def loss(needed: int, seats: int) -> str:
        return _step_free_loss(
            "Classroom", {"accessible_needed": needed, "accessible_seats": seats}
        )

    assert loss(3, 2) == (
        " Only 2 seats in the Classroom setup are step-free, so at least 1 guest who needs one "
        "will lose their seat."
    )
    assert loss(2, 1).startswith(" Only 1 seat in the Classroom setup is step-free, so at least 1")
    assert loss(2, 0).startswith(
        " No seat in the Classroom setup is step-free, so at least 2 guests"
    )
    assert loss(2, 2) == loss(0, 4) == ""


def test_the_confirm_step_counts_people_choosing_a_seat_right_now(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    setup = make_event(client, organiser, PEOPLE)
    choose(client, setup, "Guest 1", setup.seats[0][0])
    held = client.post(
        f"/api/a/{setup.tokens['Guest 2']}/hold", json={"seat_id": setup.seats[1][0]}
    )
    assert held.status_code == 200, held.text
    refused = _apply(client, setup, "banquet")
    assert refused.status_code == 409
    assert refused.json()["error"]["details"]["holding"] == 1


def test_the_setup_in_use_again_changes_nothing_and_emails_nobody(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    """From a stale tab or the API: the room already is that setup, so a second
    apply would only move everyone to identical seats and email them all."""
    setup = make_event(client, organiser, PEOPLE)
    for n, seat in ((1, setup.seats[0][0]), (2, setup.seats[0][1])):
        choose(client, setup, f"Guest {n}", seat)
    assert _apply(client, setup, "banquet", confirm=True).status_code == 200
    event = _event(session, setup)
    room, seats = event.venue_id, {g: r.seat_id for g, r in _rows(session, event).items()}
    mails = len(outbox(session, "seat_changed"))

    again = _apply(client, setup, "banquet", confirm=True)
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "conflict"
    assert again.json()["error"]["message"] == (
        "The Banquet setup is already in use. Nothing changed."
    )
    event = _event(session, setup)
    assert event.venue_id == room
    assert {g: r.seat_id for g, r in _rows(session, event).items()} == seats
    assert len(outbox(session, "seat_changed")) == mails


def test_nobody_is_emailed_when_their_seat_keeps_its_place_and_name(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    """After a tweak in the editor, the same setup again rebuilds the room: a
    guest who gets the seat with the same table, number and place has nothing
    new to read. The audit row is still written for everyone re-seated."""
    from app.models import AuditLog

    setup = make_event(client, organiser, PEOPLE)
    for n, seat in ((1, setup.seats[0][0]), (2, setup.seats[0][1]), (3, setup.seats[1][0])):
        choose(client, setup, f"Guest {n}", seat)
    assert _apply(client, setup, "banquet", confirm=True).status_code == 200
    event = _event(session, setup)
    taken = {r.seat_id for r in _rows(session, event).values()}
    spare = session.scalars(
        select(Seat).where(Seat.venue_id == event.venue_id, Seat.id.not_in(taken))
    ).first()
    spare.x += 1  # a tweak in the editor, on a seat nobody has
    session.commit()
    assert _layouts(client, setup)["current"] == "custom"
    before = {g: _place(session, r.seat_id) for g, r in _rows(session, event).items()}
    mails = {m.id for m in outbox(session, "seat_changed")}
    moves = session.scalar(
        select(func.count()).select_from(AuditLog).where(AuditLog.action == "seat.layout_move")
    )

    applied = _apply(client, setup, "banquet", confirm=True)
    assert applied.status_code == 200, applied.text
    assert applied.json()["reseated"] == 3
    event = _event(session, setup)
    after = {g: _place(session, r.seat_id) for g, r in _rows(session, event).items()}
    new = [m for m in outbox(session, "seat_changed") if m.id not in mails]
    moved = {g for g in after if after[g] != before[g]}
    assert sorted(m.to_email for m in new) == sorted(
        f"guest{g_n}@example.com"
        for g_n in [n for n in (1, 2, 3) if setup.guests[f"Guest {n}"] in moved]
    )
    assert moved != set(after), "the solver gave everyone a new place: the test proves nothing"
    assert (
        session.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.action == "seat.layout_move")
        )
        == moves + 3
    )


def _place(session: Session, seat_id: int) -> tuple[Any, ...]:
    seat = session.get(Seat, seat_id)
    table = session.get(VenueTable, seat.table_id)
    return (table.label, seat.label, seat.x, seat.y)


def test_room_setups_are_rate_limited_per_person(
    client: TestClient, session: Session, organiser: Organiser, monkeypatch: Any
) -> None:
    from app.routers import events as events_router

    monkeypatch.setattr(events_router, "LAYOUT_APPLIES_PER_MINUTE", 2)
    setup = make_event(client, organiser, PEOPLE)
    assert _apply(client, setup, "banquet").status_code == 200
    assert _apply(client, setup, "cabaret").status_code == 200
    third = _apply(client, setup, "theatre")
    assert third.status_code == 429
    assert third.json()["error"]["code"] == "rate_limited"
    assert _layouts(client, setup)["current"] == "cabaret"


def test_a_write_that_loaded_the_event_before_a_setup_change_uses_the_new_room(
    client: TestClient, session: Session, organiser: Organiser
) -> None:
    """Staff B's request loads the event, organiser A changes the setup and
    commits, then B's write takes the lock: it must see the new room and never
    put a guest on a seat of the old one (the hall's, or a removed copy's)."""
    from app.core.errors import ApiError
    from app.events_service.schemas import SeatChoice
    from app.events_service.seating import confirm_seat, hold_seat
    from app.routers import events as events_router

    people = [{"name": f"G{n}", "email": f"g{n}@example.com"} for n in range(3)]
    setup = make_event(client, organiser, people, tables=2, per_table=4)
    choose(client, setup, "G0", setup.seats[0][0])
    user = session.merge(organiser)
    g1, g2 = setup.guests["G1"], setup.guests["G2"]
    hall_seat = setup.seats[1][1]

    def loaded_now() -> Event:
        # What a request holds after load_event, before it takes the lock.
        session.expire_all()
        return session.scalars(select(Event).where(Event.public_id == setup.eid)).one()

    def status_of(call: Any) -> int:
        try:
            call()
        except ApiError as error:
            session.rollback()
            return error.status
        raise AssertionError("the write went through on the old room")

    # 1. The hall's own plan, then a setup copy.
    stale = loaded_now()
    hall_id = stale.venue_id
    assert _apply(client, setup, "banquet", confirm=True).status_code == 200
    choice = SeatChoice(seat_id=hall_seat)
    assert status_of(lambda: events_router.assign_seat(setup.eid, g1, choice, user, session)) == 404
    stale = loaded_now()
    assert _apply(client, setup, "cabaret", confirm=True).status_code == 200
    guest = session.get(Guest, g2)
    assert status_of(lambda: hold_seat(session, stale, guest, hall_seat)) == 404
    assert status_of(lambda: confirm_seat(session, stale, guest, hall_seat)) == 404

    # 2. One copy, then the next: the first copy and its seats are gone.
    stale = loaded_now()
    copy_seat = session.scalars(
        select(Seat.id).where(Seat.venue_id == stale.venue_id).order_by(Seat.id)
    ).first()
    assert _apply(client, setup, "theatre", confirm=True).status_code == 200
    gone = SeatChoice(seat_id=copy_seat)
    assert status_of(lambda: events_router.assign_seat(setup.eid, g1, gone, user, session)) == 404

    # A seat of the room in use still works, and lands in that room.
    event = _event(session, setup)
    taken = {row.seat_id for row in _rows(session, event).values()}
    free = next(
        seat_id
        for seat_id in session.scalars(select(Seat.id).where(Seat.venue_id == event.venue_id))
        if seat_id not in taken
    )
    loaded_now()
    events_router.assign_seat(setup.eid, g1, SeatChoice(seat_id=free), user, session)
    event = _event(session, setup)
    assert event.venue_id != hall_id
    assert session.get(Seat, _rows(session, event)[g1].seat_id).venue_id == event.venue_id
