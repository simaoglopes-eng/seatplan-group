"""Deposit money rules and the Stripe webhook signature check (no database, no network)."""

import hashlib
import hmac
from datetime import UTC, datetime, timedelta

import pytest

from app.payments import money, stripe_signature

START = datetime(2026, 11, 20, 19, 30, tzinfo=UTC)


@pytest.mark.parametrize(
    ("cents", "text"),
    [(0, "€0"), (1, "€0.01"), (12, "€0.12"), (50, "€0.50"), (2000, "€20"), (1250, "€12.50")],
)
def test_format_eur(cents: int, text: str) -> None:
    assert money.format_eur(cents) == text


def test_deposit_total_is_whole_cents() -> None:
    assert money.deposit_total(1250, 3) == 3750


def test_cancel_deadline_counts_back_from_the_start() -> None:
    assert money.cancel_deadline(START, 24) == START - timedelta(hours=24)


def test_refund_is_full_until_the_deadline_and_nothing_after() -> None:
    deadline = money.cancel_deadline(START, 24)
    assert money.refund_due(4000, deadline - timedelta(minutes=1), deadline, False) == 4000
    assert money.refund_due(4000, deadline, deadline, False) == 4000
    assert money.refund_due(4000, deadline + timedelta(seconds=1), deadline, False) == 0


def test_the_restaurant_cancelling_always_refunds_in_full() -> None:
    deadline = money.cancel_deadline(START, 24)
    late = deadline + timedelta(hours=20)
    assert money.refund_due(4000, late, deadline, True) == 4000


@pytest.mark.parametrize(
    ("cents", "hours", "party", "problem"),
    [
        (2000, 24, 1, False),
        (1, 2, 1, False),
        (0, 24, 1, True),
        (money.MAX_PER_PERSON_CENTS + 1, 24, 1, True),
        (2000, 5, 1, True),
        (2000, 24, 0, True),
        (2000, 24, money.MAX_MIN_PARTY + 1, True),
    ],
)
def test_policy_bounds(cents: int, hours: int, party: int, problem: bool) -> None:
    assert (money.policy_problem(cents, hours, party) is not None) is problem


def test_real_stripe_needs_at_least_fifty_cents() -> None:
    assert money.policy_problem(49, 24, 1, minimum_cents=money.STRIPE_MIN_CHARGE_CENTS)
    assert money.policy_problem(50, 24, 1, minimum_cents=money.STRIPE_MIN_CHARGE_CENTS) is None


def test_policy_sentence_names_the_amount_the_party_and_the_deadline() -> None:
    text, accept = money.policy_sentence(2000, 2, "Fri 20 Nov, 19:30")
    assert "€20 per person" in text
    assert "€40 for your party of 2" in text
    assert "Fri 20 Nov, 19:30" in text
    assert "keeps the deposit" in text
    assert "agree" in accept


def test_policy_sentence_for_one_person_has_no_per_person_part() -> None:
    text, _ = money.policy_sentence(2000, 1, "Fri 20 Nov, 19:30")
    assert "per person" not in text
    assert "€20" in text


# ------------------------------------------------------------- webhook signature

SECRET = "whsec_test_secret"
BODY = b'{"id":"evt_1","type":"checkout.session.completed"}'
NOW = 1_700_000_000


def _header(secret: str, body: bytes, timestamp: int) -> str:
    digest = hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def test_a_correct_signature_is_accepted() -> None:
    assert stripe_signature.verify(_header(SECRET, BODY, NOW), BODY, [SECRET], NOW)


def test_a_changed_body_is_refused() -> None:
    header = _header(SECRET, BODY, NOW)
    assert not stripe_signature.verify(header, BODY + b" ", [SECRET], NOW)


def test_a_wrong_secret_is_refused() -> None:
    assert not stripe_signature.verify(_header("other", BODY, NOW), BODY, [SECRET], NOW)


def test_either_of_two_secrets_may_match() -> None:
    header = _header("second", BODY, NOW)
    assert stripe_signature.verify(header, BODY, ["first", "second"], NOW)


def test_an_old_message_cannot_be_replayed() -> None:
    header = _header(SECRET, BODY, NOW - 301)
    assert not stripe_signature.verify(header, BODY, [SECRET], NOW)
    assert stripe_signature.verify(_header(SECRET, BODY, NOW - 300), BODY, [SECRET], NOW)


def test_a_message_from_the_future_is_refused() -> None:
    assert not stripe_signature.verify(_header(SECRET, BODY, NOW + 301), BODY, [SECRET], NOW)


@pytest.mark.parametrize("header", ["", "garbage", "t=abc,v1=00", "v1=00", "t=1700000000"])
def test_malformed_headers_are_refused(header: str) -> None:
    assert not stripe_signature.verify(header, BODY, [SECRET], NOW)


def test_an_empty_secret_never_validates_anything() -> None:
    header = _header("", BODY, NOW)
    assert not stripe_signature.verify(header, BODY, [""], NOW)
    assert not stripe_signature.verify(header, BODY, [], NOW)


def test_a_header_with_several_signatures_accepts_any_valid_one() -> None:
    good = _header(SECRET, BODY, NOW)
    header = f"{good},v1=deadbeef"
    assert stripe_signature.verify(header, BODY, [SECRET], NOW)
