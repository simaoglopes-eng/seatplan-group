import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
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

export default function ParticipantStartPage() {
  const [invitation, setInvitation] = useState(savedInvitation);
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

  async function openInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const compact = invitation.trim().toUpperCase().replace(/[\s-]/g, "");
    const code = compact.replace(/^([0-9A-Z]+)([0-9A-Z]{10})$/, "$1-$2");
    const isJoinCode = /^[0-9A-Z]{1,20}-[0-9A-Z]{10}$/.test(code);
    let path: string | null = null;
    if (isJoinCode) {
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
      path = invitationPath(invitation, window.location.origin);
    }
    if (!path) {
      setError("Enter a valid SeatPlan invitation link or code, or ask the organiser for the latest one.");
      return;
    }
    setError("");
    navigate(path);
  }

  return (
    <div className="pt-page">
      {/* The auditorium photo is credited on /credits (photoCredits.ts); it is decoration here. */}
      <img className="pt-photo" src="/images/photos/hero-auditorium.jpg" alt="" />
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
          <p><span className="pt-credit-text">Photo: Lichtburg, Essen, by Tuxyso, CC BY-SA 4.0. </span><Link to="/credits">Photo credits</Link></p>
          <Link to="/staff">Staff area</Link>
        </div>
      </footer>
    </div>
  );
}
