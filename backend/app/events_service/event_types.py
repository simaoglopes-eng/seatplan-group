"""The fixed lists behind an event's type and an event venue's type.

Keys are stored in the database (events.event_type, venues.venue_type); the
labels are what people read. Both lists are closed: the schemas refuse any
other key, so the public pages never meet a type they cannot name.
"""

from typing import Literal

# Insertion order is the order GET /api/event-types answers in.
EVENT_TYPES: dict[str, str] = {
    "wedding": "Wedding",
    "conference": "Conference",
    "birthday": "Birthday",
    "gala_dinner": "Gala dinner",
    "corporate_dinner": "Corporate dinner",
    "christening": "Christening",
}

EventType = Literal[
    "wedding", "conference", "birthday", "gala_dinner", "corporate_dinner", "christening"
]

VENUE_TYPES: dict[str, str] = {"hall": "Event hall", "quinta": "Quinta"}

VenueType = Literal["hall", "quinta"]


def event_type_label(key: str | None) -> str | None:
    """The English label of a stored key, or None when the event has no type."""
    return EVENT_TYPES.get(key) if key else None
