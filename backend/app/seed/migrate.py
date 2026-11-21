"""Bring the database up to date: python -m app.seed.migrate

Run it from the backend/ folder, once before the first deploy and again after
each release that changes the tables, with DATABASE_URL pointing at the
production database. The app itself never runs DDL on Postgres: several
serverless instances starting at the same moment would all try CREATE TABLE
and crash each other.

What it does, in one transaction (db.create_all):
1. creates every missing table;
2. adds each column in NEW_COLUMNS that the table does not have yet;
3. creates each index in NEW_INDEXES that does not exist yet.
The explicitly versioned review scale migration also converts existing review
scores. New columns get their defaults.

Every step checks the database first, so running it twice changes nothing
the second time, on SQLite and on Postgres alike.

The DDL below is fixed text written in this file, never built from input, so
contract section 7 ("no string-built SQL") still holds.
"""

import os

from sqlalchemy import Connection, inspect, text

from app import db
from app.config import _normalise_database_url, get_settings
from app.models import RestaurantReview

# (table, column, the column's type and rules as ALTER TABLE wants them).
# Each server default must match the one in models.py word for word, so a new
# database (create_all) and an upgraded one (ALTER TABLE) come out the same.
NEW_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("events", "share_enabled", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("events", "share_version", "INTEGER NOT NULL DEFAULT 0"),
    ("events", "share_token_hash", "VARCHAR(64)"),
    ("events", "share_cap", "INTEGER"),
    ("guests", "account_id", "INTEGER REFERENCES guest_accounts (id)"),
    ("guests", "source", "VARCHAR(20) NOT NULL DEFAULT 'invited'"),
    ("guests", "first_name", "VARCHAR(60)"),
    ("guests", "last_name", "VARCHAR(60)"),
    ("guests", "birth_date", "DATE"),
    ("guests", "share_age", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("email_outbox", "image_png", "TEXT"),
    ("venues", "slug", "VARCHAR(60)"),
    ("venues", "status", "VARCHAR(12) NOT NULL DEFAULT 'published'"),
    ("venues", "is_demo", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("venues", "description", "VARCHAR(300) NOT NULL DEFAULT ''"),
    ("venues", "cuisines", "JSON NOT NULL DEFAULT '[]'"),
    ("venues", "price_level", "INTEGER"),
    ("venues", "address", "VARCHAR(200) NOT NULL DEFAULT ''"),
    ("venues", "lat", "FLOAT"),
    ("venues", "lng", "FLOAT"),
    ("venues", "phone", "VARCHAR(40)"),
    ("venues", "website", "VARCHAR(200)"),
    ("venues", "instagram", "VARCHAR(30)"),
    ("venues", "google_maps_url", "VARCHAR(200)"),
    ("venues", "search_text", "VARCHAR(400) NOT NULL DEFAULT ''"),
    ("venues", "features", "JSON NOT NULL DEFAULT '{}'"),
    ("venues", "layout_version", "INTEGER NOT NULL DEFAULT 0"),
    ("venues", "published_at", "TIMESTAMP"),
    ("tables", "room_id", "INTEGER REFERENCES rooms (id)"),
    ("tables", "is_active", "BOOLEAN NOT NULL DEFAULT TRUE"),
    ("seats", "room_id", "INTEGER REFERENCES rooms (id)"),
    ("zones", "room_id", "INTEGER REFERENCES rooms (id)"),
    ("bookings", "chosen_seat_id", "INTEGER REFERENCES seats (id)"),
    ("bookings", "prefs", "JSON NOT NULL DEFAULT '[]'"),
    ("bookings", "account_id", "INTEGER REFERENCES guest_accounts (id) ON DELETE SET NULL"),
    ("bookings", "occasion", "VARCHAR(30)"),
    ("bookings", "dietary_requirements", "VARCHAR(500) NOT NULL DEFAULT ''"),
    ("bookings", "allergies", "VARCHAR(500) NOT NULL DEFAULT ''"),
    ("bookings", "arrival_at", "TIMESTAMP"),
    ("events", "event_type", "VARCHAR(20)"),
    ("events", "listed", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("venues", "venue_type", "VARCHAR(20)"),
    ("organisers", "session_version", "INTEGER NOT NULL DEFAULT 0"),
    ("venues", "parent_venue_id", "INTEGER REFERENCES venues (id)"),
    ("guests", "booked_by_guest_id", "INTEGER REFERENCES guests (id)"),
    ("guests", "age_years", "INTEGER"),
    ("events", "max_party_size", "INTEGER"),
)

# (index name, statement). Both databases understand "IF NOT EXISTS" here.
NEW_INDEXES: tuple[tuple[str, str], ...] = (
    (
        "uq_events_share_token",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_events_share_token ON events (share_token_hash)",
    ),
    (
        "uq_guests_event_account",
        (
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_guests_event_account "
            "ON guests (event_id, account_id)"
        ),
    ),
    (
        "ix_guests_account_id",
        "CREATE INDEX IF NOT EXISTS ix_guests_account_id ON guests (account_id)",
    ),
    (
        "ix_guests_booked_by_guest_id",
        "CREATE INDEX IF NOT EXISTS ix_guests_booked_by_guest_id ON guests (booked_by_guest_id)",
    ),
)


# Kept separate to preserve the historical guest-account index contract.
RESTAURANT_INDEXES: tuple[tuple[str, str], ...] = (
    (
        "ix_bookings_account_id",
        "CREATE INDEX IF NOT EXISTS ix_bookings_account_id ON bookings (account_id)",
    ),
    ("uq_venues_slug", "CREATE UNIQUE INDEX IF NOT EXISTS uq_venues_slug ON venues (slug)"),
)


def _add_missing_columns(connection: Connection) -> list[str]:
    """ALTER TABLE ... ADD COLUMN for each NEW_COLUMNS entry the table lacks."""
    changes = []
    for table, column, ddl in NEW_COLUMNS:
        # A fresh inspector each time: it caches what it has read.
        existing = {found["name"] for found in inspect(connection).get_columns(table)}
        if column in existing:
            continue
        # SQLite has no "ADD COLUMN IF NOT EXISTS", hence the check above on
        # both databases. On Postgres the clause is a second guard.
        if connection.dialect.name == "sqlite" and ddl == "TIMESTAMP":
            ddl = "DATETIME"
        guard = "IF NOT EXISTS " if connection.dialect.name == "postgresql" else ""
        connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {guard}{column} {ddl}"))
        changes.append(f"Added column {table}.{column}")
    return changes


def _upgrade_review_scale(connection: Connection) -> list[str]:
    constraints = inspect(connection).get_check_constraints("restaurant_reviews")
    if not any(check["name"] == "ck_restaurant_review_score" for check in constraints):
        return []
    if connection.dialect.name == "postgresql":
        connection.exec_driver_sql(
            "ALTER TABLE restaurant_reviews DROP CONSTRAINT ck_restaurant_review_score"
        )
        connection.exec_driver_sql("UPDATE restaurant_reviews SET score = score * 2")
        connection.exec_driver_sql(
            "ALTER TABLE restaurant_reviews ADD CONSTRAINT ck_restaurant_review_score_10 "
            "CHECK (score BETWEEN 0 AND 10)"
        )
    else:
        connection.exec_driver_sql(
            "ALTER TABLE restaurant_reviews RENAME TO restaurant_reviews_legacy"
        )
        connection.exec_driver_sql("DROP INDEX IF EXISTS ix_restaurant_reviews_account_id")
        RestaurantReview.__table__.create(connection)
        connection.exec_driver_sql(
            "INSERT INTO restaurant_reviews "
            "(venue_id, account_id, public_id, score, comment, table_type, verified, created_at) "
            "SELECT venue_id, account_id, public_id, score * 2, comment, table_type, verified, created_at "
            "FROM restaurant_reviews_legacy"
        )
        connection.exec_driver_sql("DROP TABLE restaurant_reviews_legacy")
    return ["Converted restaurant review scores to a 0–10 scale"]


def upgrade_schema(connection: Connection) -> list[str]:
    """Steps 2 and 3 of the module docstring. Returns one line per change.

    Run after Base.metadata.create_all(), because guests.account_id refers to
    the guest_accounts table that create_all makes.
    """
    changes = _add_missing_columns(connection)
    changes.extend(_upgrade_review_scale(connection))
    for name, statement in (*NEW_INDEXES, *RESTAURANT_INDEXES):
        connection.execute(text(statement))
        changes.append(f"Index {name} is ready")
    return changes


def main() -> None:
    settings = get_settings()
    raw_url = os.environ.get("DATABASE_URL_UNPOOLED", "").strip() or settings.database_url
    db.init_engine(_normalise_database_url(raw_url))
    for line in db.create_all():
        print(line)
    print("Tables are ready.")


def apply_schema_migration(*, only_when_empty: bool = False) -> list[str]:
    """Apply the schema using Neon/Vercel's direct URL without changing app state."""
    settings = get_settings()
    raw_url = os.environ.get("DATABASE_URL_UNPOOLED", "").strip() or settings.database_url
    engine = db.make_engine(_normalise_database_url(raw_url))
    try:
        return db.create_all(engine=engine, only_when_empty=only_when_empty)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
