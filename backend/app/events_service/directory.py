"""The public directory of real venues (models.VenueListing, from OpenStreetMap).

Only what the source states is shown: name, kind, place, street and website.
No capacity, photos, descriptions or events are invented for a real business.
"""

from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import VenueListing

COUNTRIES: dict[str, str] = {"PT": "Portugal", "BE": "Belgium", "IT": "Italy"}
KINDS: dict[str, str] = {
    "estate": "Quinta or estate",
    "hall": "Event hall",
    "conference": "Conference centre",
}
ATTRIBUTION = "© OpenStreetMap contributors"


def public_ref(row: VenueListing) -> str:
    """ "node/123" -> "n123": short, URL-safe and stable across reloads."""
    kind, _, number = row.source_ref.partition("/")
    return f"{kind[:1]}{number}"


def _item(row: VenueListing) -> dict[str, Any]:
    kind, number = row.source_ref.split("/")
    return {
        "id": public_ref(row),
        "name": row.name,
        "kind": row.kind,
        "kind_label": KINDS.get(row.kind, row.kind),
        "country": row.country,
        "country_label": COUNTRIES.get(row.country, row.country),
        "city": row.city,
        "city_inferred": row.city_inferred,
        "street": row.street,
        "postcode": row.postcode,
        "lat": row.lat,
        "lng": row.lng,
        "website": row.website,
        "source_url": f"https://www.openstreetmap.org/{kind}/{number}",
    }


def _like(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped.lower()}%"


def listings(
    session: Session, country: str | None, kind: str | None, q: str | None, limit: int, offset: int
) -> dict[str, Any]:
    query = select(VenueListing)
    if country is not None:
        query = query.where(VenueListing.country == country)
    if kind is not None:
        query = query.where(VenueListing.kind == kind)
    if q:
        pattern = _like(q.strip())
        query = query.where(
            or_(
                func.lower(VenueListing.name).like(pattern, escape="\\"),
                func.lower(VenueListing.city).like(pattern, escape="\\"),
            )
        )
    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = session.scalars(
        # Venues with a website and a street first: they are the ones a planner can act on.
        query.order_by(
            VenueListing.website.is_(None),
            VenueListing.street.is_(None),
            VenueListing.name,
            VenueListing.id,
        )
        .limit(limit)
        .offset(offset)
    )
    return {"items": [_item(row) for row in rows], "total": int(total), "attribution": ATTRIBUTION}


def counts(session: Session) -> dict[str, Any]:
    """Rows per country and kind, for the tiles: one grouped query."""
    rows = session.execute(
        select(VenueListing.country, VenueListing.kind, func.count()).group_by(
            VenueListing.country, VenueListing.kind
        )
    ).all()
    return {
        "items": [{"country": c, "kind": k, "count": int(n)} for c, k, n in rows],
        "countries": [{"key": k, "label": v} for k, v in COUNTRIES.items()],
        "kinds": [{"key": k, "label": v} for k, v in KINDS.items()],
        "attribution": ATTRIBUTION,
    }


def listing(session: Session, ref: str) -> dict[str, Any]:
    kinds = {"n": "node", "w": "way", "r": "relation"}
    if len(ref) < 2 or ref[0] not in kinds or not ref[1:].isdigit():
        raise ApiError(404, "not_found", "Venue not found.")
    row = session.scalars(
        select(VenueListing).where(VenueListing.source_ref == f"{kinds[ref[0]]}/{ref[1:]}")
    ).first()
    if row is None:
        raise ApiError(404, "not_found", "Venue not found.")
    return {**_item(row), "attribution": ATTRIBUTION}
