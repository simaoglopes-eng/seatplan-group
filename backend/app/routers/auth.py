"""POST /auth/login and GET /auth/me for organisers and staff."""

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import db
from app.config import get_settings
from app.core.errors import ApiError
from app.core.text import PlainText
from app.events_service import accounts
from app.mail import templates
from app.models import Organiser
from app.security import (
    CurrentUser,
    client_ip,
    hash_password,
    limit_reached,
    network_of,
    new_token,
    rate_limit,
    tokens_match,
    verify_password,
    work_session_token,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# Checked when the email is unknown, so a wrong email takes as long as a wrong
# password and the response time does not reveal which accounts exist.
_DUMMY_HASH = hash_password("not-a-real-password")
FAILED_LOGINS_PER_NETWORK_HOUR = 20
FAILED_LOGINS_PER_ACCOUNT_HOUR = 100
HOUR = 3600


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=1, max_length=200)


class UserOut(BaseModel):
    email: str
    name: str
    role: str


class LoginOut(BaseModel):
    token: str
    user: UserOut


def _user_out(user: Organiser) -> UserOut:
    return UserOut(email=user.email, name=user.name, role=user.role)


@router.post("/login")
def login(body: LoginIn, request: Request, session: db.SessionDep) -> LoginOut:
    rate_limit(session, f"login:{client_ip(request)}", limit=10, window_s=60)
    email = body.email.lower()
    network = network_of(client_ip(request))
    failures = [
        (f"organiser-login-fail:{email}|{network}", FAILED_LOGINS_PER_NETWORK_HOUR),
        (f"organiser-login-fail-all:{email}", FAILED_LOGINS_PER_ACCOUNT_HOUR),
    ]
    if any(limit_reached(session, key, limit, HOUR) for key, limit in failures):
        raise ApiError(429, "rate_limited", "Too many attempts. Please try again later.")
    user = session.scalars(select(Organiser).where(Organiser.email == email)).first()
    stored_hash = user.password_hash if user else _DUMMY_HASH
    password_ok = verify_password(body.password, stored_hash)
    if user is None or not password_ok:
        # Same message and limits for both known and unknown accounts.
        for key, limit in failures:
            rate_limit(session, key, limit, HOUR)
        raise ApiError(401, "unauthorised", "Email or password is not correct.")
    return LoginOut(token=work_session_token(user), user=_user_out(user))


@router.get("/me")
def me(user: CurrentUser) -> UserOut:
    return _user_out(user)


class RegisterIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: PlainText = Field(min_length=1, max_length=120)
    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=10, max_length=200)


class VerifyOrganiserIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr = Field(max_length=254)
    code: str = Field(pattern=r"^[0-9]{6}$")
    signup_id: str = Field(min_length=20, max_length=200)


@router.post("/register", status_code=202)
def register_organiser(body: RegisterIn, request: Request, session: db.SessionDep) -> dict:
    email = accounts.normalise_email(body.email)
    name = body.name.strip()
    if not name:
        raise ApiError(422, "validation", "name: Enter your name.")
    accounts.check_new_password(body.password, email)
    accounts.require_signup_mail(email)
    accounts.count_code_send(session, request, email, "org_reg")
    accounts.count_app_send(session)
    signup_id = new_token()
    password_hash = hash_password(body.password)
    existing = session.scalars(select(Organiser).where(Organiser.email == email)).first()
    if existing is None:
        row, code = accounts._new_code_row(
            session,
            email,
            "org_reg",
            name=name,
            password_hash=password_hash,
            signup_hash=accounts._signup_hash(signup_id),
        )
        key = accounts._code_key(row)
        parts = templates.account_code(
            "your organiser account", code, f"{get_settings().public_base_url}/login"
        )
        accounts._queue(session, key, "organiser_code", email, parts)
        session.commit()
        accounts.send_at_once(session, key)
    return accounts.code_sent(email, None, signup_id)


@router.post("/verify", status_code=201)
def verify_organiser(body: VerifyOrganiserIn, request: Request, session: db.SessionDep) -> LoginOut:
    accounts.count_code_check(session, request)
    email = accounts.normalise_email(body.email)
    row = accounts._live_code(session, email, "org_reg")
    if not tokens_match(row.signup_hash or "", accounts._signup_hash(body.signup_id)):
        raise ApiError(404, "not_found", accounts.EXPIRED)
    accounts._check_code(session, row, body.code)
    user = Organiser(
        email=email, name=row.name or "", password_hash=row.password_hash or "", role="organiser"
    )
    session.add(user)
    try:
        session.flush()
        accounts._drop_code(session, row)
        session.commit()
    except IntegrityError:
        session.rollback()
        raise ApiError(409, "conflict", "Please sign in or try again.") from None
    return LoginOut(token=work_session_token(user), user=_user_out(user))
