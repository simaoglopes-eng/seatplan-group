from datetime import timedelta

from guest_helpers import account_headers, make_account
from test_discovery import venue

from app.models import Booking, utc_now


def booking(session, restaurant, email):
    now = utc_now()
    row = Booking(
        venue_id=restaurant.id,
        date=now.date(),
        start_at=now + timedelta(hours=2),
        end_at=now + timedelta(hours=4),
        party_size=2,
        name="Diner",
        email=email,
        manage_token_hash="private-token-hash",
    )
    session.add(row)
    session.commit()
    return row


def test_history_only_claims_verified_email_and_never_leaks_tokens(client, session, organiser):
    restaurant = venue(session, organiser, "River", "river")
    alice = make_account(session, "alice@example.com")
    bob = make_account(session, "bob@example.com")
    mine = booking(session, restaurant, " ALICE@example.com ")
    booking(session, restaurant, bob.email)
    path = "/api/diner/bookings"
    assert client.get(path).status_code == 401
    alice.email_proven = False
    session.commit()
    headers = account_headers(alice)
    assert client.get(path, headers=headers).json()["items"] == []
    alice.email_proven = True
    session.commit()
    response = client.get(path, headers=headers)
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [mine.public_id]
    assert "private-token-hash" not in response.text
    assert "bob@example.com" not in response.text
    session.refresh(mine)
    assert mine.account_id == alice.id
    assert client.get(path, headers=headers).json()["total"] == 1
    assert client.get(path, headers=account_headers(bob)).json()["total"] == 1


def test_favorites_are_private_idempotent_and_published_only(client, session, organiser):
    venue(session, organiser, "River", "river")
    draft = venue(session, organiser, "Draft", "draft", status="draft")
    alice = make_account(session, "alice@example.com")
    bob = make_account(session, "bob@example.com")
    headers = account_headers(alice)
    path = "/api/diner/favorites"
    assert client.put(f"{path}/river").status_code == 401
    for _ in range(2):
        assert client.put(f"{path}/river", headers=headers).status_code == 200
    assert client.get(path, headers=headers).json()["items"][0]["slug"] == "river"
    assert client.get(path, headers=account_headers(bob)).json()["items"] == []
    assert client.put(f"{path}/draft", headers=headers).status_code == 404
    draft.status = "published"
    session.commit()
    assert client.put(f"{path}/draft", headers=headers).status_code == 200
    draft.status = "draft"
    session.commit()
    assert len(client.get(path, headers=headers).json()["items"]) == 1
    for _ in range(2):
        assert client.delete(f"{path}/river", headers=headers).status_code == 200


def test_account_cancel_enforces_ownership_and_uses_existing_lifecycle(client, session, organiser):
    restaurant = venue(session, organiser, "River", "river")
    alice = make_account(session, "alice@example.com")
    bob = make_account(session, "bob@example.com")
    mine = booking(session, restaurant, alice.email)
    path = f"/api/diner/bookings/{mine.public_id}"
    assert client.delete(path, headers=account_headers(bob)).status_code == 404
    response = client.delete(path, headers=account_headers(alice))
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "cancelled"
    assert client.delete(path, headers=account_headers(alice)).status_code == 409
