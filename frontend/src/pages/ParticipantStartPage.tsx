import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { Wordmark } from "../design/components";
import { invitationPath } from "./join/invitationPath";
import "./home.css";

const INVITATION_KEY = "seatplan.participant-entry.invitation";

function savedInvitation(): string {
  try {
    return window.sessionStorage.getItem(INVITATION_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * The short invitation code ("7KQ-24M8PQ3VZD") as the server reads it, or null when the value is
 * not one. Codes use Crockford base32 (no I, L, O or U: backend events_service/share.py), so a
 * value with those letters is a shared link token instead, e.g. "return-to-form", and opens
 * /j/<token> directly. Spaces and hyphens typed by hand are forgiven; the hyphen goes back in
 * before the last ten characters.
 */
export function joinCodeOf(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/[\s-]/g, "");
  const code = compact.replace(/^([0-9A-Z]+)([0-9A-Z]{10})$/, "$1-$2");
  return /^[0-9A-HJKMNP-TV-Z]{1,20}-[0-9A-HJKMNP-TV-Z]{10}$/.test(code) ? code : null;
}

export default function ParticipantStartPage() {
  const [params] = useSearchParams();
  // A link from the landing's guest card (/participant?code=...) wins over a saved value.
  const fromLink = (params.get("code") ?? "").trim().slice(0, 200);
  const [invitation, setInvitation] = useState(() => fromLink || savedInvitation());
  const [error, setError] = useState("");
  const [lookingUpCode, setLookingUpCode] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Find your place · SeatPlan";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    try {
      if (invitation) window.sessionStorage.setItem(INVITATION_KEY, invitation);
      else window.sessionStorage.removeItem(INVITATION_KEY);
    } catch {
      // The form still works when the browser has disabled session storage.
    }
  }, [invitation]);

  async function open(value: string, replace: boolean): Promise<void> {
    const code = joinCodeOf(value);
    let path: string | null = null;
    if (code) {
      setLookingUpCode(true);
      try {
        const resolved = await api.get<{ path: string }>(`/join-code/${encodeURIComponent(code)}`, "none");
        if (/^\/j\/[A-Za-z0-9_-]+\/?$/.test(resolved.path)) path = resolved.path;
      } catch {
        // Use the same message for unknown, closed and replaced invitation codes.
      } finally {
        setLookingUpCode(false);
      }
    } else {
      path = invitationPath(value, window.location.origin);
    }
    if (!path) {
      setError("Enter a valid SeatPlan invitation link or code, or ask the organiser for the latest one.");
      return;
    }
    setError("");
    navigate(path, { replace });
  }

  function openInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void open(invitation, false);
  }

  // ?code= with a well-formed invitation code opens it straight away, replacing this entry in
  // the history so Back returns to the page that linked here. Anything else is only filled in.
  // The ref keeps React's development double effect from looking the code up twice.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !fromLink || !joinCodeOf(fromLink)) return;
    autoOpened.current = true;
    void open(fromLink, true);
    // Only on arrival: later typing must not resubmit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pt-page">
      {/* The terrace photo is credited on /credits (photoCredits.ts); it is decoration here. */}
      <img className="pt-photo" src="/images/photos/hero-terrace-assisi.jpg" alt="" />
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="pt-header">
        <div className="pt-wrap">
          <Wordmark />
          <Link className="pt-header-link" to="/">Back to home</Link>
        </div>
      </header>

      <main className="pt-main" id="main" tabIndex={-1}>
        <div className="pt-wrap pt-grid">
          <div className="pt-copy">
            <p className="pt-eyebrow">Your place is waiting</p>
            <h1 id="participant-title">Find your place.</h1>
            <p className="pt-lede">Open the event you were invited to, see the room and choose the seat next to the people you know.</p>
          </div>
          <section className="pt-card" aria-labelledby="participant-card-title">
            <h2 id="participant-card-title">Open your invitation</h2>
            <p className="pt-card-lede">Enter the invitation link or code you received to open your event.</p>

            <form className="pt-form" onSubmit={openInvitation}>
              <label htmlFor="participant-invitation">Invitation link or code</label>
              <div>
                <input
                  id="participant-invitation"
                  name="invitation"
                  type="text"
                  autoComplete="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="Paste your link or enter your code"
                  value={invitation}
                  onChange={(event) => {
                    setInvitation(event.target.value);
                    setError("");
                  }}
                  aria-describedby={error ? "participant-invitation-error" : "participant-invitation-hint"}
                  aria-invalid={Boolean(error)}
                  required
                />
                <button className="btn btn-primary" type="submit" disabled={lookingUpCode}>{lookingUpCode ? "Looking up code…" : <>Open invitation <span aria-hidden="true">→</span></>}</button>
              </div>
              <p className="pt-hint" id="participant-invitation-hint">
                Use the invite link or the code shared by the organiser.
              </p>
              {error && <p className="pt-error" id="participant-invitation-error" role="alert">{error}</p>}
            </form>

            <div className="pt-account">
              <span>New to SeatPlan?</span>
              <Link to="/my/register">Create a participant account</Link>
              <Link to="/my/sign-in">Participant sign in</Link>
            </div>
          </section>
        </div>
      </main>

      <footer className="pt-footer">
        <div className="pt-wrap">
          <p><span className="pt-credit-text">Photo: Terrace Dinner in Assisi, by Andrew Parlette, CC BY 4.0. </span><Link to="/credits">Photo credits</Link></p>
          <Link to="/staff">Staff area</Link>
        </div>
      </footer>
    </div>
  );
}
