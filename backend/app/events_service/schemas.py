"""Request bodies for the events endpoints (contract section 5).

Every body forbids unknown fields and limits every length (contract section 7).
GuestIn is also used to validate each row of an imported CSV file, so a row
from a file is checked by exactly the same rules as a guest typed in by hand.
"""

from datetime import date
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, EmailStr, Field

from app.core.text import PersonNameText, PlainText
from app.events_service.event_types import EventType

PrivacyMode = Literal["full_name", "first_initial", "anonymous"]
ReservedTag = Literal["vip", "family", "speaker"]
Rsvp = Literal["pending", "yes", "no"]

# Database ids are positive; the upper bound only stops absurd numbers early.
Id = Field(ge=1, le=2_000_000_000)
MAX_ID = 2_000_000_000

# A person's age in whole years, typed when booking seats for a party.
# strict: "7", 7.5 and true are refused instead of being turned into 7 or 1.
Age = Annotated[int, Field(ge=0, le=120, strict=True)]
# One half of a name. Invisible, control and line-break characters are refused
# here (core/text.py); blank after trimming, or without a letter, is refused in
# events_service/party.py, so the message can say which half is missing.
NamePart = Annotated[PersonNameText, Field(max_length=60)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EventIn(Strict):
    venue_id: PlainText = Field(min_length=1, max_length=32)  # the venue's public id
    name: PlainText = Field(min_length=1, max_length=120)
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    privacy_mode: PrivacyMode = "first_initial"
    change_deadline: AwareDatetime | None = None
    event_type: EventType | None = None


class EventPatch(Strict):
    name: PlainText | None = Field(default=None, min_length=1, max_length=120)
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    privacy_mode: PrivacyMode | None = None
    change_deadline: AwareDatetime | None = None
    event_type: EventType | None = None  # null clears it
    # Seats one guest may book, their own included (party.py). null: the
    # default (core/limits.DEFAULT_MAX_PARTY_SIZE); 0: no limit.
    max_party_size: int | None = Field(default=None, ge=0, le=500, strict=True)


class GuestIn(Strict):
    name: PlainText = Field(min_length=1, max_length=120)
    email: EmailStr | None = None
    group: PlainText | None = Field(default=None, min_length=1, max_length=80)
    keep_adjacent: bool = False  # only used when the group is new
    needs_accessible: bool = False
    dietary_note: PlainText | None = Field(default=None, max_length=200)
    reserved_tag: ReservedTag | None = None
    wants_anonymous: bool = False


class GuestPatch(Strict):
    name: PlainText | None = Field(default=None, min_length=1, max_length=120)
    email: EmailStr | None = None
    group: PlainText | None = Field(default=None, max_length=80)
    needs_accessible: bool | None = None
    dietary_note: PlainText | None = Field(default=None, max_length=200)
    reserved_tag: ReservedTag | None = None
    wants_anonymous: bool | None = None
    rsvp: Rsvp | None = None
    # Party details (events_service/party.py). Both names together also set `name`.
    first_name: NamePart | None = None
    last_name: NamePart | None = None
    age: Age | None = None  # null clears it, except for a party member


class NameProfileIn(Strict):
    # The same characters as a party name: this name also counts as the
    # booker's details (events_service/party.py, details_complete).
    first_name: PersonNameText = Field(min_length=1, max_length=60)
    last_name: PersonNameText = Field(min_length=1, max_length=59)


class AgeProfileIn(Strict):
    birth_date: date | None
    share_age: bool = False


class SeatChoice(Strict):
    seat_id: int = Id


# ---------------------------------------------------------------- party booking
#
# One booker chooses several seats and names everyone on them
# (events_service/party.py). The booker's own age may be left out (or null)
# only when one is already saved; every party member needs one.


class PersonIn(Strict):
    first_name: NamePart
    last_name: NamePart
    age: Age


class PartyMemberIn(PersonIn):
    seat_id: int = Id


class MyPartySeatIn(Strict):
    seat_id: int = Id
    first_name: NamePart
    last_name: NamePart
    age: Age | None = None  # left out: keep the saved age


class PartyConfirmIn(Strict):
    me: MyPartySeatIn
    # Only a guard against huge bodies: the business limit is the event's
    # party size (core/limits.py), at most MAX_PARTY_SIZE_SETTING seats.
    members: list[PartyMemberIn] = Field(default_factory=list, max_length=500)


class MyDetailsIn(Strict):
    first_name: NamePart
    last_name: NamePart
    age: Age | None = None  # left out: keep the saved age


class PersonPatch(Strict):
    """Change one party member. Only the fields sent change; none may be null."""

    first_name: NamePart | None = None
    last_name: NamePart | None = None
    age: Age | None = None


class OptimiseIn(Strict):
    seed: int = Field(default=0, ge=0, le=1_000_000_000)
    # Capped so one request cannot keep a serverless function busy for minutes.
    max_iterations: int = Field(default=20000, ge=0, le=100_000)


class MoveIn(Strict):
    guest_id: int = Id
    seat_id: int | None = Id  # None means "take this guest off their seat"


class WhatIfIn(Strict):
    moves: list[MoveIn] = Field(min_length=1, max_length=50)


class ExactCheckIn(Strict):
    table_ids: list[int] | None = Field(default=None, min_length=1, max_length=2)


class RsvpIn(Strict):
    rsvp: Rsvp


class KnowsIn(Strict):
    guest_ids: list[int] = Field(max_length=200)


class PrivacyIn(Strict):
    wants_anonymous: bool


# ---------------------------------------------------------------- shared link and guest accounts
#
# Password lengths are checked in events_service/accounts.py rather than with
# min_length, so the 422 message can name the field in plain words
# ("password: Use at least 10 characters.").

Code = Field(pattern=r"^[0-9]{6}$")
Password = Field(min_length=1, max_length=200)


class LayoutPresetIn(Strict):
    """POST /events/{eid}/layout: one of events_service/layout_presets.PRESET_KEYS."""

    preset: Literal[
        "banquet", "cabaret", "theatre", "classroom", "u_shape", "boardroom", "cocktail"
    ]
    # Needed when guests already have seats, or the setup has fewer seats than
    # guests coming: the page asks first, then sends confirm=true.
    confirm: bool = False


class EmptyIn(Strict):
    """A body of {} for actions that need nothing more."""


class SharePatch(Strict):
    enabled: bool | None = None
    cap: int | None = Field(default=None, ge=1, le=5000)  # null: no cap beyond the seats


class RegisterIn(Strict):
    name: PlainText = Field(min_length=1, max_length=120)
    email: EmailStr = Field(max_length=254)
    password: str = Password
    needs_accessible: bool = False
    # Literal[True]: the box must be ticked; false or missing is a 422.
    consent: Literal[True]


class VerifyIn(Strict):
    email: EmailStr = Field(max_length=254)
    code: str = Code
    # The id the register answer gave this browser (accounts.start_sign_up).
    signup_id: str = Field(min_length=1, max_length=128)


class GuestLoginIn(Strict):
    email: EmailStr = Field(max_length=254)
    password: str = Password


class ForgotIn(Strict):
    email: EmailStr = Field(max_length=254)


class ResetIn(Strict):
    email: EmailStr = Field(max_length=254)
    code: str = Code
    new_password: str = Password


class DeleteAccountIn(Strict):
    password: str = Password
