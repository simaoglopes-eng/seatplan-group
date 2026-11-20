"""Demo helpers: POST /demo/reset wipes and reseeds, GET /demo/links.

Both exist only when DEMO_MODE=1. With demo mode off they answer 404, so a
real deployment cannot be wiped through this router. Even in demo mode only
the X-Demo-Key header can reset.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Header, Request
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import db
from app.config import get_settings
from app.core.errors import ApiError
from app.models import Base, DemoLink, GuestAccount, Organiser
from app.security import client_ip, rate_limit, tokens_match
from app.seed.run import DEMO_MEMBER_EMAIL, DEMO_ORGANISER_EMAIL, DEMO_STAFF_EMAIL, seed_all

router = APIRouter(prefix="/demo", tags=["demo"])

# Accounts and the rate limit counters survive a reset: the person pressing
# "reset" stays logged in, and a reset cannot be used to clear a rate limit.
_KEEP_TABLES = {"organisers", "rate_limits"}
_SEEDED_USERS = (DEMO_ORGANISER_EMAIL, DEMO_STAFF_EMAIL, DEMO_MEMBER_EMAIL)


def _require_demo_mode() -> None:
    if not get_settings().demo_mode:
        raise ApiError(404, "not_found", "Not found.")


def _check_demo_key(given: str | None) -> None:
    """Only a matching X-Demo-Key may reset.

    No login is accepted: the demo accounts' passwords may be public, and a
    reset wipes everything. An empty DEMO_KEY must never mean "anyone may
    reset", so it rejects every caller.
    """
    configured = get_settings().demo_key
    if not configured or not given or not tokens_match(given, configured):
        raise ApiError(401, "unauthorised", "A valid X-Demo-Key header is needed.")


def _wipe(session: Session) -> None:
    # The work halves of visitors' one accounts (a work account with the
    # address of a guest account) go with their guest accounts. Kept, a new
    # sign-up after the reset would make a guest account with a new password
    # beside the old work password. The seeded demo users stay.
    one_account_work = list(
        session.scalars(
            select(Organiser.id)
            .join(GuestAccount, GuestAccount.email == Organiser.email)
            .where(Organiser.email.not_in(_SEEDED_USERS))
        )
    )
    # Reverse dependency order: children before the parents they point at.
    for table in reversed(Base.metadata.sorted_tables):
        if table.name not in _KEEP_TABLES:
            session.execute(delete(table))
    if one_account_work:
        session.execute(delete(Organiser).where(Organiser.id.in_(one_account_work)))


@router.post("/reset")
def reset(
    request: Request,
    session: db.SessionDep,
    x_demo_key: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    _require_demo_mode()
    rate_limit(session, f"demo-reset:{client_ip(request)}", limit=5, window_s=60)
    _check_demo_key(x_demo_key)
    _wipe(session)
    links = seed_all(session, get_settings(), actor="demo-key")
    return {"links": links}


@router.get("/links")
def links(session: db.SessionDep) -> dict[str, Any]:
    _require_demo_mode()
    rows = session.scalars(select(DemoLink).order_by(DemoLink.name))
    return {"links": {row.name: row.path for row in rows}}
