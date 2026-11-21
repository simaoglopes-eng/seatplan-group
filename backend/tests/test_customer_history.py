from datetime import timedelta

from conftest import auth_header, make_user
from test_discovery import venue

from app.models import Booking, utc_now


def test_customer_history_is_scoped_to_restaurant_and_completed_visits(client, session, organiser):
    restaurant = venue(session, organiser, "River", "river")
    other_owner = make_user(session, "other-owner@example.com")
    other = venue(session, other_owner, "Other", "other")
    now = utc_now()

    def reserve(venue_id, status, email="diner@example.com", notes="", days=-1):
        row = Booking(
            venue_id=venue_id,
            date=(now + timedelta(days=days)).date(),
            start_at=now + timedelta(days=days),
            end_at=now + timedelta(days=days, hours=2),
            party_size=2,
            name="Diner",
            email=email,
            notes=notes,
            status=status,
            manage_token_hash="private-hash",
        )
        session.add(row)
        session.flush()
        return row

    current = reserve(restaurant.id, "confirmed", days=7)
    reserve(restaurant.id, "completed", email=" DINER@example.com ", notes="Window next time")
    reserve(restaurant.id, "completed", days=-10)
    reserve(restaurant.id, "cancelled")
    reserve(restaurant.id, "no_show")
    reserve(restaurant.id, "completed", email="someone-else@example.com")
    reserve(other.id, "completed", notes="Private to the other restaurant")
    session.commit()
    path = f"/api/staff/{restaurant.public_id}/bookings/{current.public_id}/customer"
    assert client.get(path).status_code == 401
    assert client.get(path, headers=auth_header(other_owner)).status_code == 404
    result = client.get(path, headers=auth_header(organiser))
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["completed_visits"] == 2
    assert body["returning_customer"] is True
    assert body["visits"][0]["notes"] == "Window next time"
    assert len(body["visits"]) == 2
    assert "Private to the other" not in result.text
    assert "private-hash" not in result.text
    assert "someone-else@example.com" not in result.text
