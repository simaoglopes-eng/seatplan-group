"""A venue's team (/owner/venues/{vid}/members): the owner adds and removes staff by email.

Only the venue's owner (an organiser account that owns this restaurant or
event venue) may read or change the list; anyone else gets 404, the same as a
venue that does not exist. The answers never say whether an account exists
for an address. Logic in core/members.py.
"""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app import db
from app.core import members
from app.core.errors import ApiError
from app.security import CurrentOrganiser

router = APIRouter(prefix="/owner/venues", tags=["members"])


class MemberIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr = Field(max_length=254)


@router.get("/{vid}/members")
def list_members(vid: str, user: CurrentOrganiser, session: db.SessionDep) -> dict[str, Any]:
    venue = members.load_owned_venue(session, vid, user)
    return {"items": [members.member_out(row) for row in members.listing(session, venue)]}


@router.post("/{vid}/members", status_code=201)
def add_member(
    vid: str, body: MemberIn, user: CurrentOrganiser, session: db.SessionDep
) -> dict[str, Any]:
    venue = members.load_owned_venue(session, vid, user)
    return members.member_out(members.add(session, venue, user, str(body.email)))


@router.delete("/{vid}/members/{member_id}")
def remove_member(
    vid: str, member_id: int, user: CurrentOrganiser, session: db.SessionDep
) -> dict[str, bool]:
    """By the member's id (from the list), so no address travels in the URL."""
    venue = members.load_owned_venue(session, vid, user)
    if not members.remove(session, venue, user, member_id):
        raise ApiError(404, "not_found", "Team member not found.")
    return {"removed": True}
