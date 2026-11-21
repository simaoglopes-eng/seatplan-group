"""The one-click room setups for events: pure geometry, no database.

Each preset fills a room of a given width and height (cm) with tables and
seats, the front of the room at the top. These tests check the promises the
Layout tab makes: everything fits inside the room, nothing overlaps, every
setup has step-free places, the capacity is the seat count, and the numbers
for the seeded halls and quintas stay exactly what the demo shows.
"""

import math
from itertools import combinations

import pytest

from app.events_service.layout_presets import (
    MAX_SEATS,
    PRESET_KEYS,
    PRESETS,
    PresetLayout,
    PresetTable,
    build,
    matches,
)

ROOMS = ((1300, 1100), (1300, 900), (1300, 760), (900, 800), (2000, 1500), (600, 500))


def _footprint(table: PresetTable) -> tuple[float, float, float, float]:
    """The table's box with its seats around it (seat centres plus a 22 cm chair)."""
    corners = _corners(table)
    xs = [x for x, _y in corners] + [seat.x for seat in table.seats]
    ys = [y for _x, y in corners] + [seat.y for seat in table.seats]
    return min(xs) - 22, min(ys) - 22, max(xs) + 22, max(ys) + 22


def _corners(table: PresetTable) -> list[tuple[float, float]]:
    cx, cy = table.x + table.w / 2, table.y + table.h / 2
    angle = math.radians(table.rotation)
    found = []
    for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        px, py = dx * table.w / 2, dy * table.h / 2
        found.append(
            (
                cx + px * math.cos(angle) - py * math.sin(angle),
                cy + px * math.sin(angle) + py * math.cos(angle),
            )
        )
    return found


def _overlap(a: tuple[float, ...], b: tuple[float, ...]) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def test_seven_presets_in_order_with_english_labels() -> None:
    assert PRESET_KEYS == (
        "banquet",
        "cabaret",
        "theatre",
        "classroom",
        "u_shape",
        "boardroom",
        "cocktail",
    )
    assert [PRESETS[key].label for key in PRESET_KEYS] == [
        "Banquet",
        "Cabaret",
        "Theatre",
        "Classroom",
        "U-shape",
        "Boardroom",
        "Cocktail",
    ]
    for key in PRESET_KEYS:
        description = PRESETS[key].description
        assert 20 <= len(description) <= 120 and description.endswith("."), key
        assert description.isascii(), key


@pytest.mark.parametrize("key", PRESET_KEYS)
@pytest.mark.parametrize(("width", "height"), ROOMS)
def test_every_setup_fits_the_room_without_overlaps(key: str, width: int, height: int) -> None:
    layout = build(key, width, height)
    assert layout.capacity == sum(len(t.seats) for t in layout.tables) > 0
    boxes = [_footprint(table) for table in layout.tables]
    for left, top, right, bottom in boxes:
        assert 0 <= left and right <= width and 0 <= top and bottom <= height, key
    for first, second in combinations(range(len(boxes)), 2):
        assert not _overlap(boxes[first], boxes[second]), (key, first, second)
    for zone in layout.zones:
        assert 0 <= zone.x and zone.x + zone.w <= width and 0 <= zone.y
        for box in boxes:
            assert not _overlap((zone.x, zone.y, zone.x + zone.w, zone.y + zone.h), box), key
    # The editor's own limits (routers/venues.py): labels and party sizes.
    for table in layout.tables:
        assert 1 <= len(table.label) <= 40 and 1 <= len(table.seats) <= 100
        assert table.shape in ("round", "rect", "row")
        assert all(1 <= len(seat.label) <= 40 for seat in table.seats)
        labels = [seat.label for seat in table.seats]
        assert len(labels) == len(set(labels)), table.label
    assert len({table.label for table in layout.tables}) == len(layout.tables)
    assert any(seat.accessible for table in layout.tables for seat in table.seats), key


def _seats_of(layout: PresetLayout) -> list[int]:
    return [len(table.seats) for table in layout.tables]


def test_each_setup_has_its_own_shape() -> None:
    banquet = build("banquet", 1300, 900)
    assert {t.shape for t in banquet.tables} == {"round"} and set(_seats_of(banquet)) == {10}
    assert [z.name for z in banquet.zones] == ["Dance floor"]

    cabaret = build("cabaret", 1300, 1100)
    assert {t.shape for t in cabaret.tables} == {"round"} and set(_seats_of(cabaret)) == {7}
    for table in cabaret.tables:
        centre_y = table.y + table.h / 2
        # Nobody sits with their back to the stage: no seat on the stage side.
        assert all(seat.y > centre_y - table.h / 4 for seat in table.seats)
    assert [z.name for z in cabaret.zones] == ["Stage"]

    theatre = build("theatre", 1300, 760)
    assert {t.shape for t in theatre.tables} == {"row"}
    rows: dict[float, list[PresetTable]] = {}
    for table in theatre.tables:
        rows.setdefault(table.y, []).append(table)
    assert all(len(sections) == 2 for sections in rows.values())  # one centre aisle
    for left, right in (sorted(s, key=lambda t: t.x) for s in rows.values()):
        assert right.x - (left.x + left.w) >= 100
    assert theatre.tables[0].label == "A Left" and theatre.tables[0].seats[0].label == "A1"

    classroom = build("classroom", 900, 800)
    for table in classroom.tables:
        assert table.shape == "rect"
        # Chairs on one side only, behind the table, facing the front.
        assert all(seat.y > table.y + table.h for seat in table.seats)

    u_shape = build("u_shape", 1300, 900)
    assert [t.label for t in u_shape.tables] == ["Left", "Head", "Right"]
    assert [t.rotation for t in u_shape.tables] == [90, 0, 90]

    boardroom = build("boardroom", 1300, 900)
    assert len(boardroom.tables) == 1 and boardroom.tables[0].shape == "rect"
    assert boardroom.zones == ()

    cocktail = build("cocktail", 1300, 900)
    assert set(_seats_of(cocktail)) == {4} and {t.shape for t in cocktail.tables} == {"round"}
    assert all(t.w <= 80 for t in cocktail.tables)
    assert [z.kind for z in cocktail.zones] == ["bar"]


def test_capacities_for_the_seeded_halls_and_quintas_are_pinned() -> None:
    sizes = {"hall_wide": (1300, 1100), "quinta": (1300, 900), "forum": (1300, 760)}
    sizes["warehouse"] = (900, 800)
    found = {
        name: {key: build(key, *size).capacity for key in PRESET_KEYS}
        for name, size in sizes.items()
    }
    assert found == {
        "hall_wide": {
            "banquet": 120,
            "cabaret": 84,
            "theatre": 180,
            "classroom": 90,
            "u_shape": 32,
            "boardroom": 30,
            "cocktail": 96,
        },
        "quinta": {
            "banquet": 80,
            "cabaret": 56,
            "theatre": 140,
            "classroom": 60,
            "u_shape": 26,
            "boardroom": 30,
            "cocktail": 72,
        },
        "forum": {
            "banquet": 40,
            "cabaret": 56,
            "theatre": 100,
            "classroom": 45,
            "u_shape": 22,
            "boardroom": 30,
            "cocktail": 72,
        },
        "warehouse": {
            "banquet": 40,
            "cabaret": 28,
            "theatre": 72,
            "classroom": 40,
            "u_shape": 23,
            "boardroom": 24,
            "cocktail": 48,
        },
    }


def test_a_tiny_room_gives_no_seats_and_a_huge_one_stays_within_the_limits() -> None:
    for key in PRESET_KEYS:
        tiny = build(key, 100, 100)
        assert tiny.capacity == 0 and tiny.tables == ()
        for side in (3000, 10000):  # rooms where MAX_SEATS cuts the rows
            huge = build(key, side, side)
            assert 0 < huge.capacity <= MAX_SEATS, key
            assert len(huge.tables) <= 1000
            assert any(seat.accessible for t in huge.tables for seat in t.seats), (key, side)


def test_the_same_room_always_gives_the_same_setup() -> None:
    for key in PRESET_KEYS:
        assert build(key, 1234, 987) == build(key, 1234, 987)


def test_matches_recognises_a_preset_by_its_geometry() -> None:
    layout = build("banquet", 1300, 900)
    tables = [(t.shape, t.x, t.y, t.w, t.h, t.rotation) for t in layout.tables]
    seats = [(s.x, s.y) for t in layout.tables for s in t.seats]
    assert matches(layout, tables, seats)
    assert not matches(build("cabaret", 1300, 900), tables, seats)
    moved = [(x + 10, y) for x, y in seats]
    assert not matches(layout, tables, moved)
    assert not matches(layout, tables[1:], seats)


def test_unknown_preset_is_refused() -> None:
    with pytest.raises(KeyError):
        build("dinner_party", 1300, 900)
