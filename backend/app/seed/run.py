"""Create the tables and the demo data: python -m app.seed.run

Run it from the backend/ folder. It creates a demo organiser and a demo staff
user, then asks both verticals to seed their own demo data, and prints the
links to open.

Demo passwords come from DEMO_ORGANISER_PASSWORD, DEMO_STAFF_PASSWORD and
DEMO_MEMBER_PASSWORD (Rita Rossi, the "one account" demo, seed/demo_member.py). Only
on a local SQLite database with DEMO_MODE=1 do we fall back to the documented
defaults below. Any Postgres database is a deployment that others can reach, so
there the variables are required, demo mode or not.
"""

import logging
import os
import secrets

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import db
from app.config import Settings, get_settings
from app.core import audit
from app.models import DemoLink, Organiser
from app.security import hash_password
from app.seed import (
    demo_event_venues,
    demo_events,
    demo_member,
    demo_restaurant,
    demo_showcase,
    venue_directory,
)

DEMO_ORGANISER_EMAIL = "organiser@example.com"
DEMO_STAFF_EMAIL = "staff@example.com"
DEMO_MEMBER_EMAIL = demo_member.DEMO_MEMBER_EMAIL
# Public on purpose: these only work locally (see demo_password below).
DEFAULT_DEMO_PASSWORDS = {
    "DEMO_ORGANISER_PASSWORD": "demo-organiser-2026",
    "DEMO_STAFF_PASSWORD": "demo-staff-2026",
    "DEMO_MEMBER_PASSWORD": "demo-member-2026",
}


logger = logging.getLogger("seatplan.seed")


def demo_password(env_name: str, settings: Settings) -> str:
    value = os.environ.get(env_name, "")
    if value:
        return value
    if settings.demo_mode and not settings.is_postgres:
        return DEFAULT_DEMO_PASSWORDS[env_name]
    raise RuntimeError(f"{env_name} must be set on Postgres or when DEMO_MODE is off.")


def member_password(settings: Settings) -> str:
    """Rita's password: like demo_password, but never stops the seed.

    The member demo came after the other two, so a deployment may not have
    DEMO_MEMBER_PASSWORD yet; a demo reset must not fail with a 500 for it.
    Then she gets a random password that is never shown or stored anywhere
    readable (nobody can sign in as her until the variable is set), and the
    log says so without the password.
    """
    if os.environ.get("DEMO_MEMBER_PASSWORD", "") or (
        settings.demo_mode and not settings.is_postgres
    ):
        return demo_password("DEMO_MEMBER_PASSWORD", settings)
    logger.warning(
        "DEMO_MEMBER_PASSWORD is not set: the demo member got a random password. "
        "Set the variable and reset the demo to sign in as her."
    )
    return secrets.token_urlsafe(24)


def _ensure_user(session: Session, email: str, name: str, role: str, password: str) -> None:
    """Create the user, or reset their password and role if they exist."""
    user = session.scalars(select(Organiser).where(Organiser.email == email)).first()
    if user is None:
        user = Organiser(email=email)
        session.add(user)
    user.name = name
    user.role = role
    user.password_hash = hash_password(password)


def ensure_demo_users(session: Session, settings: Settings, member_pw: str | None = None) -> None:
    """Make sure the demo organiser, staff and member work accounts exist. Does not commit.

    `member_pw` is the member's password when the caller already chose it
    (seed_all gives the same one to her guest account).
    """
    _ensure_user(
        session,
        DEMO_ORGANISER_EMAIL,
        "Olivia Organiser",
        "organiser",
        demo_password("DEMO_ORGANISER_PASSWORD", settings),
    )
    _ensure_user(
        session,
        DEMO_STAFF_EMAIL,
        "Sam Staff",
        "staff",
        demo_password("DEMO_STAFF_PASSWORD", settings),
    )
    _ensure_user(
        session,
        DEMO_MEMBER_EMAIL,
        demo_member.DEMO_MEMBER_NAME,
        "organiser",
        member_pw if member_pw is not None else member_password(settings),
    )
    session.flush()


def seed_all(session: Session, settings: Settings, actor: str) -> dict[str, str]:
    """Demo users plus both verticals. Commits, and returns the entry links.

    The links are saved in demo_links for GET /demo/links. The audit row only
    counts them: a link holds a raw token, and tokens never go into the audit
    log (core/audit.py).
    """
    # Chosen once: her work account and her guest account share one password.
    rita_password = member_password(settings)
    ensure_demo_users(session, settings, rita_password)
    links = {
        **demo_events.seed(session),
        **demo_restaurant.seed(session),
        **demo_showcase.seed(session),
        **demo_event_venues.seed(session),
    }
    demo_member.seed(session, rita_password)
    # Real venues (OpenStreetMap snapshot), not demo data: loaded with the seed so a fresh database has them.
    venue_directory.load(session)
    session.execute(delete(DemoLink))
    session.add_all(DemoLink(name=name, path=path) for name, path in links.items())
    audit.record(
        session,
        actor=actor,
        action="demo.seed",
        entity="demo",
        entity_id="all",
        detail={"count": len(links)},
    )
    session.commit()
    return links


def main() -> None:
    settings = get_settings()
    db.init_engine(settings.database_url)
    db.create_all()
    with db.new_session() as session:
        links = seed_all(session, settings, actor="seed-command")
    print("Demo data ready.")
    for name, link in sorted(links.items()):
        print(f"  {name}: {link}")


if __name__ == "__main__":
    main()
