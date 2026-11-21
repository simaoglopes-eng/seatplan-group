"""Public search and restaurant page: GET /restaurants and /restaurants/{slug}.

Anyone can call these, so they share the diner read limit. A draft is visible
only to the organiser who owns it, and then it carries `preview: true`.
"""

# The module, not its classes: query fields are called "date" and "time".
import datetime as dt
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request
from pydantic import Field

from app import db
from app.core.errors import ApiError
from app.core.text import PlainText
from app.models import Organiser, RestaurantReview, Venue
from app.restaurant_service import discovery, reviews
from app.restaurant_service.availability import MAX_ONLINE_PARTY
from app.restaurant_service.profiles import CUISINES
from app.routers.restaurants import READ_LIMIT, Strict
from app.security import CurrentGuestAccount, _bearer, client_ip, rate_limit, session_user

router = APIRouter(tags=["discovery"])


class ReviewIn(Strict):
    score: int = Field(ge=0, le=10, strict=True)
    comment: PlainText = Field(default="", max_length=1500)
    table_type: reviews.TableType | None = None


def _read_limit(session: db.SessionDep, request: Request) -> None:
    # The same budget as the booking page, so one address cannot out-read it.
    rate_limit(session, f"r-read:{client_ip(request)}", limit=READ_LIMIT, window_s=60)


def _invalid(message: str) -> ApiError:
    return ApiError(422, "validation", message)


@router.get("/restaurants")
def search(
    request: Request,
    session: db.SessionDep,
    q: Annotated[str, Query(max_length=80)] = "",
    cuisine: Annotated[list[str] | None, Query(max_length=len(CUISINES))] = None,
    price: Annotated[list[int] | None, Query(max_length=4)] = None,
    features: Annotated[list[str] | None, Query(max_length=len(discovery.FEATURES))] = None,
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lng: Annotated[float | None, Query(ge=-180, le=180)] = None,
    date: dt.date | None = None,
    time: dt.time | None = None,
    party: Annotated[int | None, Query(ge=1, le=MAX_ONLINE_PARTY)] = None,
    available: bool = False,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> dict[str, Any]:
    _read_limit(session, request)
    if (lat is None) != (lng is None):
        raise _invalid("Send both lat and lng, or neither.")
    if len({date is None, time is None, party is None}) != 1:
        raise _invalid("Send date, time and party together, or none of them.")
    if any(name not in CUISINES for name in cuisine or []):
        raise _invalid("Unknown cuisine.")
    if any(not 1 <= level <= 4 for level in price or []):
        raise _invalid("Price is 1 to 4.")
    if any(name not in discovery.FEATURES for name in features or []):
        raise _invalid("Unknown feature.")
    return discovery.search_restaurants(
        session,
        discovery.Search(
            q=q,
            cuisines=tuple(cuisine or ()),
            prices=tuple(price or ()),
            features=tuple(features or ()),
            lat=lat,
            lng=lng,
            day=date,
            at=time,
            party=party,
            available=available,
            limit=limit,
            offset=offset,
        ),
    )


def _optional_user(session: db.SessionDep, authorization: str | None) -> Organiser | None:
    """Who is asking, if they are signed in. A bad token is just an anonymous visitor."""
    token = _bearer(authorization)
    return session_user(session, token) if token else None


@router.get("/restaurants/{slug}")
def restaurant_page(
    slug: str,
    request: Request,
    session: db.SessionDep,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    _read_limit(session, request)
    venue = discovery.find_by_slug(session, slug)
    preview = False
    if venue is not None and venue.status != "published":
        user = _optional_user(session, authorization)
        if user is None or user.role != "organiser" or venue.organiser_id != user.id:
            venue = None
        else:
            preview = True
    if venue is None:
        raise ApiError(404, "not_found", "Restaurant not found.")
    return discovery.public_page(session, venue, preview=preview)


def _review_venue(session: db.SessionDep, slug: str) -> Venue:
    venue = discovery.find_by_slug(session, slug)
    if venue is None or venue.status != "published":
        raise ApiError(404, "not_found", "Restaurant not found.")
    return venue


@router.get("/restaurants/{slug}/reviews")
def restaurant_reviews(
    slug: str,
    request: Request,
    session: db.SessionDep,
    sort: reviews.ReviewSort = "recent",
    score: Annotated[int | None, Query(ge=0, le=10)] = None,
    table_type: reviews.TableType | None = None,
    verified: bool = False,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, Any]:
    _read_limit(session, request)
    venue = _review_venue(session, slug)
    return reviews.list_reviews(
        session,
        venue.id,
        sort=sort,
        score=score,
        table_type=table_type,
        verified=verified,
        limit=limit,
        offset=offset,
    )


@router.get("/restaurants/{slug}/reviews/mine")
def my_review(
    slug: str, request: Request, session: db.SessionDep, account: CurrentGuestAccount
) -> dict[str, Any]:
    _read_limit(session, request)
    venue = _review_venue(session, slug)
    review = session.get(RestaurantReview, (venue.id, account.id))
    return {"review": reviews.payload(review, account) if review else None}


@router.put("/restaurants/{slug}/reviews/mine")
def save_review(
    slug: str, body: ReviewIn, session: db.SessionDep, account: CurrentGuestAccount
) -> dict[str, Any]:
    rate_limit(session, f"review-write:{account.id}", 10, 60)
    venue = _review_venue(session, slug)
    review = reviews.save(
        session,
        venue.id,
        account,
        score=body.score,
        comment=body.comment,
        table_type=body.table_type,
    )
    answer = reviews.payload(review, account)
    session.commit()
    return {"review": answer}


@router.delete("/restaurants/{slug}/reviews/mine")
def delete_review(
    slug: str, session: db.SessionDep, account: CurrentGuestAccount
) -> dict[str, bool]:
    rate_limit(session, f"review-write:{account.id}", 10, 60)
    venue = _review_venue(session, slug)
    reviews.remove(session, venue.id, account.id)
    session.commit()
    return {"deleted": True}
