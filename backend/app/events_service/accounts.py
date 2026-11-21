"""Guest accounts: emailed codes, sign-up, sign-in, new password and deletion.

The main rule (docs/guest-accounts.md, D1): nothing that counts is made until
the person types the 6-digit code we emailed them. Until then only a pending
row in `email_codes` exists, which expires after 15 minutes. That is what
stops someone filling an event with made-up addresses, and what makes it safe
to link an account to an invited guest with the same address.

Codes are never stored as typed: only HMAC-SHA256(SECRET_KEY, purpose, email,
code). A plain SHA-256 of a 6-digit code could be reversed by trying all one
million codes.
"""

import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from fastapi import Request
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core import audit, members
from app.core.errors import ApiError
from app.core.parent_venue import shown_venue_of
from app.core.privacy import mask_email
from app.events_service import share
from app.events_service.access import deadline_passed
from app.events_service.guests import erase_guest
from app.events_service.mailer import forget_guest_emails
from app.events_service.party import erase_party, members_of
from app.events_service.problem import current_rows
from app.events_service.seating import drop_assignment, lock_event
from app.mail import templates
from app.mail.outbox import CODE_REMOVED, enqueue, send_now
from app.mail.providers import provider_from_settings
from app.models import (
    EmailCode,
    EmailOutbox,
    Event,
    Guest,
    GuestAccount,
    Organiser,
    Seat,
    Venue,
    VenueMember,
    VenueTable,
    utc_now,
)
from app.security import (
    clear_limit,
    client_ip,
    hash_password,
    keyed_hash,
    limit_reached,
    mailbox,
    network_of,
    new_token,
    rate_limit,
    tokens_match,
    verify_password,
)

CODE_MINUTES = 15
MAX_CODE_TRIES = 5
MIN_PASSWORD_LENGTH = 10
CONSENT_VERSION = "2026-11-14"
# Rate limits (docs/guest-accounts.md, 8.1). Module constants so tests can lower them.
# The per-network numbers leave room for a whole conference on one Wi-Fi.
CODE_SENDS_PER_NETWORK_HOUR = 60
CODE_SENDS_PER_NETWORK_DAY = 200
CODE_SENDS_PER_MAILBOX_HOUR = 3
CODE_SENDS_PER_APP_HOUR = 500
CODE_CHECKS_PER_NETWORK = 100
CODE_CHECK_WINDOW = 600
LOGINS_PER_MINUTE = 10
# Wrong passwords for one address from one network, then from all networks
# together. The first stops one guesser without locking the owner out
# everywhere; the second stops guessing spread over many networks.
FAILED_LOGINS_PER_HOUR = 20
FAILED_LOGINS_PER_ACCOUNT_HOUR = 100
HOUR, DAY = 3600, 86400
CODE_KIND = {"register": "account_code", "reset": "password_code"}
CODE_KEY = {"register": "account-code", "reset": "password-code", "org_reg": "organiser-code"}
EXPIRED = "This code has expired or was replaced. Please ask for a new one."
TOO_MANY_FAILS = "Too many tries for this account. Reset your password or try again in an hour."
# The demo shows sign-up codes on screen only for these made-up addresses
# (example.com is reserved: nobody owns a real inbox there).
DEMO_DOMAIN = "@example.com"
# Checked when the email is unknown, so a wrong email takes as long as a wrong
# password and the response time does not reveal which accounts exist.
_DUMMY_HASH = hash_password("not-a-real-password")


def normalise_email(email: str) -> str:
    """Lower case and trimmed. A "+tag" is kept: the mail server treats it as another address."""
    return email.strip().lower()


def check_new_password(password: str, email: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ApiError(422, "validation", "password: Use at least 10 characters.")
    if password.strip().lower() == normalise_email(email):
        raise ApiError(422, "validation", "password: Do not use your email address.")


def require_signup_mail(email: str) -> None:
    """Fail closed on Vercel if verification email cannot be sent to this address."""
    settings = get_settings()
    if not settings.trust_forwarded_for:
        return
    if (
        settings.email_provider != "resend"
        or not settings.resend_api_key
        or (not settings.email_allow_all and email not in settings.email_allowlist)
    ):
        raise ApiError(
            503,
            "service_unavailable",
            "Account registration is temporarily unavailable. Please try again later.",
        )


def account_out(account: GuestAccount) -> dict[str, Any]:
    return {"name": account.name, "email": account.email, "created_at": account.created_at}


def sign_in_link() -> str:
    return f"{get_settings().public_base_url}/my/sign-in"


# ---------------------------------------------------------------- limits


def count_code_send(session: Session, request: Request, email: str, purpose: str) -> None:
    """The network and inbox limits on code emails, counted before any other write. Commits.

    `purpose` is "register" or "reset". Each has its own inbox count, so
    asking for reset codes cannot use up someone's sign-up codes.
    """
    network = network_of(client_ip(request))
    rate_limit(session, f"code-send:{network}", CODE_SENDS_PER_NETWORK_HOUR, HOUR)
    rate_limit(session, f"code-send-day:{network}", CODE_SENDS_PER_NETWORK_DAY, DAY)
    inbox_key = f"code-send-mail-{purpose}:{mailbox(email)}"
    rate_limit(session, inbox_key, CODE_SENDS_PER_MAILBOX_HOUR, HOUR)


def count_app_send(session: Session) -> None:
    """The whole app's limit: protects the sending domain and the email quota.

    Counted only when an email is really about to be queued, so requests
    that send nothing cannot use it up. Commits; call before any other write.
    """
    rate_limit(session, "code-send-all:all", CODE_SENDS_PER_APP_HOUR, HOUR)


def count_code_check(session: Session, request: Request) -> None:
    network = network_of(client_ip(request))
    rate_limit(session, f"code-check:{network}", CODE_CHECKS_PER_NETWORK, CODE_CHECK_WINDOW)


# ---------------------------------------------------------------- codes


def _code_hash(purpose: str, email: str, code: str) -> str:
    return keyed_hash(f"{purpose}:{email}:{code}")


def _code_key(row: EmailCode) -> str:
    return f"{CODE_KEY[row.purpose]}:{row.id}"


def _drop_code(session: Session, row: EmailCode) -> None:
    """Delete a code row, and stop its email if it has not gone out yet. No commit."""
    session.execute(
        update(EmailOutbox)
        .where((EmailOutbox.idempotency_key == _code_key(row)) & (EmailOutbox.status == "queued"))
        .values(
            status="skipped",
            body_text=CODE_REMOVED,
            body_html=CODE_REMOVED,
            last_error="Code used or replaced",
        )
    )
    session.delete(row)
    session.flush()


def _new_code() -> str:
    """Six random digits. A function of its own so tests can play the inbox."""
    return f"{secrets.randbelow(10**6):06d}"


def _signup_hash(signup_id: str) -> str:
    return keyed_hash(f"signup:{signup_id}")


def _new_code_row(
    session: Session, email: str, purpose: str, **pending: Any
) -> tuple[EmailCode, str]:
    """Replace this address's code for `purpose` with a new one. Returns the row and the code."""
    old = session.scalars(
        select(EmailCode).where((EmailCode.email == email) & (EmailCode.purpose == purpose))
    ).first()
    if old is not None:
        _drop_code(session, old)
    code = _new_code()
    now = utc_now()
    row = EmailCode(
        email=email,
        purpose=purpose,
        code_hash=_code_hash(purpose, email, code),
        created_at=now,
        expires_at=now + timedelta(minutes=CODE_MINUTES),
        **pending,
    )
    session.add(row)
    session.flush()
    return row, code


def _live_code(session: Session, email: str, purpose: str) -> EmailCode:
    row = session.scalars(
        select(EmailCode).where((EmailCode.email == email) & (EmailCode.purpose == purpose))
    ).first()
    if row is None or row.expires_at <= utc_now():
        raise ApiError(404, "not_found", EXPIRED)
    return row


def _check_code(session: Session, row: EmailCode, code: str) -> None:
    """Return when the code is right. Otherwise answer 422. Commits on a miss.

    The try is counted in the database BEFORE the code is compared, in one
    UPDATE that refuses to go past MAX_CODE_TRIES. So many requests sent at
    the same moment still get only MAX_CODE_TRIES guesses between them.
    """
    attempts = session.execute(
        update(EmailCode)
        .where((EmailCode.id == row.id) & (EmailCode.attempts < MAX_CODE_TRIES))
        .values(attempts=EmailCode.attempts + 1)
        .returning(EmailCode.attempts)
    ).scalar()
    right = tokens_match(row.code_hash, _code_hash(row.purpose, row.email, code))
    if attempts is not None and right:
        return
    left = MAX_CODE_TRIES - attempts if attempts is not None else 0
    if left <= 0:
        _drop_code(session, row)
        message = "That code is not right. Please ask for a new code."
    else:
        tries = "try" if left == 1 else "tries"
        message = f"That code is not right. You have {left} {tries} left."
    session.commit()
    raise ApiError(422, "validation", message)


def may_show_code(session: Session, email: str) -> bool:
    """May the sign-up answer carry the code itself (section 7.2)?

    Only in a demo that sends no real email (DEMO_MODE=1 and the console
    provider), only for made-up example.com addresses, and never for an
    address an organiser invited or an owner added to a venue's team:
    showing that code would let anyone take over the invitation, or the
    staff access, by typing the address. Password reset codes are never
    shown (see routers/guest_accounts.py).
    """
    settings = get_settings()
    if not (settings.demo_mode and settings.email_provider == "console"):
        return False
    if not email.endswith(DEMO_DOMAIN):
        return False
    if members.is_member_anywhere(session, email):
        return False
    return not share.invited_anywhere(session, email)


def code_sent(email: str, code: str | None, signup_id: str | None = None) -> dict[str, Any]:
    """The 202 answer. `code` is given only when may_show_code() said yes.

    `signup_id` goes back to this browser only; /guest/verify needs it.
    """
    body: dict[str, Any] = {
        "status": "code_sent",
        "sent_to": mask_email(email),
        "expires_in_seconds": CODE_MINUTES * 60,
    }
    if signup_id is not None:
        body["signup_id"] = signup_id
    if code is not None:
        body["demo_code"] = code
    return body


def _queue(session: Session, key: str, kind: str, email: str, parts: templates.EmailParts) -> None:
    enqueue(
        session,
        idempotency_key=key,
        to_email=email,
        kind=kind,
        subject=parts.subject,
        body_text=parts.body_text,
        body_html=parts.body_html,
    )


def send_at_once(session: Session, key: str | None) -> None:
    """Send a code email now instead of waiting for the cron (it must arrive
    while the person waits). Call after the commit. Never raises: when it
    fails the row stays queued and the cron sends it."""
    if key is None:
        return
    try:
        provider = provider_from_settings(get_settings())
    except ValueError:
        return  # for example RESEND_API_KEY missing: the cron reports it
    send_now(session, provider, key, utc_now())


# ---------------------------------------------------------------- sign-up


def find_account(session: Session, email: str) -> GuestAccount | None:
    return session.scalars(select(GuestAccount).where(GuestAccount.email == email)).first()


@dataclass(frozen=True)
class SignUp:
    """What the person typed on the sign-up form, already checked."""

    name: str
    email: str
    password: str
    needs_accessible: bool


def start_sign_up(
    session: Session, event: Event | None, form: SignUp, show_code: bool
) -> tuple[str, str | None, str]:
    """Store a pending sign-up and queue its code, or warn an existing account.

    Returns (the outbox key to send now, the code or None, the sign-up id).
    Commits. The caller answers the same 202 either way, so nobody learns
    who has an account. The code is returned only when `show_code` is true.
    `event` is None for a sign-up from the account page (POST /account/register):
    its pending row has no event, and /guest/verify then also makes the work
    account (finish_sign_up).
    """
    # A random id that only this browser gets back. A pending sign-up can be
    # finished only with it, so whoever starts a sign-up must finish it too.
    signup_id = new_token()
    # Hashed in both branches, so the time taken does not tell who has an
    # account. Hashed now, so not even the pending row holds the password.
    password_hash = hash_password(form.password)
    existing = find_account(session, form.email)
    if existing is not None:
        hour = utc_now().strftime("%Y%m%d%H")
        # A keyed hash, not the address: keys outlive a deleted account.
        key = f"account-exists:{keyed_hash('mailbox:' + mailbox(form.email))[:32]}:{hour}"
        if event is None:
            parts = templates.account_exists_general(existing.name, sign_in_link())
        else:
            parts = templates.account_exists(existing.name, event.name, sign_in_link())
        _queue(session, key, "account_exists", form.email, parts)
        session.commit()
        return key, None, signup_id
    row, code = _new_code_row(
        session,
        form.email,
        "register",
        event_id=event.id if event is not None else None,
        name=form.name,
        password_hash=password_hash,
        needs_accessible=form.needs_accessible,
        signup_hash=_signup_hash(signup_id),
        share_version=event.share_version if event is not None else None,
        code_shown=show_code,
    )
    if event is None:
        parts = templates.account_code_general(code, sign_in_link())
    else:
        parts = templates.account_code(event.name, code, sign_in_link())
    _queue(session, _code_key(row), CODE_KIND["register"], form.email, parts)
    session.commit()
    return _code_key(row), (code if show_code else None), signup_id


def start_standalone_sign_up(session: Session, form: SignUp) -> tuple[str | None, str]:
    """Queue verification without joining an event; never expose the code in the response."""
    signup_id = new_token()
    password_hash = hash_password(form.password)
    if find_account(session, form.email) is not None:
        return None, signup_id
    row, code = _new_code_row(
        session,
        form.email,
        "register",
        name=form.name,
        password_hash=password_hash,
        needs_accessible=form.needs_accessible,
        signup_hash=_signup_hash(signup_id),
        code_shown=False,
    )
    parts = templates.account_code("your participant account", code, sign_in_link())
    key = _code_key(row)
    _queue(session, key, CODE_KIND["register"], form.email, parts)
    session.commit()
    return key, signup_id


def _create_account(session: Session, row: EmailCode) -> GuestAccount:
    account = GuestAccount(
        email=row.email,
        name=row.name or "",
        password_hash=row.password_hash or "",
        consent_at=row.created_at,
        consent_version=CONSENT_VERSION,
        last_login_at=utc_now(),
        # A code shown on screen proves nothing about the inbox.
        email_proven=not row.code_shown,
    )
    session.add(account)
    try:
        session.flush()
    except IntegrityError:
        # Two right codes for one address at the same moment: the database
        # lets one account in; the other request is told to try again.
        session.rollback()
        raise ApiError(409, "conflict", "Please try again.") from None
    return account


def _create_work_identity(
    session: Session, row: EmailCode, account: GuestAccount
) -> Organiser | None:
    """The work account of an account-page sign-up: same address, name and password.

    None when a work account with this address already exists: it is never
    changed here (its owner proved nothing new). Made in a savepoint, so a
    work account written by someone else at the same moment costs only the
    work half, never the guest account. No commit.
    """
    return _make_work_identity(session, account, row.email, row.name or "", row.password_hash or "")


def _make_work_identity(
    session: Session, account: GuestAccount, email: str, name: str, password_hash: str
) -> Organiser | None:
    """A work account with this address and password hash, unless one exists. No commit."""
    if session.scalar(select(Organiser.id).where(Organiser.email == email)) is not None:
        return None
    user = Organiser(email=email, name=name, password_hash=password_hash, role="organiser")
    try:
        with session.begin_nested():
            session.add(user)
            session.flush()
    except IntegrityError:
        return None
    audit.record(
        session,
        actor=f"account:{account.id}",
        action="account.work_create",
        entity="organiser",
        entity_id=str(user.id),
    )
    return user


def _work_identity(session: Session, email: str) -> Organiser | None:
    """The work account with this address, if any: the work half of one account."""
    return session.scalars(select(Organiser).where(Organiser.email == email)).first()


def _runs_something(session: Session, user: Organiser) -> bool:
    """Does this work account own a venue or an event, or did it add a team member?"""
    for column in (Venue.organiser_id, Event.organiser_id, VenueMember.added_by):
        if session.scalar(select(column).where(column == user.id).limit(1)) is not None:
            return True
    return False


def _event_to_join(session: Session, row: EmailCode) -> Event | None:
    """The event of the sign-up, or None when its link was replaced since."""
    event = session.get(Event, row.event_id) if row.event_id is not None else None
    if event is None or event.share_version != row.share_version:
        return None
    return event


def finish_sign_up(
    session: Session, email: str, code: str, signup_id: str
) -> tuple[GuestAccount, dict[str, Any], Organiser | None]:
    """Right code from the right browser: make the account, drop the code, join. Commits.

    The account is made in every case; only a successful join adds a guest
    row. A sign-up id from another browser is answered like an expired code
    and does not use up a try. A sign-up with no event (the account page)
    joins nothing and also makes the work account when the address has none;
    that work account is the third value, else None.
    """
    row = _live_code(session, email, "register")
    if not tokens_match(row.signup_hash or "", _signup_hash(signup_id)):
        raise ApiError(404, "not_found", EXPIRED)
    _check_code(session, row, code)
    account_only = row.event_id is None
    event = _event_to_join(session, row)
    if event is not None:
        share.count_new_join(session, event, email, None)  # commits; before our writes
    account = _create_account(session, row)
    work = _create_work_identity(session, row, account) if account_only else None
    needs_accessible = row.needs_accessible
    _drop_code(session, row)
    result: dict[str, Any] = {"status": "link_closed", "event_id": None}
    if account_only:
        result = {"status": "account_only", "event_id": None}
    elif event is not None:
        result = share.join(session, event, account, needs_accessible)
    session.commit()
    return account, result, work


# ---------------------------------------------------------------- sign-in and password


def _fail_keys(request: Request, email: str) -> list[tuple[str, int]]:
    """The failed-login counts for this address: (key, limit)."""
    network = network_of(client_ip(request))
    return [
        (f"guest-login-fail:{email}|{network}", FAILED_LOGINS_PER_HOUR),
        (f"guest-login-fail-all:{email}", FAILED_LOGINS_PER_ACCOUNT_HOUR),
    ]


def log_in(session: Session, request: Request, email: str, password: str) -> GuestAccount:
    """The account, or 401 with one message for an unknown address and a wrong password.

    After too many failures for one address (from this network, or from all
    networks together), every try is refused before the password is even
    checked, so guessing stops. Someone guessing from their own network
    blocks only that network, not the owner at home.
    """
    rate_limit(session, f"guest-login:{client_ip(request)}", LOGINS_PER_MINUTE, 60)
    keys = _fail_keys(request, email)
    if any(limit_reached(session, key, limit, HOUR) for key, limit in keys):
        raise ApiError(429, "rate_limited", TOO_MANY_FAILS)
    account = find_account(session, email)
    password_ok = verify_password(password, account.password_hash if account else _DUMMY_HASH)
    if account is None or not password_ok:
        for key, limit in keys:
            rate_limit(session, key, limit, HOUR)
        raise ApiError(401, "unauthorised", "Email or password is not correct.")
    account.last_login_at = utc_now()
    session.commit()
    return account


def log_in_both(
    session: Session, request: Request, email: str, password: str
) -> tuple[GuestAccount | None, Organiser | None]:
    """POST /account/login: the guest account and the work account this password opens.

    Both limits of the two sign-in doors apply (per address: the work login's
    and the guest login's), and the guest failed-login caps are checked
    before any password. Both passwords are always checked, against a dummy
    hash when an identity is missing, so the time taken does not tell which
    identities exist. A failure is counted only when neither opens; then the
    answer is the same 401 as the two other sign-in doors.
    """
    address = client_ip(request)
    rate_limit(session, f"login:{address}", LOGINS_PER_MINUTE, 60)
    rate_limit(session, f"guest-login:{address}", LOGINS_PER_MINUTE, 60)
    keys = _fail_keys(request, email)
    if any(limit_reached(session, key, limit, HOUR) for key, limit in keys):
        raise ApiError(429, "rate_limited", TOO_MANY_FAILS)
    account = find_account(session, email)
    found = _work_identity(session, email)
    guest_ok = verify_password(password, account.password_hash if account else _DUMMY_HASH)
    work_ok = verify_password(password, found.password_hash if found else _DUMMY_HASH)
    account = account if guest_ok else None
    user = found if work_ok else None
    if account is None and user is None:
        for key, limit in keys:
            rate_limit(session, key, limit, HOUR)
        raise ApiError(401, "unauthorised", "Email or password is not correct.")
    if account is not None:
        if found is None and account.email_proven and members.is_member_anywhere(session, email):
            # A guest account from before one sign-up made both identities,
            # now on a venue's team: its work half, with the same password.
            user = _make_work_identity(session, account, email, account.name, account.password_hash)
        account.last_login_at = utc_now()
        session.commit()
    return account, user


def start_reset(session: Session, email: str) -> tuple[str | None, str | None]:
    """Queue a reset code when the account exists. Returns (outbox key, code). Commits."""
    account = find_account(session, email)
    if account is None:
        return None, None
    count_app_send(session)  # only now: an email is really about to be queued
    row, code = _new_code_row(session, email, "reset")
    parts = templates.password_code(account.name, code, sign_in_link())
    _queue(session, _code_key(row), CODE_KIND["reset"], email, parts)
    session.commit()
    return _code_key(row), code


def finish_reset(
    session: Session, request: Request, email: str, code: str, new_password: str
) -> GuestAccount:
    """Right code: new password, every older session ends. Commits.

    The work account with the same address gets the same new password, and
    its older sessions end too: one account, one password. The emailed code
    (never shown on screen, not even in the demo) proves the inbox, which is
    what a work account rests on as well.
    """
    row = _live_code(session, email, "reset")
    _check_code(session, row, code)
    account = find_account(session, email)
    if account is None:
        raise ApiError(404, "not_found", EXPIRED)
    account.password_hash = hash_password(new_password)
    account.session_version += 1
    user = _work_identity(session, email)
    if user is not None:
        user.password_hash = account.password_hash
        user.session_version += 1
        audit.record(
            session,
            actor=f"account:{account.id}",
            action="account.work_password",
            entity="organiser",
            entity_id=str(user.id),
        )
    _drop_code(session, row)
    # The owner proved the inbox, so the failed-login counts start again.
    for key, _limit in _fail_keys(request, email):
        clear_limit(session, key)
    session.commit()
    return account


def log_out(session: Session, account: GuestAccount) -> None:
    """Sign out on every device: older tokens carry the old version number."""
    account.session_version += 1
    session.commit()


# ---------------------------------------------------------------- my events


def _seat_of(session: Session, event: Event, guest: Guest) -> dict[str, str] | None:
    row = current_rows(session, event).get(guest.id)
    seat = session.get(Seat, row.seat_id) if row else None
    if seat is None:
        return None
    table = session.get(VenueTable, seat.table_id)
    return {"seat_label": seat.label, "table_label": table.label if table else "-"}


def my_events(session: Session, account: GuestAccount) -> list[dict[str, Any]]:
    """MyEvent for each event the account is on (not erased), by start time."""
    rows = session.scalars(
        select(Guest).where((Guest.account_id == account.id) & Guest.token_revoked_at.is_(None))
    )
    found = []
    for guest in rows:
        event = session.get(Event, guest.event_id)
        venue = shown_venue_of(session, event.venue_id) if event else None
        if event is None or venue is None:
            continue
        found.append(
            {
                "event_id": event.public_id,
                "name": event.name,
                "starts_at": event.starts_at,
                "ends_at": event.ends_at,
                "venue_name": venue.name,
                "deadline_passed": deadline_passed(event),
                "rsvp": guest.rsvp,
                "seat": _seat_of(session, event, guest),
            }
        )
    return sorted(found, key=lambda item: item["starts_at"])


# ---------------------------------------------------------------- deleting an account


def _leave_event(session: Session, guest: Guest, actor: str) -> None:
    """Take the account off one event (docs/guest-accounts.md, 11.1). No commit.

    A row the account made is erased like an organiser erasure. A row the
    organiser typed stays theirs: we free the seat without an email, wipe the
    emails we sent, and unlink it.

    The party members this account booked (party.py) were typed by the
    account holder, so they are erased in every case, also when the organiser
    already deleted the booker's row and kept the members (party=keep).
    """
    event = session.get(Event, guest.event_id)
    if event is not None and members_of(session, guest):
        lock_event(session, event)  # before any other write, see seating.py
        erase_party(session, event, guest, actor)
    # Profile details supplied by the account holder do not belong to the invitation.
    guest.first_name = None
    guest.last_name = None
    guest.birth_date = None
    guest.share_age = False
    guest.age_years = None
    if event is None or guest.token_revoked_at is not None:
        # The organiser removed this row earlier: it only remembered the
        # account, so that it could not join again. Forget that too.
        guest.account_id = None
        return
    if guest.source == "self_registered":
        erase_guest(session, event, guest, actor)
        guest.account_id = None
        return
    lock_event(session, event)
    drop_assignment(session, event, guest, actor=actor, notify=False)
    forget_guest_emails(session, event, guest.id)
    guest.account_id = None


def _forget_account_emails(session: Session, email: str) -> None:
    """Blank the code and "you already have an account" emails sent to this address."""
    kinds = (*CODE_KIND.values(), "account_exists")
    rows = session.scalars(
        select(EmailOutbox).where(EmailOutbox.kind.in_(kinds) & (EmailOutbox.to_email == email))
    )
    for row in rows:
        row.to_email = ""
        row.subject = "(erased)"
        row.body_text = ""
        row.body_html = ""
        row.last_error = None
        if row.status != "sent":
            row.status = "skipped"


def delete_account(session: Session, account: GuestAccount) -> None:
    """GDPR erasure of the account and what it owns. Commits.

    The work account with the same address goes too when it runs nothing (no
    venue, no event, no team member added). One that runs something is a
    business's account and stays, with its own password; the venue teams
    that list the address are their owners' lists and stay as well. It goes
    only when this account proved the inbox, or shares the very same password
    hash (made by its own sign-up or reset): a demo account made with a code
    shown on screen must not delete someone else's work account.
    """
    actor = f"account:{account.id}"
    user = _work_identity(session, account.email)
    linked = user is not None and (
        account.email_proven or tokens_match(user.password_hash, account.password_hash)
    )
    if user is not None and linked and not _runs_something(session, user):
        session.delete(user)
        audit.record(
            session,
            actor=actor,
            action="account.work_delete",
            entity="organiser",
            entity_id=str(user.id),
        )
    guests = session.scalars(
        select(Guest).where(Guest.account_id == account.id).order_by(Guest.event_id)
    ).all()
    for guest in guests:  # by event id, so two deletions lock events in the same order
        _leave_event(session, guest, actor)
    session.execute(delete(EmailCode).where(EmailCode.email == account.email))
    _forget_account_emails(session, account.email)
    session.flush()  # the guest rows let go of the account before it is deleted
    session.delete(account)
    audit.record(
        session, actor=actor, action="account.delete", entity="account", entity_id=str(account.id)
    )
    session.commit()
