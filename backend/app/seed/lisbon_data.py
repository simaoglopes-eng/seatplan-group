"""Read the Lisbon demo catalogue and identify its original, credited covers."""

import json
from functools import cache
from hashlib import sha256
from pathlib import Path
from typing import TypedDict

DEMO_ID_PREFIX = "lisbon-demo-"
COVER_ID_PREFIX = "lisbon-cover-"


class Cover(TypedDict):
    file: str
    url: str
    author: str
    license: str
    license_url: str
    alt: str


class Listing(TypedDict):
    slug: str
    name: str
    address: str
    location: list[float]
    source: str
    cuisines: list[str]
    description: str
    pin_source: str
    price_level: int
    price_source: str
    photo: Cover


@cache
def catalogue() -> list[Listing]:
    return json.loads(Path(__file__).with_name("lisbon_catalogue.json").read_text(encoding="utf-8"))


def _listing_key(slug: str) -> str:
    return sha256(slug.encode()).hexdigest()[:16]


def venue_id(slug: str) -> str:
    return DEMO_ID_PREFIX + _listing_key(slug)


def cover_id(slug: str) -> str:
    return COVER_ID_PREFIX + _listing_key(slug)


@cache
def _covers_by_id() -> dict[str, Cover]:
    return {cover_id(listing["slug"]): listing["photo"] for listing in catalogue()}


def cover_credit(public_id: str) -> dict[str, str] | None:
    if not public_id.startswith(COVER_ID_PREFIX):
        return None
    cover = _covers_by_id().get(public_id)
    if cover is None:
        return None
    return {key: cover[key] for key in ("file", "author", "license", "license_url")}
