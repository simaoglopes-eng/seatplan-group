"""One-click room setups for an event: pure geometry, no database.

`build(key, width, height)` fills a room of that size (centimetres, the front
of the room at the top, y = 0) with tables and seats in one of seven classic
setups, and returns them with the capacity (one place per seat). The Layout
tab shows every preset as a small preview with its capacity for the event's
hall or quinta; applying one (events_service/layouts.py) writes the result
into the event's own copy of the room.

Spacing follows common event practice, scaled to the floor plans the editor
draws: a chair is 50 to 60 cm wide, a round table of ten is 150 cm across,
aisles are at least a metre wide. Every setup marks a few step-free places
(`accessible`) by an aisle at the back of the room. A room too small for even
one table gives no tables and capacity 0; a huge room stops at MAX_SEATS.
"""

import math
from collections.abc import Iterator
from dataclasses import dataclass

MAX_SEATS = 800
MARGIN = 60.0  # clear space along every wall
SIDE_AISLE = 80.0  # rows and classroom tables keep a wider gap to the side walls
CHAIR = 22.0  # half a chair: the space a seat takes around its centre
FRONT_Y, FRONT_H, FRONT_GAP = 30.0, 110.0, 30.0
FRONT_W = 600.0


@dataclass(frozen=True)
class Preset:
    key: str
    label: str
    description: str


PRESETS: dict[str, Preset] = {
    preset.key: preset
    for preset in (
        Preset("banquet", "Banquet", "Round tables of ten around a dance floor, for dinners."),
        Preset(
            "cabaret",
            "Cabaret",
            "Round tables with seats only on the side facing the stage.",
        ),
        Preset("theatre", "Theatre", "Rows of chairs facing the stage, with a centre aisle."),
        Preset(
            "classroom",
            "Classroom",
            "Long tables with chairs on one side, everyone facing the front.",
        ),
        Preset("u_shape", "U-shape", "Tables in a U open towards the screen, for discussions."),
        Preset("boardroom", "Boardroom", "One long table with seats on both sides and the ends."),
        Preset("cocktail", "Cocktail", "High round tables for four, standing, near the bar."),
    )
}
PRESET_KEYS = tuple(PRESETS)


@dataclass(frozen=True)
class PresetSeat:
    label: str
    x: float
    y: float
    accessible: bool = False


@dataclass(frozen=True)
class PresetTable:
    label: str
    shape: str  # "round", "rect" or "row", as in the editor
    # x, y: top-left of the unrotated box; rotation in degrees around its centre.
    x: float
    y: float
    w: float
    h: float
    rotation: float
    seats: tuple[PresetSeat, ...]


@dataclass(frozen=True)
class PresetZone:
    name: str
    kind: str  # an editor zone kind: "stage" or "bar"
    x: float
    y: float
    w: float
    h: float


@dataclass(frozen=True)
class PresetLayout:
    key: str
    width: float
    height: float
    zones: tuple[PresetZone, ...]
    tables: tuple[PresetTable, ...]

    @property
    def capacity(self) -> int:
        return sum(len(table.seats) for table in self.tables)


def _r(value: float) -> float:
    return round(value, 1)


def _seat(label: str, x: float, y: float, accessible: bool = False) -> PresetSeat:
    return PresetSeat(label, _r(x), _r(y), accessible)


def _table(
    label: str,
    shape: str,
    box: tuple[float, float, float, float],
    rotation: float,
    seats: list[PresetSeat],
) -> PresetTable:
    x, y, w, h = box
    return PresetTable(label, shape, _r(x), _r(y), _r(w), _r(h), rotation, tuple(seats))


@dataclass(frozen=True)
class _Area:
    left: float
    top: float
    right: float
    bottom: float

    @property
    def width(self) -> float:
        return self.right - self.left

    @property
    def height(self) -> float:
        return self.bottom - self.top


def _area(width: float, height: float, with_front: bool, side: float = MARGIN) -> _Area:
    top = FRONT_Y + FRONT_H + FRONT_GAP if with_front else MARGIN
    return _Area(side, top, width - side, height - MARGIN)


def _front(name: str, kind: str, width: float) -> PresetZone:
    w = min(FRONT_W, width - 2 * MARGIN)
    return PresetZone(name, kind, _r((width - w) / 2), FRONT_Y, _r(w), FRONT_H)


def _count(space: float, size: float, pitch: float) -> int:
    """How many items of `size` fit in `space`, one every `pitch`."""
    return 0 if space < size else int((space - size) // pitch) + 1


def _grid(
    area: _Area, half_w: float, ext: tuple[float, float], pitch: tuple[float, float]
) -> Iterator[tuple[int, int, float, float, bool]]:
    """Centres of a grid of tables, front row first, each row centred.

    `half_w` is half a table's footprint across, `ext` its footprint above and
    below the centre, `pitch` the distance between centres (across, down).
    Yields (row, column, x, y, last row).
    """
    above, below = ext
    columns = _count(area.width, 2 * half_w, pitch[0])
    rows = _count(area.height, above + below, pitch[1])
    if not columns:
        return
    span = (columns - 1) * pitch[0]
    first_x = area.left + (area.width - span) / 2
    for row in range(rows):
        y = area.top + above + row * pitch[1]
        for column in range(columns):
            yield row, column, first_x + column * pitch[0], y, row == rows - 1


def _round_seats(
    cx: float, cy: float, radius: float, angles: list[float], accessible: set[int]
) -> list[PresetSeat]:
    return [
        _seat(
            str(index + 1),
            cx + radius * math.cos(math.radians(angle)),
            cy + radius * math.sin(math.radians(angle)),
            index in accessible,
        )
        for index, angle in enumerate(angles)
    ]


def _rounds(
    area: _Area,
    table_r: float,
    seat_r: float,
    angles: list[float],
    ext: tuple[float, float, float],
    pitch: tuple[float, float],
    accessible: set[int],
) -> list[PresetTable]:
    """Round tables on a grid. Step-free places at the back row's two end tables."""
    half_w, above, below = ext
    # Cut at MAX_SEATS first, so the step-free places go on the back row kept.
    cells = list(_grid(area, half_w, (above, below), pitch))[: MAX_SEATS // len(angles)]
    back = [cell for cell in cells if cell[0] == cells[-1][0]] if cells else []
    ends = {(back[0][0], back[0][1]), (back[-1][0], back[-1][1])} if back else set()
    tables: list[PresetTable] = []
    for row, column, cx, cy, _last in cells:
        steps = accessible if (row, column) in ends else set()
        seats = _round_seats(cx, cy, seat_r, angles, steps)
        box = (cx - table_r, cy - table_r, 2 * table_r, 2 * table_r)
        tables.append(_table(f"T{len(tables) + 1}", "round", box, 0, seats))
    return tables


def _banquet(width: float, height: float) -> tuple[list[PresetZone], list[PresetTable]]:
    angles = [-90 + index * 36 for index in range(10)]
    # Seat 6 sits at the bottom, facing the front; 6 and 7 are by the back aisle.
    area = _area(width, height, True)
    tables = _rounds(area, 75, 105, angles, (127, 127, 127), (300, 300), {5, 6})
    return [_front("Dance floor", "stage", width)], tables


def _cabaret(width: float, height: float) -> tuple[list[PresetZone], list[PresetTable]]:
    # Seven seats on the far side of the table: from just above the left of
    # the centre, round the back, to just above the right. Nobody faces away.
    angles = [186 - index * 32 for index in range(7)]
    area = _area(width, height, True)
    tables = _rounds(area, 75, 105, angles, (127, 97, 127), (300, 260), {2, 3})
    return [_front("Stage", "stage", width)], tables


def _cocktail(width: float, height: float) -> tuple[list[PresetZone], list[PresetTable]]:
    angles = [45, 135, 225, 315]
    area = _area(width, height, True)
    tables = _rounds(area, 35, 60, angles, (65, 65, 65), (200, 200), {0, 1})
    return [_front("Bar", "bar", width)], tables


def _row_name(index: int) -> str:
    """A, B, ... Z, AA, AB, ... like theatre rows."""
    name = ""
    index += 1
    while index:
        index, rest = divmod(index - 1, 26)
        name = chr(ord("A") + rest) + name
    return name


def _section_names(count: int) -> list[str]:
    if count == 1:
        return [""]
    if count == 2:
        return ["Left", "Right"]
    if count == 3:
        return ["Left", "Centre", "Right"]
    return [f"Block {index + 1}" for index in range(count)]


def _sections(space: float, chair: float, most: int, aisle: float) -> tuple[int, int]:
    """(sections, chairs per section) across `space`, aisles between sections."""
    count = max(1, math.ceil((space + aisle) / (most * chair + aisle)))
    while count > 1 and (space - (count - 1) * aisle) / (count * chair) < 4:
        count -= 1
    per = min(most, int((space - (count - 1) * aisle) // (count * chair)))
    return (count, per) if per >= 1 else (0, 0)


def _lines(
    area: _Area,
    chair: float,
    most: int,
    aisle: float,
    depth: tuple[float, float],
    pitch: float,
) -> Iterator[tuple[int, list[float], int, float]]:
    """Rows across the room: (row, left edge of each section, chairs each, top)."""
    count, per = _sections(area.width, chair, most, aisle)
    if not count:
        return
    span = count * per * chair + (count - 1) * aisle
    first = area.left + (area.width - span) / 2
    lefts = [first + index * (per * chair + aisle) for index in range(count)]
    above, below = depth
    for row in range(_count(area.height, above + below, pitch)):
        yield row, lefts, per, area.top + above + row * pitch


def _kept(
    lines: list[tuple[int, list[float], int, float]],
) -> list[tuple[int, list[float], int, float]]:
    """The rows that stay within MAX_SEATS (every row has the same seats)."""
    if not lines:
        return lines
    _row, lefts, per, _y = lines[0]
    return lines[: MAX_SEATS // (per * len(lefts))]


def _theatre(width: float, height: float) -> tuple[list[PresetZone], list[PresetTable]]:
    """Rows of chairs (one "row" table per section), a centre aisle between sections."""
    area = _area(width, height, True, SIDE_AISLE)
    lines = _kept(list(_lines(area, 50, 12, 120, (42, 42), 95)))
    tables: list[PresetTable] = []
    for row, lefts, per, line in lines:
        name = _row_name(row)
        back = row == len(lines) - 1
        for index, (left, section) in enumerate(
            zip(lefts, _section_names(len(lefts)), strict=True)
        ):
            seats = [
                _seat(
                    f"{name}{index * per + n + 1}",
                    left + 25 + n * 50,
                    line,
                    back and n in (0, per - 1),
                )
                for n in range(per)
            ]
            label = f"{name} {section}".strip()
            tables.append(_table(label, "row", (left, line - 20, per * 50, 40), 0, seats))
    return [_front("Stage", "stage", width)], tables


def _classroom(width: float, height: float) -> tuple[list[PresetZone], list[PresetTable]]:
    """Long tables, chairs behind them facing the front, an aisle between sections."""
    area = _area(width, height, True, SIDE_AISLE)
    lines = _kept(list(_lines(area, 60, 8, 100, (22, 95), 140)))
    tables: list[PresetTable] = []
    for row, lefts, per, top in lines:
        back = row == len(lines) - 1
        for index, (left, section) in enumerate(
            zip(lefts, _section_names(len(lefts)), strict=True)
        ):
            seats = []
            for n in range(per):
                outer = (index == 0 and n == 0) or (index == len(lefts) - 1 and n == per - 1)
                label = f"R{row + 1}-{index * per + n + 1}"
                seats.append(_seat(label, left + 30 + n * 60, top + 45 + 28, back and outer))
            name = f"Row {row + 1} {section.lower()}".strip()
            tables.append(_table(name, "rect", (left, top, per * 60, 45), 0, seats))
    return [_front("Stage", "stage", width)], tables


def _floor60(value: float) -> float:
    return math.floor(value / 60) * 60


def _u_shape(width: float, height: float) -> tuple[list[PresetZone], list[PresetTable]]:
    """Three tables in a U, open towards the screen, chairs on the outside.

    The arms are tables turned 90 degrees, so "along the table" is down the
    room and the neighbour rule (core/neighbours.py) reads them correctly.
    """
    area = _area(width, height, True)
    head = min(_floor60(area.width - 100), 720)  # head table length, across
    top = area.top + CHAIR
    arm = min(_floor60(area.bottom - 110 - 60 - top), 600)
    if head < 180 or arm < 60:
        return [], []
    x0 = (width - head) / 2
    base = top + arm + 60  # a gap at each corner to walk through
    arms = []
    for label, x, chair_x in (("Left", x0, x0 - 28), ("Right", x0 + head - 60, x0 + head + 28)):
        seats = [
            _seat(str(n + 1), chair_x, top + 30 + n * 60, n == 0) for n in range(int(arm // 60))
        ]
        centre_x, centre_y = x + 30, top + arm / 2
        box = (centre_x - arm / 2, centre_y - 30, arm, 60)
        arms.append(_table(label, "rect", box, 90, seats))
    head_seats = [_seat(str(n + 1), x0 + 30 + n * 60, base + 88) for n in range(int(head // 60))]
    head_table = _table("Head", "rect", (x0, base, head, 60), 0, head_seats)
    return [_front("Screen", "stage", width)], [arms[0], head_table, arms[1]]


def _boardroom(width: float, height: float) -> tuple[list[PresetZone], list[PresetTable]]:
    """One long table in the middle of the room, a seat at each end."""
    area = _area(width, height, False)
    length = min(_floor60(area.width - 100), 840)
    if length < 120 or area.height < 220:
        return [], []
    cx, cy = width / 2, area.top + area.height / 2
    left = cx - length / 2
    per_side = int(length // 60)
    seats = [_seat("1", left - 28, cy, True)]
    seats += [_seat(str(n + 2), left + 30 + n * 60, cy - 88) for n in range(per_side)]
    seats.append(_seat(str(per_side + 2), left + length + 28, cy, True))
    seats += [
        _seat(str(per_side + 3 + n), left + length - 30 - n * 60, cy + 88) for n in range(per_side)
    ]
    table = _table("Boardroom", "rect", (left, cy - 60, length, 120), 0, seats)
    return [], [table]


_BUILDERS = {
    "banquet": _banquet,
    "cabaret": _cabaret,
    "theatre": _theatre,
    "classroom": _classroom,
    "u_shape": _u_shape,
    "boardroom": _boardroom,
    "cocktail": _cocktail,
}


def build(key: str, width: float, height: float) -> PresetLayout:
    """The setup `key` for a room of width x height cm. KeyError for an unknown key."""
    zones, tables = _BUILDERS[key](width, height)
    if not tables:
        zones = []
    return PresetLayout(key, width, height, tuple(zones), tuple(tables))


TableGeometry = tuple[str, float, float, float, float, float]


def _rounded(rows: list[tuple]) -> list[tuple]:
    return sorted(tuple(round(v, 1) if isinstance(v, float | int) else v for v in r) for r in rows)


def matches(
    layout: PresetLayout, tables: list[TableGeometry], seats: list[tuple[float, float]]
) -> bool:
    """True when these tables and seats are exactly the preset's geometry.

    Used to tell "still the Banquet setup" from "changed in the editor". Flags
    such as blocked or step-free seats do not count, only where things are.
    """
    mine_tables = [(t.shape, t.x, t.y, t.w, t.h, t.rotation) for t in layout.tables]
    mine_seats = [(s.x, s.y) for t in layout.tables for s in t.seats]
    return _rounded(mine_tables) == _rounded(list(tables)) and _rounded(mine_seats) == _rounded(
        list(seats)
    )
