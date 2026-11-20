// Shown both at sign-up and on the account page.
export const PRIVACY_VERSION = "2026-11-14";

export function PrivacyText() {
  return (
    <div className="acc-privacy">
      <p>
        <strong>What we store.</strong> Your name, email, a protected password, the events you join, your seat, people you say you know,
        accessibility needs and privacy choices. You may also set a first and last name and a date of birth separately for each event.
      </p>
      <p>
        <strong>Age and suggestions.</strong> Your date of birth is optional and is not displayed to other people. If you add it, we use your age
        on the event date to suggest tables with people of similar ages who have chosen to share theirs. Sharing your age is off by default.
        If you turn it on, your age may appear beside your name on the event map, including to anyone with the event's shared link. Anonymous
        settings hide it. You can change or remove your date of birth and sharing choice in the event page.
      </p>
      <p>
        The organiser sees your event name, email and seat. Other people see your name only as allowed by your choices and the event privacy
        setting; they do not see your email. The organiser does not receive your date of birth in the event management view.
      </p>
      <p>
        We may email you about your account and seat. Seat confirmations and changes can include a room picture without other guests' names.
        We keep the words of each email for 30 days.
      </p>
      <p>
        You can delete your account on the My account page. We free your seats, erase self-registered event records and wipe the emails we
        keep for you. If an organiser invited you, their invitation record remains; your optional event birth date and sharing preference are
        removed. Copies already in your inbox remain. We also retain a security log without your name or email and short-lived rate limits.
      </p>
    </div>
  );
}
