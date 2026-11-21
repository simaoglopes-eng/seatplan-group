"""Code emails cannot be used to flood an inbox or to learn who has an account.

- One count per inbox for every kind of code email together: 5 an hour.
- 30 seconds between two code emails to one inbox (429 too_soon), the same
  answer whether or not the address has an account, and it counts nothing.
- /auth/register and /guest/register do the same work for a taken address
  (a "you already have an account" note, sent at once) as for a new one.
- /account/register and /owner/register fail closed like the others when
  real email cannot be sent (accounts.require_signup_mail).
"""

from typing import Any

import pytest
from conftest import make_user
from fastapi.testclient import TestClient
from guest_helpers import GUEST_PASSWORD, make_account, outbox
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.events_service import accounts
from app.models import EmailCode, RateLimit
from app.security import _stored_key, mailbox

PASSWORD = "a secure password"


def _guest_register(client: TestClient, email: str) -> Any:
    body = {"name": "Max Moura", "email": email, "password": GUEST_PASSWORD, "consent": True}
    return client.post("/api/guest/register", json=body)


def _forgot(client: TestClient, email: str) -> Any:
    return client.post("/api/guest/password/forgot", json={"email": email})


def _organiser_register(client: TestClient, email: str) -> Any:
    body = {"name": "Max Moura", "email": email, "password": PASSWORD}
    return client.post("/api/auth/register", json=body)


def _owner_register(client: TestClient, email: str) -> Any:
    body = {"name": "Max Moura", "email": email, "password": PASSWORD, "consent": True}
    return client.post("/api/owner/register", json=body)


def _account_register(client: TestClient, email: str) -> Any:
    body = {"name": "Max Moura", "email": email, "password": GUEST_PASSWORD, "consent": True}
    return client.post("/api/account/register", json=body)


def _wait_over(session: Session, email: str) -> None:
    """As if 31 seconds had passed since the last code email to this inbox."""
    key = _stored_key(f"code-send-recent:{mailbox(email)}")
    session.execute(
        update(RateLimit)
        .where(RateLimit.key == key)
        .values(window_start=RateLimit.window_start - 31)
    )
    session.commit()


@pytest.mark.usefixtures("no_resend_wait")
def test_the_sixth_code_email_to_one_inbox_in_an_hour_is_refused(
    client: TestClient, session: Session
) -> None:
    """Every purpose shares one count: before, each had 3 of its own (15 an hour)."""
    sends = [
        _guest_register(client, "max@example.com"),
        _forgot(client, "MAX@example.com"),
        _organiser_register(client, "max+a@example.com"),
        _owner_register(client, "max+b@example.com"),
        _account_register(client, "max@example.com"),
    ]
    assert [answer.status_code for answer in sends] == [202] * 5
    codes = session.scalars(select(EmailCode.id)).all()
    sixth = _forgot(client, "max+c@example.com")
    assert sixth.status_code == 429, sixth.text
    assert sixth.json()["error"]["code"] == "rate_limited"
    assert _owner_register(client, "max@example.com").status_code == 429
    session.expire_all()
    assert session.scalars(select(EmailCode.id)).all() == codes


def test_gmail_dots_are_the_same_inbox() -> None:
    assert mailbox("V.I.C.Tim+x@Gmail.com") == mailbox("victim@gmail.com") == "victim@gmail.com"
    assert mailbox("vi.ctim@googlemail.com") == "victim@googlemail.com"
    # Elsewhere a dot may name another person's inbox.
    assert mailbox("a.na@example.com") == "a.na@example.com"


def test_gmail_dot_variants_share_the_wait(client: TestClient) -> None:
    assert _guest_register(client, "victim@gmail.com").status_code == 202
    dotted = _guest_register(client, "v.ictim@gmail.com")
    assert dotted.status_code == 429 and dotted.json()["error"]["code"] == "too_soon"


def test_a_second_code_within_30_seconds_is_refused_and_tells_no_one_anything(
    client: TestClient, session: Session
) -> None:
    make_account(session, "has.account@example.com")
    first_new = _guest_register(client, "new.person@example.com")
    first_known = _guest_register(client, "has.account@example.com")
    assert first_new.status_code == first_known.status_code == 202
    code_hashes = session.scalars(select(EmailCode.code_hash)).all()

    again_new = _guest_register(client, "new.person@example.com")
    again_known = _guest_register(client, "has.account@example.com")
    assert again_new.status_code == again_known.status_code == 429
    assert again_new.json() == again_known.json()
    assert again_new.json()["error"] == {
        "code": "too_soon",
        "message": "We just sent an email to this address. "
        "Please wait 30 seconds before asking for another one.",
    }
    # The live code was not replaced.
    session.expire_all()
    assert session.scalars(select(EmailCode.code_hash)).all() == code_hashes
    # Any other purpose for the same inbox waits too: no unknown or known split.
    assert _forgot(client, "new.person@example.com").json() == again_new.json()
    assert _forgot(client, "has.account@example.com").json() == again_new.json()

    _wait_over(session, "new.person@example.com")
    assert _guest_register(client, "new.person@example.com").status_code == 202


def test_waiting_requests_do_not_use_up_the_hourly_count(
    client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(accounts, "CODE_SENDS_PER_MAILBOX_HOUR", 2)
    assert _guest_register(client, "ivo@example.com").status_code == 202
    for _ in range(3):
        assert _guest_register(client, "ivo@example.com").status_code == 429
    _wait_over(session, "ivo@example.com")
    assert _guest_register(client, "ivo@example.com").status_code == 202  # the second of 2
    _wait_over(session, "ivo@example.com")
    third = _guest_register(client, "ivo@example.com")
    assert third.status_code == 429 and third.json()["error"]["code"] == "rate_limited"


def test_owner_sign_up_codes_wait_too(client: TestClient, session: Session) -> None:
    first = _owner_register(client, "olga@example.com")
    assert first.status_code == 202
    hashes = session.scalars(select(EmailCode.code_hash)).all()
    second = _owner_register(client, "olga@example.com")
    assert second.status_code == 429 and second.json()["error"]["code"] == "too_soon"
    session.expire_all()
    assert session.scalars(select(EmailCode.code_hash)).all() == hashes


def _record_sends(monkeypatch: pytest.MonkeyPatch) -> list[str | None]:
    sent: list[str | None] = []
    monkeypatch.setattr(accounts, "send_at_once", lambda _session, key: sent.append(key))
    return sent


def test_organiser_sign_up_does_the_same_work_for_a_taken_address(
    client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent = _record_sends(monkeypatch)
    make_user(session, "taken@example.com")
    assert _organiser_register(client, "free@example.com").status_code == 202
    assert _organiser_register(client, "taken@example.com").status_code == 202
    assert len(sent) == 2 and all(sent)
    kinds = {row.to_email: row.kind for row in outbox(session)}
    assert kinds == {"free@example.com": "organiser_code", "taken@example.com": "account_exists"}
    note = outbox(session, "account_exists")[0]
    assert "taken@example.com" not in note.idempotency_key
    assert note.idempotency_key == sent[1]


def test_guest_sign_up_does_the_same_work_for_a_taken_address(
    client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent = _record_sends(monkeypatch)
    make_account(session, "known@example.com")
    assert _guest_register(client, "unknown@example.com").status_code == 202
    assert _guest_register(client, "known@example.com").status_code == 202
    assert len(sent) == 2 and all(sent)
    assert [row.kind for row in outbox(session)] == ["account_code", "account_exists"]


@pytest.mark.usefixtures("no_resend_wait")
@pytest.mark.parametrize(
    ("register", "taken"),
    [
        (_guest_register, "guest"),
        (_account_register, "guest"),
        (_organiser_register, "work"),
        (_owner_register, "work"),
    ],
)
def test_every_repeat_for_a_taken_address_sends_a_note_of_its_own(
    client: TestClient,
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
    register: Any,
    taken: str,
) -> None:
    """A note key shared within the hour would let the outbox skip the second
    send, so the second answer for a taken address would come back faster
    than the one for a new address, which always sends a fresh code."""
    sent = _record_sends(monkeypatch)
    if taken == "guest":
        make_account(session, "known@example.com")
    else:
        make_user(session, "known@example.com")
    for _ in range(3):
        assert register(client, "known@example.com").status_code == 202
    notes = [row for row in outbox(session) if row.to_email == "known@example.com"]
    assert len(notes) == 3
    keys = [note.idempotency_key for note in notes]
    assert len(set(keys)) == 3 and sent == keys


@pytest.mark.parametrize("register", [_account_register, _owner_register])
def test_sign_ups_fail_closed_when_real_email_cannot_be_sent(
    client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch, register: Any
) -> None:
    monkeypatch.setenv("VERCEL", "1")  # a deployment, with the console provider: no real email
    get_settings.cache_clear()
    refused = register(client, "someone@example.com")
    assert refused.status_code == 503, refused.text
    assert refused.json()["error"]["code"] == "service_unavailable"
    assert session.scalars(select(EmailCode)).first() is None
