"""Check that a webhook really comes from Stripe. Pure: no network, no database.

Stripe signs each webhook with a secret only it and we know. The header looks
like `t=1700000000,v1=<hex>,v1=<hex>`; the signature is HMAC-SHA256 over the
text `<t>.<raw body>`. Two details keep it safe:
- the comparison takes the same time however many characters match;
- a message whose timestamp is too old (or from the future) is refused, so a
  captured webhook cannot be replayed later.
Nothing else about the message is trusted: callers read the payment back from
Stripe instead of believing the amounts in the body.
"""

import hashlib
import hmac
from collections.abc import Sequence

DEFAULT_TOLERANCE_S = 300


def verify(
    header: str,
    payload: bytes,
    secrets: Sequence[str],
    now: int,
    tolerance: int = DEFAULT_TOLERANCE_S,
) -> bool:
    """True when the header carries a valid signature from one of `secrets`."""
    timestamp: int | None = None
    signatures: list[str] = []
    for part in header.split(","):
        key, _, value = part.strip().partition("=")
        if key == "t":
            try:
                timestamp = int(value)
            except ValueError:
                return False
        elif key == "v1" and value:
            signatures.append(value)
    if timestamp is None or not signatures:
        return False
    if abs(now - timestamp) > tolerance:
        return False
    signed = f"{timestamp}.".encode() + payload
    for secret in secrets:
        if not secret:
            continue  # an empty secret must never validate anything
        expected = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
        if any(hmac.compare_digest(expected, given) for given in signatures):
            return True
    return False
