"""The money rules of a deposit. Pure functions: no database, no clock of their own.

Every amount is a whole number of cents, in euros. Floats never touch money, so
"€12.50" is 1250 here and everywhere else.
"""

from datetime import datetime, timedelta

# How long before the booking the diner may still cancel for free.
CANCEL_HOURS = (2, 6, 12, 24, 48, 72)
# The most one person can be asked to put down. A deposit is a pledge, not a price.
MAX_PER_PERSON_CENTS = 15_000
MAX_MIN_PARTY = 20
# Stripe refuses charges under 50 cents in euros. The demo provider has no such
# limit, so an owner can test the whole flow with one cent.
STRIPE_MIN_CHARGE_CENTS = 50


def format_eur(cents: int) -> str:
    """12 -> "€0.12", 1250 -> "€12.50", 2000 -> "€20"."""
    euros, rest = divmod(abs(cents), 100)
    sign = "-" if cents < 0 else ""
    return f"{sign}€{euros}" if rest == 0 else f"{sign}€{euros}.{rest:02d}"


def deposit_total(per_person_cents: int, party: int) -> int:
    return per_person_cents * party


def cancel_deadline(start_at: datetime, hours: int) -> datetime:
    """The last moment a cancellation is free."""
    return start_at - timedelta(hours=hours)


def refund_due(paid_cents: int, now: datetime, deadline: datetime, by_restaurant: bool) -> int:
    """How much goes back to the diner when the booking is cancelled.

    Everything while the cancellation is free, and also whenever the restaurant
    is the one cancelling (a diner never loses a deposit for the restaurant's
    decision). After the deadline the restaurant keeps it.
    """
    if by_restaurant or now <= deadline:
        return paid_cents
    return 0


def policy_problem(
    per_person_cents: int, cancel_hours: int, min_party: int, minimum_cents: int = 1
) -> str | None:
    """Why these terms are not allowed, or None when they are."""
    if per_person_cents < minimum_cents:
        return f"The deposit must be at least {format_eur(minimum_cents)} per person."
    if per_person_cents > MAX_PER_PERSON_CENTS:
        return f"The deposit can be at most {format_eur(MAX_PER_PERSON_CENTS)} per person."
    if cancel_hours not in CANCEL_HOURS:
        return "Choose one of the free-cancellation windows offered."
    if not 1 <= min_party <= MAX_MIN_PARTY:
        return f"The smallest party must be between 1 and {MAX_MIN_PARTY}."
    return None


def policy_sentence(per_person_cents: int, party: int, deadline_text: str) -> tuple[str, str]:
    """(what the diner reads, what the tick box says). English, plain words."""
    each = format_eur(per_person_cents)
    total = format_eur(deposit_total(per_person_cents, party))
    if party == 1:
        pay = f"A deposit of {total} is paid now and comes off your bill."
    else:
        pay = (
            f"A deposit of {each} per person ({total} for your party of {party}) "
            "is paid now and comes off your bill."
        )
    text = (
        f"{pay} You can cancel for free until {deadline_text}. "
        "After that, the restaurant keeps the deposit."
    )
    return text, "I agree to pay the deposit and to the cancellation rule."
