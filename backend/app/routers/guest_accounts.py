"""Guest account routes (/guest/...), docs/guest-accounts.md section 6.4.

Sign-up finishes here (verify), and so do sign-in, sign-out, a forgotten
password, "my events" and deleting the account. The logic lives in
events_service/accounts.py; these routes check the body and the limits.
"""

from typing import Any

from fastapi import APIRouter, Request

from app import db
from app.core.errors import ApiError
from app.events_service import accounts
from app.events_service.schemas import (
    DeleteAccountIn,
    EmptyIn,
    ForgotIn,
    GuestLoginIn,
    RegisterIn,
    ResetIn,
    VerifyIn,
)
from app.models import GuestAccount
from app.routers.account import work_session
from app.security import (
    CurrentGuestAccount,
    client_ip,
    create_guest_session,
    rate_limit,
    verify_password,
)

router = APIRouter(prefix="/guest", tags=["guest accounts"])

DELETE_TRIES_PER_MINUTE = 10


def _session_out(account: GuestAccount) -> dict[str, Any]:
    return {"token": create_guest_session(account), "account": accounts.account_out(account)}


@router.post("/register", status_code=202)
def register_account(body: RegisterIn, request: Request, session: db.SessionDep) -> dict[str, Any]:
    """Create a pending account without requiring an event invitation."""
    email = accounts.normalise_email(body.email)
    if not body.name.strip():
        raise ApiError(422, "validation", "name: Enter your name.")
    accounts.check_new_password(body.password, email)
    accounts.require_signup_mail(email)
    accounts.count_code_send(session, request, email, "register")
    accounts.count_app_send(session)
    form = accounts.SignUp(body.name.strip(), email, body.password, body.needs_accessible)
    key, signup_id = accounts.start_standalone_sign_up(session, form)
    accounts.send_at_once(session, key)
    return accounts.code_sent(email, None, signup_id)


@router.post("/verify", status_code=201)
def verify(body: VerifyIn, request: Request, session: db.SessionDep) -> dict[str, Any]:
    """The emailed code: the account is made, signed in, and joins the event if it can.

    A sign-up from the account page (no event) also gets `work`, the work
    session, when this verify made the work account. When the address had a
    work account already, `work` is absent: sign in with /account/login.
    """
    accounts.count_code_check(session, request)
    email = accounts.normalise_email(body.email)
    account, join, work = accounts.finish_sign_up(session, email, body.code, body.signup_id)
    answer = {**_session_out(account), "join": join}
    if work is not None:
        answer["work"] = work_session(work)
    return answer


@router.post("/login")
def login(body: GuestLoginIn, request: Request, session: db.SessionDep) -> dict[str, Any]:
    email = accounts.normalise_email(body.email)
    return _session_out(accounts.log_in(session, request, email, body.password))


@router.post("/logout")
def logout(
    account: CurrentGuestAccount, session: db.SessionDep, body: EmptyIn | None = None
) -> dict[str, bool]:
    accounts.log_out(session, account)
    return {"signed_out": True}


@router.post("/password/forgot", status_code=202)
def forgot(body: ForgotIn, request: Request, session: db.SessionDep) -> dict[str, Any]:
    """Same answer whether or not the account exists.

    The code is never shown on screen, not even in the demo: anyone could
    otherwise set a new password for anyone's account.
    """
    email = accounts.normalise_email(body.email)
    accounts.count_code_send(session, request, email, "reset")
    key, _code = accounts.start_reset(session, email)
    accounts.send_at_once(session, key)
    return accounts.code_sent(email, None)


@router.post("/password/reset")
def reset(body: ResetIn, request: Request, session: db.SessionDep) -> dict[str, Any]:
    email = accounts.normalise_email(body.email)
    accounts.check_new_password(body.new_password, email)
    accounts.count_code_check(session, request)
    account = accounts.finish_reset(session, request, email, body.code, body.new_password)
    return _session_out(account)


@router.get("/me")
def me(account: CurrentGuestAccount, session: db.SessionDep) -> dict[str, Any]:
    return {
        "account": accounts.account_out(account),
        "events": accounts.my_events(session, account),
    }


@router.post("/me/delete")
def delete_me(
    body: DeleteAccountIn, account: CurrentGuestAccount, request: Request, session: db.SessionDep
) -> dict[str, bool]:
    """POST, not DELETE: it carries the password, and the frontend's delete helper sends no body.

    A wrong password is a 422 on the password field, not a 401: a 401 means
    "your session is over" and would sign the person out.
    """
    rate_limit(session, f"guest-delete:{client_ip(request)}", DELETE_TRIES_PER_MINUTE, 60)
    if not verify_password(body.password, account.password_hash):
        raise ApiError(422, "validation", "password: That password is not correct.")
    accounts.delete_account(session, account)
    return {"deleted": True}
