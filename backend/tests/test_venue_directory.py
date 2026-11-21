"""The real-venue directory: loaded from the OSM snapshot, filtered and paged by the server.

Only what the source states is served; no phone or email ever leaves the API,
and loading twice changes nothing.
"""

import json

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import VenueListing
from app.seed import venue_directory


def _snapshot() -> dict:
    return json.loads(venue_directory.SNAPSHOT.read_text(encoding="utf-8"))


def test_the_snapshot_has_three_countries_three_kinds_and_no_contact_data() -> None:
    data = _snapshot()
    assert "OpenStreetMap" in data["license"]
    items = data["items"]
    assert {i["country"] for i in items} == {"PT", "BE", "IT"}
    assert {i["kind"] for i in items} == {"estate", "hall", "conference"}
    assert len({i["ref"] for i in items}) == len(items)
    assert all(
        set(i)
        == {
            "ref",
            "name",
            "kind",
            "country",
            "street",
            "postcode",
            "city",
            "city_inferred",
            "lat",
            "lng",
            "website",
            "wikidata",
        }
        for i in items
    )


def test_loading_twice_adds_nothing_and_leaves_other_sources_alone(session: Session) -> None:
    session.add(
        VenueListing(
            source="manual",
            source_ref="x/1",
            name="Kept",
            kind="hall",
            country="PT",
            lat=0,
            lng=0,
            snapshot="-",
        )
    )
    session.flush()
    first = venue_directory.load(session)
    second = venue_directory.load(session)
    session.commit()
    total = len(_snapshot()["items"])
    assert first == {"added": total, "updated": 0, "total": total}
    assert second == {"added": 0, "updated": total, "total": total}
    assert session.scalar(select(func.count()).select_from(VenueListing)) == total + 1
    assert (
        session.scalars(select(VenueListing).where(VenueListing.source == "manual")).one().name
        == "Kept"
    )


def test_filters_page_and_count_on_the_server(client: TestClient, session: Session) -> None:
    venue_directory.load(session)
    session.commit()
    items = _snapshot()["items"]
    want = [i for i in items if i["country"] == "PT" and i["kind"] == "estate"]
    page = client.get(
        "/api/venue-directory", params={"country": "PT", "kind": "estate", "limit": 5}
    ).json()
    assert page["total"] == len(want)
    assert len(page["items"]) == 5
    assert all(i["country"] == "PT" and i["kind"] == "estate" for i in page["items"])
    assert page["attribution"] == "© OpenStreetMap contributors"
    assert "phone" not in page["items"][0] and "email" not in page["items"][0]
    nxt = client.get(
        "/api/venue-directory", params={"country": "PT", "kind": "estate", "limit": 5, "offset": 5}
    ).json()
    assert not {i["id"] for i in page["items"]} & {i["id"] for i in nxt["items"]}

    counts = client.get("/api/venue-directory/counts").json()
    by = {(c["country"], c["kind"]): c["count"] for c in counts["items"]}
    assert by[("PT", "estate")] == len(want)
    assert sum(by.values()) == len(items)

    found = client.get("/api/venue-directory", params={"q": want[0]["name"][:12]}).json()
    assert any(i["name"] == want[0]["name"] for i in found["items"])
    one = client.get(f"/api/venue-directory/{page['items'][0]['id']}").json()
    assert one["source_url"].startswith("https://www.openstreetmap.org/")


def test_unknown_filters_and_refs_are_refused(client: TestClient) -> None:
    assert client.get("/api/venue-directory", params={"country": "FR"}).status_code == 422
    assert client.get("/api/venue-directory", params={"kind": "castle"}).status_code == 422
    assert client.get("/api/venue-directory", params={"limit": 500}).status_code == 422
    assert client.get("/api/venue-directory/zz9").status_code == 404
    assert client.get("/api/venue-directory/n999999999999").status_code == 404
    # A % in the search is a literal character, not a wildcard.
    assert client.get("/api/venue-directory", params={"q": "%"}).json()["total"] == 0
