"""Load the real-venue directory (models.VenueListing) from its dated snapshot.

The snapshot (seed/data/venue_directory_osm_<date>.json) was fetched once from
OpenStreetMap through the Overpass API: every named amenity=events_venue and
amenity=conference_centre in Portugal, Belgium and Italy, minus disused
entries, open-air fairgrounds and node/way duplicates. Phones and emails were
left out on purpose. This module never calls the network.

Upsert by (source, source_ref): rerunning it changes nothing, and rows from
another source are never touched.

    python -m app.seed.venue_directory
"""

import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import db
from app.config import get_settings
from app.models import VenueListing

SNAPSHOT = Path(__file__).parent / "data" / "venue_directory_osm_2026-11-20.json"
FIELDS = (
    "name",
    "kind",
    "country",
    "city",
    "city_inferred",
    "street",
    "postcode",
    "lat",
    "lng",
    "website",
)


def load(session: Session, path: Path = SNAPSHOT) -> dict[str, int]:
    data = json.loads(path.read_text(encoding="utf-8"))
    snapshot = data["fetched"]
    existing = {
        row.source_ref: row
        for row in session.scalars(select(VenueListing).where(VenueListing.source == "osm"))
    }
    added = updated = 0
    for item in data["items"]:
        row = existing.get(item["ref"])
        if row is None:
            row = VenueListing(source="osm", source_ref=item["ref"])
            session.add(row)
            added += 1
        else:
            updated += 1
        for field in FIELDS:
            setattr(row, field, item[field])
        row.snapshot = snapshot
    session.flush()
    return {"added": added, "updated": updated, "total": len(data["items"])}


def main() -> None:
    db.init_engine(get_settings().database_url)
    db.create_all()
    with db.new_session() as session:
        counts = load(session)
        session.commit()
    print(
        f"Venue directory: {counts['added']} added, {counts['updated']} updated, {counts['total']} in the snapshot."
    )


if __name__ == "__main__":
    main()
