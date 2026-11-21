"""Free text typed by people (names, notes, labels), safe to store.

Postgres refuses a NUL character (0x00) in a text column. Without this check
a name like "a\\x00b" passes Pydantic, reaches the database and comes back as
a 500 error. Other invisible control characters have no place in a name or a
note either, so we refuse every one of them except tab and line breaks, and
the request gets a normal 422 "validation" answer.

One type for the whole backend (events, restaurants, venues), so the rule
is written once. Use it in a request model like this:
    name: PlainText = Field(min_length=1, max_length=120)
"""

import unicodedata
from typing import Annotated

from pydantic import AfterValidator

# Tab, line feed and carriage return are normal in a multi-line note.
ALLOWED_CONTROL = {"\t", "\n", "\r"}


def no_control_characters(text: str) -> str:
    for character in text:
        is_control = ord(character) < 0x20 or ord(character) == 0x7F
        if is_control and character not in ALLOWED_CONTROL:
            raise ValueError("Remove invisible control characters (such as NUL) from this text.")
    return text


PlainText = Annotated[str, AfterValidator(no_control_characters)]


# ---------------------------------------------------------------- names of people
#
# A person's first or last name is stricter than other text: it is printed on
# seat maps, lists and emails, so it must not hide, reverse or break lines.
# Refused anywhere in a name: control characters (also tab and line breaks),
# line and paragraph separators, format characters (zero width spaces, byte
# order marks, direction marks and overrides), and the "filler" characters
# that show nothing although Unicode counts them as letters or symbols.
# Allowed: the zero width non-joiner and joiner, which Persian and Indian
# scripts need inside real names. A name must also hold at least one letter
# (has_letter), checked where the message can say which half is missing.

FILLERS = frozenset({"ᅟ", "ᅠ", "ㅤ", "ﾠ", "⠀"})
JOINERS = frozenset({"‌", "‍"})
NAME_REFUSED = "Use letters only, without line breaks, tabs or invisible characters."


def person_name_characters(text: str) -> str:
    """NFC form of the name (an accent typed apart is joined to its letter), or ValueError."""
    text = unicodedata.normalize("NFC", text)
    for character in text:
        category = unicodedata.category(character)
        hidden = category == "Cf" and character not in JOINERS
        if hidden or category in ("Cc", "Zl", "Zp") or character in FILLERS:
            raise ValueError(NAME_REFUSED)
    return text


def has_letter(text: str | None) -> bool:
    """True when the text holds at least one letter, in any script. Fillers are no letters."""
    return any(character.isalpha() and character not in FILLERS for character in text or "")


PersonNameText = Annotated[PlainText, AfterValidator(person_name_characters)]
