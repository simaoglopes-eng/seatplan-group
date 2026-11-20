"""Public restaurant ratings and account-owned reviews."""

from typing import Any, Literal, TypedDict

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app import db
from app.models import Booking, GuestAccount, RestaurantReview

TableType = Literal["general", "window", "terrace", "quiet", "bar", "group", "accessible"]
ReviewSort = Literal["recent", "highest", "lowest"]


class Summary(TypedDict):
    average: float | None
    count: int


def empty_summary() -> Summary:
    return {"average": None, "count": 0}


def summaries(session: Session, venue_ids: list[int]) -> dict[int, Summary]:
    if not venue_ids:
        return {}
    rows = session.execute(
        select(RestaurantReview.venue_id, func.avg(RestaurantReview.score), func.count())
        .where(RestaurantReview.venue_id.in_(venue_ids))
        .group_by(RestaurantReview.venue_id)
    )
    return {
        venue_id: {"average": round(float(mean), 1), "count": count}
        for venue_id, mean, count in rows
    }


def payload(review: RestaurantReview, account: GuestAccount) -> dict[str, Any]:
    words = account.name.split()
    return {
        "id": review.public_id,
        "author": words[0] if words else "SeatPlan guest",
        "score": review.score,
        "comment": review.comment,
        "table_type": review.table_type,
        "verified": review.verified,
        "created_at": review.created_at.isoformat(),
    }


def list_reviews(
    session: Session,
    venue_id: int,
    *,
    sort: ReviewSort,
    score: int | None,
    table_type: TableType | None,
    verified: bool,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    filters = [RestaurantReview.venue_id == venue_id]
    if score is not None:
        filters.append(RestaurantReview.score == score)
    if table_type is not None:
        filters.append(RestaurantReview.table_type == table_type)
    if verified:
        filters.append(RestaurantReview.verified.is_(True))
    newest = (RestaurantReview.created_at.desc(), RestaurantReview.account_id.desc())
    ordering = {
        "recent": newest,
        "highest": (RestaurantReview.score.desc(), *newest),
        "lowest": (RestaurantReview.score.asc(), *newest),
    }
    rows = session.execute(
        select(RestaurantReview, GuestAccount)
        .join(GuestAccount, GuestAccount.id == RestaurantReview.account_id)
        .where(*filters)
        .order_by(*ordering[sort])
        .offset(offset)
        .limit(limit)
    )
    total = session.scalar(select(func.count()).select_from(RestaurantReview).where(*filters))
    return {
        "items": [payload(review, account) for review, account in rows],
        "total": total,
        "summary": summaries(session, [venue_id]).get(venue_id, empty_summary()),
    }


def save(
    session: Session,
    venue_id: int,
    account: GuestAccount,
    *,
    score: int,
    comment: str,
    table_type: TableType | None,
) -> RestaurantReview:
    # A verified mailbox can claim a completed diner reservation using that address.
    attended = (
        account.email_proven
        and session.scalar(
            select(Booking.id)
            .where(
                Booking.venue_id == venue_id,
                func.lower(Booking.email) == account.email,
                Booking.status == "completed",
                Booking.source == "diner",
            )
            .limit(1)
        )
        is not None
    )
    values = {
        "score": score,
        "comment": comment.strip(),
        "table_type": table_type,
        "verified": attended,
    }
    # The composite key serialises simultaneous first writes across both supported databases.
    db.insert_ignoring_duplicates(
        session,
        RestaurantReview.__table__,
        {"venue_id": venue_id, "account_id": account.id, **values},
    )
    statement = (
        update(RestaurantReview)
        .where(RestaurantReview.venue_id == venue_id, RestaurantReview.account_id == account.id)
        .values(**values)
        .returning(RestaurantReview)
    )
    return session.scalars(statement).one()


def remove(session: Session, venue_id: int, account_id: int) -> None:
    session.execute(
        delete(RestaurantReview).where(
            RestaurantReview.venue_id == venue_id, RestaurantReview.account_id == account_id
        )
    )
