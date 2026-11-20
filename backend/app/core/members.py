"""Venue members: people an owner lets work at one venue, matched by email.

An owner adds an address to a venue (restaurant or event venue). Whoever
signs in to a work account with that address may then run that venue the way
staff do: the floor of a restaurant, the events of an event venue. Owner-only
pages (profile, photos, publishing, the member list, the floor plan editor)
stay with the owner.

The address is the key, not an account id, so an owner can add someone before
they have an account, and the answer never tells the owner whether an account
exists for that address.
"""

from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import ApiError
from app.models import Organiser, Venue, VenueMember

# One venue rarely has more people; the cap stops a runaway script.
MAX_MEMBERS_PER_VENUE = 50


def normalise(email: str) -> str:
    return email.strip().lower()


def is_member(session: Session, venue_id: int, email: str) -> bool:
    """True when the address is on the venue's team. An event's own setup copy
    (core/parent_venue.py) has no team of its own: its parent's team counts."""
    parent = select(Venue.parent_venue_id).where(Venue.id == venue_id).scalar_subquery()
    found = session.scalar(
        select(VenueMember.id).where(
            VenueMember.venue_id == func.coalesce(parent, venue_id),
            VenueMember.email == normalise(email),
        )
    )
    return found is not None


def member_venue_ids(session: Session, email: str) -> list[int]:
    """Every venue this address works at as a member, oldest membership first."""
    return list(
        session.scalars(
            select(VenueMember.venue_id)
            .where(VenueMember.email == normalise(email))
            .order_by(VenueMember.id)
        )
    )


def is_member_anywhere(session: Session, email: str) -> bool:
    found = session.scalar(select(VenueMember.id).where(VenueMember.email == normalise(email)))
    return found is not None


# ---------------------------------------------------------------- the owner's list


def load_owned_venue(session: Session, public_id: str, owner: Organiser) -> Venue:
    """The owner's restaurant or event venue, else 404 (missing and forbidden look alike)."""
    venue = session.scalars(
        select(Venue).where(
            Venue.public_id == public_id,
            Venue.organiser_id == owner.id,
            # An event's setup copy has no team of its own (the parent's counts).
            Venue.parent_venue_id.is_(None),
        )
    ).first()
    if venue is None or venue.kind not in ("restaurant", "event"):
        raise ApiError(404, "not_found", "Venue not found.")
    return venue


def member_out(member: VenueMember) -> dict[str, Any]:
    return {
        "id": member.id,
        "email": member.email,
        "role": member.role,
        "created_at": member.created_at,
    }


def listing(session: Session, venue: Venue) -> list[VenueMember]:
    return list(
        session.scalars(
            select(VenueMember).where(VenueMember.venue_id == venue.id).order_by(VenueMember.id)
        )
    )


def add(session: Session, venue: Venue, owner: Organiser, email: str) -> VenueMember:
    """Add the address as staff, or return the row it already has. Commits.

    The answer is the same whether or not an account exists for the address.
    """
    email = normalise(email)
    if email == normalise(owner.email):
        raise ApiError(422, "validation", "email: You already run this venue as its owner.")
    existing = session.scalars(
        select(VenueMember).where(VenueMember.venue_id == venue.id, VenueMember.email == email)
    ).first()
    if existing is not None:
        return existing
    count = session.scalar(
        select(func.count()).select_from(VenueMember).where(VenueMember.venue_id == venue.id)
    )
    if (count or 0) >= MAX_MEMBERS_PER_VENUE:
        raise ApiError(
            422, "validation", f"A venue can have at most {MAX_MEMBERS_PER_VENUE} team members."
        )
    member = VenueMember(venue_id=venue.id, email=email, role="staff", added_by=owner.id)
    session.add(member)
    try:
        session.flush()
    except IntegrityError:
        # The same address added twice at the same moment: the UNIQUE index
        # lets one row in, and this request answers with that row.
        session.rollback()
        found = session.scalars(
            select(VenueMember).where(VenueMember.venue_id == venue.id, VenueMember.email == email)
        ).first()
        if found is None:
            raise ApiError(409, "conflict", "Please try again.") from None
        return found
    audit.record(
        session,
        actor=owner.email,
        action="venue.member_add",
        entity="venue",
        entity_id=venue.public_id,
        detail={"member_id": member.id},
    )
    session.commit()
    return member


def remove(session: Session, venue: Venue, owner: Organiser, member_id: int) -> bool:
    """Remove one member of this venue. True when a row went. Commits."""
    removed = session.execute(
        delete(VenueMember).where(VenueMember.id == member_id, VenueMember.venue_id == venue.id)
    ).rowcount
    if removed:
        audit.record(
            session,
            actor=owner.email,
            action="venue.member_remove",
            entity="venue",
            entity_id=venue.public_id,
            detail={"member_id": member_id},
        )
    session.commit()
    return bool(removed)
