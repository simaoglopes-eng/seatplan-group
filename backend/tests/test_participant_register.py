"""Independent participant signup uses the existing email verification safeguards."""

from app.config import get_settings
from app.events_service import accounts


def test_standalone_signup_creates_account_only_after_verification(client, monkeypatch):
    monkeypatch.setattr(accounts, "_new_code", lambda: "987654")
    body = {
        "name": "Ada Example",
        "email": "ada@example.com",
        "password": "a secure password",
        "consent": True,
    }
    pending = client.post("/api/guest/register", json=body)
    assert pending.status_code == 202
    assert "demo_code" not in pending.json()
    verify = {"email": body["email"], "signup_id": pending.json()["signup_id"], "code": "987654"}
    assert client.post("/api/guest/verify", json={**verify, "code": "000000"}).status_code == 422
    result = client.post("/api/guest/verify", json=verify)
    assert result.status_code == 201
    assert result.json()["account"]["name"] == body["name"]
    assert (
        client.get(
            "/api/guest/me", headers={"Authorization": f"Bearer {result.json()['token']}"}
        ).json()["events"]
        == []
    )
    assert client.post("/api/guest/verify", json=verify).status_code == 404


def test_production_signup_fails_closed_without_mail_configuration(client, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("EMAIL_PROVIDER", "console")
    get_settings.cache_clear()
    try:
        body = {
            "name": "Ada Example",
            "email": "ada@example.com",
            "password": "a secure password",
            "consent": True,
        }
        response = client.post("/api/guest/register", json=body)
        assert response.status_code == 503
        assert "signup_id" not in response.json()
        response = client.post(
            "/api/auth/register", json={k: body[k] for k in ("name", "email", "password")}
        )
        assert response.status_code == 503
    finally:
        get_settings.cache_clear()
