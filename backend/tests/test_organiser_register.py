"""Organiser registration must prove the mailbox before granting a session."""

import pytest
from sqlalchemy import select

from app.events_service import accounts
from app.models import Organiser


def test_register_requires_verification_and_allows_login(client, session, monkeypatch):
    monkeypatch.setattr(accounts, "_new_code", lambda: "123456")
    details = {"name": "A Person", "email": "a@example.com", "password": "a secure password"}
    response = client.post("/api/auth/register", json=details)
    assert response.status_code == 202
    pending = response.json()
    assert "demo_code" not in pending
    assert (
        session.scalars(select(Organiser).where(Organiser.email == details["email"])).first()
        is None
    )
    verify = {"email": details["email"], "signup_id": pending["signup_id"], "code": "000000"}
    assert client.post("/api/auth/verify", json=verify).status_code == 422
    verify["code"] = "123456"
    assert (
        client.post(
            "/api/auth/verify", json={**verify, "signup_id": "wrong-identifier-123456789"}
        ).status_code
        == 404
    )
    done = client.post("/api/auth/verify", json=verify)
    assert done.status_code == 201
    assert done.json()["user"]["role"] == "organiser"
    assert client.post("/api/auth/verify", json=verify).status_code == 404
    assert (
        client.post(
            "/api/auth/login", json={"email": details["email"], "password": details["password"]}
        ).status_code
        == 200
    )


@pytest.mark.usefixtures("no_resend_wait")
def test_existing_email_does_not_expose_a_code_or_create_a_second_account(client, monkeypatch):
    monkeypatch.setattr(accounts, "_new_code", lambda: "123456")
    details = {"name": "A Person", "email": "a@example.com", "password": "a secure password"}
    first = client.post("/api/auth/register", json=details).json()
    assert (
        client.post(
            "/api/auth/verify",
            json={"email": details["email"], "signup_id": first["signup_id"], "code": "123456"},
        ).status_code
        == 201
    )
    again = client.post("/api/auth/register", json=details)
    assert again.status_code == 202
    assert "demo_code" not in again.json()
    assert (
        client.post(
            "/api/auth/verify",
            json={
                "email": details["email"],
                "signup_id": again.json()["signup_id"],
                "code": "123456",
            },
        ).status_code
        == 404
    )


def test_registration_rejects_control_characters(client):
    response = client.post(
        "/api/auth/register",
        json={
            "name": "Bad\u0000Name",
            "email": "person@example.com",
            "password": "a secure password",
        },
    )
    assert response.status_code == 422


def test_failed_passwords_are_limited_per_account(client, monkeypatch):
    from app.routers import auth

    monkeypatch.setattr(auth, "FAILED_LOGINS_PER_ACCOUNT_HOUR", 2)
    monkeypatch.setattr(accounts, "_new_code", lambda: "123456")
    details = {"name": "A Person", "email": "a@example.com", "password": "a secure password"}
    pending = client.post("/api/auth/register", json=details).json()
    assert (
        client.post(
            "/api/auth/verify",
            json={"email": details["email"], "signup_id": pending["signup_id"], "code": "123456"},
        ).status_code
        == 201
    )
    for _ in range(2):
        assert (
            client.post(
                "/api/auth/login", json={"email": details["email"], "password": "incorrect"}
            ).status_code
            == 401
        )
    assert (
        client.post(
            "/api/auth/login", json={"email": details["email"], "password": details["password"]}
        ).status_code
        == 429
    )
    # A different address has an independent failure budget, including unknown accounts.
    assert (
        client.post(
            "/api/auth/login", json={"email": "other@example.com", "password": "incorrect"}
        ).status_code
        == 401
    )
