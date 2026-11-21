from datetime import timedelta

from guest_helpers import account_headers, make_account
from sqlalchemy.schema import CreateTable
from test_discovery import venue

from app import db
from app.models import Booking, RestaurantReview, utc_now


def test_reviews_are_owned_filtered_and_aggregated(client, session, organiser):
    venue(session, organiser, "Tagus Terrace", "tagus")
    venue(session, organiser, "Draft", "draft", status="draft")
    alice = make_account(session, "alice@example.com", "Alice Example")
    bob = make_account(session, "bob@example.com", "Bob Example")
    path = "/api/restaurants/tagus/reviews"
    payload = {"score": 0, "comment": "Too loud.", "table_type": "terrace"}

    assert client.get(path).json()["summary"] == {"average": None, "count": 0}
    assert client.put(f"{path}/mine", json=payload).status_code == 401
    assert client.get("/api/restaurants/draft/reviews").status_code == 404
    headers = account_headers(alice)
    for invalid in (11, -1, 4.3, True):
        assert (
            client.put(
                f"{path}/mine", headers=headers, json={**payload, "score": invalid}
            ).status_code
            == 422
        )
    assert client.put(f"{path}/mine", headers=headers, json=payload).status_code == 200
    assert client.get(f"{path}/mine", headers=headers).json()["review"]["score"] == 0
    assert (
        client.put(f"{path}/mine", headers=headers, json={**payload, "score": 8}).status_code == 200
    )

    second = {"score": 10, "comment": "Loved the view.", "table_type": "window"}
    assert client.put(f"{path}/mine", headers=account_headers(bob), json=second).status_code == 200
    result = client.get(path, params={"sort": "highest"}).json()
    assert result["summary"] == {"average": 9.0, "count": 2}
    assert [review["author"] for review in result["items"]] == ["Bob", "Alice"]
    assert "alice@example.com" not in str(result)
    filtered = client.get(path, params={"score": 8, "table_type": "terrace"}).json()
    assert filtered["total"] == 1 and filtered["items"][0]["comment"] == "Too loud."
    assert client.get("/api/restaurants").json()["items"][0]["reviews"] == result["summary"]
    assert client.get("/api/restaurants/tagus").json()["reviews"] == result["summary"]
    assert client.delete(f"{path}/mine", headers=headers).status_code == 200
    assert client.get(path).json()["summary"] == {"average": 10.0, "count": 1}


def test_only_a_completed_reservation_with_a_proven_email_verifies_a_review(
    client, session, organiser
):
    restaurant = venue(session, organiser, "Tagus Terrace", "tagus")
    alice = make_account(session, "alice@example.com")
    now = utc_now()
    booking = Booking(
        venue_id=restaurant.id,
        date=now.date(),
        start_at=now - timedelta(hours=3),
        end_at=now - timedelta(hours=1),
        email="ALICE@example.com",
        name="Alice",
        party_size=2,
        status="confirmed",
        manage_token_hash="test",
    )
    session.add(booking)
    session.commit()
    path = "/api/restaurants/tagus/reviews"
    headers = account_headers(alice)
    assert not client.put(f"{path}/mine", headers=headers, json={"score": 4}).json()["review"][
        "verified"
    ]
    booking.status = "completed"
    session.commit()
    assert client.put(f"{path}/mine", headers=headers, json={"score": 4}).json()["review"][
        "verified"
    ]
    assert client.get(path, params={"verified": True}).json()["total"] == 1
    alice.email_proven = False
    session.commit()
    assert not client.put(f"{path}/mine", headers=headers, json={"score": 4}).json()["review"][
        "verified"
    ]


def test_legacy_reviews_are_scaled_once(session, organiser):
    restaurant = venue(session, organiser, "Tagus Terrace", "tagus")
    account = make_account(session, "alice@example.com")
    review_table = RestaurantReview.__table__
    with db.get_engine().begin() as connection:
        review_table.drop(connection)
        ddl = str(CreateTable(review_table).compile(dialect=connection.dialect))
        connection.exec_driver_sql(
            ddl.replace("ck_restaurant_review_score_10", "ck_restaurant_review_score").replace(
                "BETWEEN 0 AND 10", "BETWEEN 0 AND 5"
            )
        )
        for index in review_table.indexes:
            index.create(connection)
        connection.execute(
            review_table.insert().values(
                venue_id=restaurant.id,
                account_id=account.id,
                public_id="old-review",
                score=4,
                comment="Original comment",
            )
        )
    assert any("Converted restaurant review" in line for line in db.create_all())
    assert not any("Converted restaurant review" in line for line in db.create_all())
    review = session.get(RestaurantReview, (restaurant.id, account.id))
    assert (review.public_id, review.score, review.comment) == ("old-review", 8, "Original comment")
