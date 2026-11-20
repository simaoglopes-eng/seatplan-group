"""Owner-managed menu with exact euro prices and optimistic write protection."""

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import update

from app import db
from app.core.errors import ApiError
from app.core.text import PlainText
from app.models import RestaurantMenu
from app.restaurant_service import discovery, profiles
from app.security import CurrentOrganiser, client_ip, rate_limit

router = APIRouter(tags=["restaurant menus"])


class MenuItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: PlainText = Field(min_length=1, max_length=120)
    category: PlainText = Field(default="Menu", min_length=1, max_length=60)
    description: PlainText = Field(default="", max_length=500)
    price_cents: int = Field(ge=0, le=1_000_000, strict=True)
    allergens: PlainText = Field(default="", max_length=500)
    available: bool = True


class MenuIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=0, strict=True)
    items: list[MenuItem] = Field(max_length=100)


@router.get("/owner/restaurants/{vid}/menu")
def owner_menu(vid: str, session: db.SessionDep, user: CurrentOrganiser) -> dict[str, Any]:
    venue = profiles.load(session, vid, user)
    menu = session.get(RestaurantMenu, venue.id)
    return {"version": menu.version if menu else 0, "items": menu.items if menu else []}


@router.put("/owner/restaurants/{vid}/menu")
def save_menu(
    vid: str, body: MenuIn, session: db.SessionDep, user: CurrentOrganiser
) -> dict[str, Any]:
    venue = profiles.load(session, vid, user)
    db.insert_ignoring_duplicates(
        session, RestaurantMenu, {"venue_id": venue.id, "version": 0, "items": []}
    )
    items = [item.model_dump() for item in body.items]
    changed = session.scalar(
        update(RestaurantMenu)
        .where(RestaurantMenu.venue_id == venue.id, RestaurantMenu.version == body.version)
        .values(version=RestaurantMenu.version + 1, items=items)
        .returning(RestaurantMenu.version)
    )
    if changed is None:
        raise ApiError(
            409, "conflict", "This menu was edited in another window. Reload before saving again."
        )
    session.commit()
    return {"version": changed, "items": items}


@router.get("/restaurants/{slug}/menu")
def public_menu(slug: str, request: Request, session: db.SessionDep) -> dict[str, Any]:
    rate_limit(session, f"menu-read:{client_ip(request)}", limit=120, window_s=60)
    venue = discovery.find_by_slug(session, slug)
    if venue is None or venue.status != "published":
        raise ApiError(404, "not_found", "Restaurant not found.")
    menu = session.get(RestaurantMenu, venue.id)
    return {
        "currency": "EUR",
        "items": [item for item in menu.items if item.get("available", True)] if menu else [],
    }
