"""Age on the event date and explicit participant visibility."""

from datetime import date

from app.models import Event, Guest


def age_at(born: date | None, on: date) -> int | None:
    if born is None or born > on:
        return None
    return on.year - born.year - ((on.month, on.day) < (born.month, born.day))


def visible_age(guest: Guest, event: Event) -> int | None:
    if not guest.share_age or guest.wants_anonymous or event.privacy_mode == "anonymous":
        return None
    return age_at(guest.birth_date, event.starts_at.date())
