"""One account for bookings and work (/account/...).

- POST /account/register starts a sign-up with no event. The emailed code is
  typed into POST /guest/verify, which makes the guest account (bookings) and,
  when the address has none, the work account (staff and organiser pages).
- POST /account/login answers with every identity the password opens. The two
  session kinds stay apart: `guest.token` is a guest session, `work.token` an
  organiser session, and neither ever opens the other's routes.
- GET /account/work (work session) lists what the person can run.
"""

from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app import db
from app.core.errors import ApiError
from app.core.text import PlainText
from app.events_service import accounts, work
from app.events_service.schemas import GuestLoginIn
from app.models import GuestAccount, Organiser
from app.security import CurrentUser, create_guest_session, work_session_token

router = APIRouter(prefix="/account", tags=["account"])


class AccountRegisterIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: PlainText = Field(min_length=1, max_length=120)
    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=1, max_length=200)
    # The box must be ticked; false or missing is a 422.
    consent: Literal[True]


def work_session(user: Organiser) -> dict[str, Any]:
    """The work half of an answer: an organiser session and who it is."""
    return {
        "token": work_session_token(user),
        "user": {"email": user.email, "name": user.name, "role": user.role},
    }


def _guest_session(account: GuestAccount) -> dict[str, Any]:
    return {"token": create_guest_session(account), "account": accounts.account_out(account)}


@router.post("/register", status_code=202)
def register(body: AccountRegisterIn, request: Request, session: db.SessionDep) -> dict[str, Any]:
    """Email a code (or an "you already have an account" note). Same answer either way."""
    email = accounts.normalise_email(body.email)
    if not body.name.strip():
        raise ApiError(422, "validation", "name: Type your name.")
    accounts.check_new_password(body.password, email)
    accounts.count_code_send(session, request, email, "register")
    accounts.count_app_send(session)
    form = accounts.SignUp(body.name.strip(), email, body.password, False)
    show_code = accounts.may_show_code(session, email)
    key, code, signup_id = accounts.start_sign_up(session, None, form, show_code)
    accounts.send_at_once(session, key)
    return accounts.code_sent(email, code, signup_id)


@router.post("/login")
def login(body: GuestLoginIn, request: Request, session: db.SessionDep) -> dict[str, Any]:
    email = accounts.normalise_email(body.email)
    account, user = accounts.log_in_both(session, request, email, body.password)
    answer: dict[str, Any] = {}
    if account is not None:
        answer["guest"] = _guest_session(account)
    if user is not None:
        answer["work"] = work_session(user)
    return answer


@router.get("/work")
def my_work(user: CurrentUser, session: db.SessionDep) -> dict[str, Any]:
    return work.overview(session, user)
