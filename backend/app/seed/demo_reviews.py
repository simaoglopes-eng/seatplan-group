"""Add clearly labelled sample reviews to a local SeatPlan demo."""

from datetime import timedelta
from random import Random

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import db
from app.config import get_settings
from app.models import GuestAccount, RestaurantReview, Venue, utc_now

NAMES = (
    "Inês",
    "Rui",
    "Leonor",
    "Tiago",
    "Marta",
    "Nuno",
    "Sofia",
    "Afonso",
    "Clara",
    "André",
    "Beatriz",
    "Miguel",
    "Carolina",
    "João",
    "Diana",
    "Tomás",
    "Vera",
    "Francisco",
)
COMMENTS = {
    "general": {
        2: (
            "Our table felt cramped once the plates arrived.",
            "The dining room was too lively for our plans.",
        ),
        3: (
            "The table was fine for a quick meal.",
            "A comfortable seat, though a quieter spot would be better.",
        ),
        4: (
            "Good spacing between tables and easy conversation.",
            "The room worked well for an unhurried dinner.",
        ),
        5: (
            "We could talk easily and had plenty of room at the table.",
            "The table was a great fit for our evening.",
        ),
    },
    "terrace": {
        2: (
            "The terrace felt exposed when the wind picked up.",
            "We would choose an inside table next time.",
        ),
        3: ("The terrace worked for lunch, though we would have preferred more shade.",),
        4: (
            "The terrace was a nice spot for an early dinner.",
            "We liked the open-air table and the room around it.",
        ),
        5: (
            "An outdoor table made the evening for us.",
            "The terrace was exactly what we wanted for a long lunch.",
        ),
    },
    "window": {
        2: ("The window spot looked better suited to a quieter time.",),
        3: ("The window made the table bright, with less privacy than we expected.",),
        4: ("We enjoyed the light from the window and the space to share plates.",),
        5: (
            "The window table had lovely light throughout lunch.",
            "We would ask for this window spot again.",
        ),
    },
    "accessible": {
        2: ("We wanted more space around the table.",),
        3: ("We could use the table, although the approach felt tight.",),
        4: ("There was space to get to the table without asking people to move.",),
        5: ("The clear space around our table made the visit easy.",),
    },
}
DETAILS = (
    "We booked for two.",
    "We stayed for a long lunch.",
    "We shared a few dishes.",
    "We visited early in the evening.",
    "This was our first visit.",
    "",
)


def seed(session: Session) -> tuple[int, int]:
    venues = session.scalars(
        select(Venue)
        .where(Venue.kind == "restaurant", Venue.is_demo.is_(True), Venue.status == "published")
        .order_by(Venue.id)
    ).all()
    if not venues:
        return 0, 0

    now = utc_now()
    accounts = []
    for index, name in enumerate(NAMES, 1):
        email = f"review-{index}@demo.seatplan.invalid"
        db.insert_ignoring_duplicates(
            session,
            GuestAccount.__table__,
            {
                "email": email,
                "name": name,
                "password_hash": "disabled",
                "email_proven": False,
                "consent_at": now,
                "consent_version": "demo",
            },
        )
        accounts.append(
            session.scalars(select(GuestAccount).where(GuestAccount.email == email)).one()
        )

    venue_ids = [venue.id for venue in venues]
    existing = set(
        session.execute(
            select(RestaurantReview.venue_id, RestaurantReview.account_id).where(
                RestaurantReview.venue_id.in_(venue_ids)
            )
        ).tuples()
    )
    added = 0
    for venue in venues:
        random = Random(venue.public_id)
        features = venue.features or {}
        table_types = ["general"] * 3
        table_types.extend(
            kind
            for kind, feature in (
                ("terrace", "terrace"),
                ("window", "view"),
                ("accessible", "accessible"),
            )
            if features.get(feature)
        )
        contributors = random.sample(accounts, random.randint(10, 17))
        for index, account in enumerate(contributors, 1):
            score = random.choices((2, 3, 4, 5), weights=(1, 2, 5, 5))[0]
            table_type = random.choice(table_types)
            pieces = (random.choice(COMMENTS[table_type][score]), random.choice(DETAILS))
            comment = "Demo review — " + " ".join(piece for piece in pieces if piece)
            created_at = now - timedelta(days=2 * index + random.randint(0, 6))
            if (venue.id, account.id) not in existing:
                db.insert_ignoring_duplicates(
                    session,
                    RestaurantReview.__table__,
                    {
                        "venue_id": venue.id,
                        "account_id": account.id,
                        "score": score * 2,
                        "comment": comment,
                        "table_type": table_type,
                        "verified": False,
                        "created_at": created_at,
                    },
                )
                added += 1
    return len(venues), added


def main() -> None:
    settings = get_settings()
    if not settings.demo_mode or not settings.database_url.startswith("sqlite:"):
        raise SystemExit("Use DEMO_MODE=1 with a local SQLite demo database.")
    db.init_engine(settings.database_url)
    db.create_all()
    with db.new_session() as session:
        venues, reviews = seed(session)
        session.commit()
    print(f"Demo reviews: {reviews} added across {venues} published demo restaurants.")


if __name__ == "__main__":
    main()
