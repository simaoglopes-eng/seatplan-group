from conftest import auth_header, make_user
from test_discovery import venue


def test_owner_menu_prices_publication_and_stale_edits(client, session, organiser):
    restaurant = venue(session, organiser, "River", "river")
    other = make_user(session, "other@example.com")
    path = f"/api/owner/restaurants/{restaurant.public_id}/menu"
    headers = auth_header(organiser)
    assert client.get(path).status_code == 401
    assert client.get(path, headers=auth_header(other)).status_code == 404
    assert client.get(path, headers=headers).json() == {"version": 0, "items": []}
    item = {
        "name": "Soup",
        "category": "Starters",
        "description": "Seasonal vegetables",
        "price_cents": 450,
        "allergens": "Celery",
        "available": True,
    }
    payload = {"version": 0, "items": [item, {**item, "name": "Sold out", "available": False}]}
    assert client.put(path, headers=headers, json=payload).status_code == 200
    assert client.put(path, headers=headers, json=payload).status_code == 409
    menu = client.get("/api/restaurants/river/menu").json()
    assert menu["currency"] == "EUR"
    assert len(menu["items"]) == 1
    assert menu["items"][0]["price_cents"] == 450
    assert client.get(path, headers=headers).json()["version"] == 1
    for invalid in (-1, 4.5, True):
        assert (
            client.put(
                path,
                headers=headers,
                json={"version": 1, "items": [{**item, "price_cents": invalid}]},
            ).status_code
            == 422
        )
    restaurant.status = "draft"
    session.commit()
    assert client.get("/api/restaurants/river/menu").status_code == 404
    assert client.get(path, headers=headers).status_code == 200
