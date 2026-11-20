"""The owner's deposit settings (/owner/restaurants/{vid}/payments)."""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from app import db
from app.core.text import PlainText
from app.payments import money
from app.restaurant_service import policies, profiles
from app.security import CurrentOrganiser

router = APIRouter(tags=["owner payments"])


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PolicyIn(Strict):
    # "" means every service without a rule of its own.
    service_name: PlainText = Field(default="", max_length=40)
    per_person_cents: int = Field(ge=1, le=money.MAX_PER_PERSON_CENTS, strict=True)
    cancel_hours: int = Field(strict=True)
    min_party: int = Field(default=1, ge=1, le=money.MAX_MIN_PARTY, strict=True)


class PoliciesIn(Strict):
    # An empty list switches deposits off.
    policies: list[PolicyIn] = Field(max_length=policies.MAX_POLICIES)


def _view(session: db.SessionDep, venue: Any) -> dict[str, Any]:
    return {
        "payments_mode": policies.payments_mode(),
        # False until online payments are connected: the form then explains why.
        "available": policies.payments_enabled(venue),
        "minimum_cents": policies.minimum_cents(),
        "max_per_person_cents": money.MAX_PER_PERSON_CENTS,
        "cancel_hours": list(money.CANCEL_HOURS),
        "services": policies.service_names(session, venue),
        "policies": policies.read_policies(session, venue),
    }


@router.get("/owner/restaurants/{vid}/payments")
def get_payments(vid: str, session: db.SessionDep, user: CurrentOrganiser) -> dict[str, Any]:
    return _view(session, profiles.load(session, vid, user))


@router.put("/owner/restaurants/{vid}/payments")
def save_payments(
    vid: str, body: PoliciesIn, session: db.SessionDep, user: CurrentOrganiser
) -> dict[str, Any]:
    venue = profiles.load(session, vid, user)
    policies.replace_policies(session, venue, [item.model_dump() for item in body.policies])
    session.commit()
    return _view(session, venue)
