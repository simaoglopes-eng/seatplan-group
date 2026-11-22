"""Email providers: the one place that actually hands an email to someone.

The outbox only knows the Provider protocol: "give me a message, I give you the
provider's id for it, or I raise". That keeps the outbox testable with a fake
provider and lets us swap Resend for another service by writing one class.

- ConsoleProvider writes the email to the log. Used locally and in tests.
- ResendProvider calls the Resend HTTP API with httpx (no vendor SDK).
"""

import base64
import logging
import smtplib
import ssl
import uuid
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Protocol

import httpx

from app.config import APP_VERSION, Settings
from app.core.privacy import mask_email

logger = logging.getLogger("seatplan.mail")

RESEND_URL = "https://api.resend.com/emails"


@dataclass(frozen=True)
class OutgoingEmail:
    """Everything a provider needs, copied out of one outbox row."""

    to_email: str
    subject: str
    body_text: str
    body_html: str
    ics: str | None
    idempotency_key: str
    # Base64 PNG shown inline as cid:seatmap (account holders' seat emails).
    image_png: str | None = None


class ProviderError(Exception):
    """Sending failed. The message is safe to store: it never contains the API key."""


class Provider(Protocol):
    def send(self, message: OutgoingEmail) -> str:
        """Send one email and return the provider's id for it, or raise ProviderError."""
        ...


class ConsoleProvider:
    """Writes a one-line note to the log instead of sending anything.

    The body is left out on purpose: it holds a secret manage link, and server
    logs are read by more people than the guest. The address is masked for
    the same reason (data minimisation). The email stays in the outbox, its
    personal link removed once it is finished (outbox.py, S9).
    """

    def send(self, message: OutgoingEmail) -> str:
        logger.info(
            "EMAIL (console, not sent) to=%s subject=%r has_invite=%s has_image=%s",
            mask_email(message.to_email),
            message.subject,
            message.ics is not None,
            message.image_png is not None,
        )
        return f"console-{uuid.uuid4().hex}"


class ResendProvider:
    """Sends through POST https://api.resend.com/emails (see docs/email.md)."""

    def __init__(
        self, api_key: str, sender: str, timeout_s: float = 10.0, client: httpx.Client | None = None
    ) -> None:
        if not api_key:
            raise ValueError("RESEND_API_KEY is empty")
        self._api_key = api_key
        self._sender = sender
        # A timeout matters on serverless: a hanging provider must not use up
        # the whole function run. Tests pass a client with a fake transport.
        self._client = client or httpx.Client(timeout=timeout_s)

    def __repr__(self) -> str:
        # The default repr would print the key into any log or error message.
        return "ResendProvider(api_key=***)"

    def _payload(self, message: OutgoingEmail) -> dict[str, object]:
        payload: dict[str, object] = {
            "from": self._sender,
            "to": [message.to_email],
            "subject": message.subject,
            "html": message.body_html,
            "text": message.body_text,
        }
        attachments: list[dict[str, str]] = []
        if message.ics is not None:
            # Resend takes attachment content as Base64; the file type is
            # worked out from the filename.
            encoded = base64.b64encode(message.ics.encode("utf-8")).decode("ascii")
            attachments.append({"filename": "invite.ics", "content": encoded})
        if message.image_png is not None:
            # content_id makes it an inline image: the HTML shows it with
            # <img src="cid:seatmap"> (Resend docs, "Embed inline images").
            attachments.append(
                {"filename": "seat-map.png", "content": message.image_png, "content_id": "seatmap"}
            )
        if attachments:
            payload["attachments"] = attachments
        return payload

    def send(self, message: OutgoingEmail) -> str:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            # Resend rejects requests without a User-Agent.
            "User-Agent": f"seatplan/{APP_VERSION}",
            # If we retry after a lost answer, Resend recognises the same key
            # and does not send twice (it remembers keys for 24 hours).
            "Idempotency-Key": message.idempotency_key,
        }
        try:
            response = self._client.post(RESEND_URL, json=self._payload(message), headers=headers)
        except httpx.HTTPError as error:
            # Only the error type: some httpx messages repeat request details.
            raise ProviderError(f"Resend unreachable: {type(error).__name__}") from None
        if response.status_code >= 300:
            raise ProviderError(
                f"Resend answered HTTP {response.status_code}: {response.text[:300]}"
            )
        message_id = response.json().get("id")
        if not isinstance(message_id, str):
            raise ProviderError("Resend answered without an id")
        return message_id


class GmailSmtpProvider:
    """Send low-volume transactional mail through the owner's Gmail account.

    Gmail credentials are held only in server environment variables. SMTP is
    awaited in this request so Vercel does not suspend the send after replying.
    """

    def __init__(self, username: str, app_password: str, timeout_s: float = 10.0) -> None:
        if not username or not app_password:
            raise ValueError("GMAIL_USERNAME and GMAIL_APP_PASSWORD are required")
        self._username = username
        self._app_password = app_password.replace(" ", "")
        self._timeout_s = timeout_s

    def __repr__(self) -> str:
        return "GmailSmtpProvider(credentials=***)"

    def _message(self, message: OutgoingEmail) -> EmailMessage:
        outgoing = EmailMessage()
        outgoing["From"] = formataddr(("SeatPlan", self._username))
        outgoing["To"] = message.to_email
        outgoing["Subject"] = message.subject
        outgoing["Message-ID"] = make_msgid(domain="seatplan.events")
        outgoing.set_content(message.body_text)
        outgoing.add_alternative(message.body_html, subtype="html")
        if message.image_png is not None:
            html_part = outgoing.get_payload()[-1]
            html_part.add_related(
                base64.b64decode(message.image_png),
                maintype="image",
                subtype="png",
                cid="<seatmap>",
                filename="seat-map.png",
                disposition="inline",
            )
        if message.ics is not None:
            outgoing.add_attachment(
                message.ics.encode("utf-8"),
                maintype="text",
                subtype="calendar",
                filename="invite.ics",
            )
        return outgoing

    def send(self, message: OutgoingEmail) -> str:
        outgoing = self._message(message)
        try:
            with smtplib.SMTP("smtp.gmail.com", 587, timeout=self._timeout_s) as server:
                server.ehlo()
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
                server.login(self._username, self._app_password)
                server.send_message(outgoing)
        except (smtplib.SMTPException, OSError, ssl.SSLError) as error:
            # SMTP exceptions may contain account addresses or server text.
            raise ProviderError(f"Gmail SMTP failed: {type(error).__name__}") from None
        return f"gmail-{uuid.uuid4().hex}"


def provider_from_settings(settings: Settings) -> Provider:
    """Select the configured email provider."""
    if settings.email_provider == "resend":
        return ResendProvider(settings.resend_api_key, settings.email_from)
    if settings.email_provider == "gmail":
        return GmailSmtpProvider(settings.gmail_username, settings.gmail_app_password)
    return ConsoleProvider()
