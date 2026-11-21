"""Usage limits on self-serve accounts and party bookings, in one place.

Each number here stops one person from using up something everyone shares:
the seats of an event, the database, the photo storage. Tests lower them
with monkeypatch, so every check reads them through this module
(limits.NAME), never through a copy made at import time.

The seeded demo data does not go through these checks: the seed writes
its rows directly, and every count below leaves out demo venues.
"""

# ---------------------------------------------------------------- party booking
# How many seats one guest may book, their own included (events.max_party_size):
# NULL in the database means this default, 0 means no limit.
DEFAULT_MAX_PARTY_SIZE = 8
MAX_PARTY_SIZE_SETTING = 500
# Companion rows one booker may create over the event's life, erased ones
# included (each removal leaves an emptied row): this many times their party
# limit, or PARTY_CHANGES_NO_LIMIT when the event has no limit.
PARTY_CHANGES_FACTOR = 3
PARTY_CHANGES_NO_LIMIT = 24

# ---------------------------------------------------------------- work accounts
# Restaurants one work account may own (kind "restaurant").
MAX_RESTAURANTS_PER_ACCOUNT = 3
# Event venues one work account may create: POST /venues and
# POST /events/create-with-venue (which makes one venue per event). An
# event's own room setup copy (parent_venue_id set) is not counted.
MAX_EVENT_VENUES_PER_ACCOUNT = 3
# Events one work account may create, by either route: POST /events (on a
# venue it already has) and POST /events/create-with-venue. Without it, one
# venue could hold any number of events, each with its own room setup copy.
# Demo events (on an is_demo venue) are not counted.
MAX_EVENTS_PER_ACCOUNT = 10
# Photo bytes stored for all the venues of one work account together.
PHOTO_BYTES_PER_ACCOUNT = 50 * 1024 * 1024
# Creations per account per hour (security.rate_limit).
RESTAURANT_CREATES_PER_HOUR = 10
VENUE_CREATES_PER_HOUR = 20
EVENT_CREATES_PER_HOUR = 30
