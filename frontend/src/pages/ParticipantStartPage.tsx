import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Wordmark } from "../design/components";
import LiquidGlassPanel from "./LiquidGlassPanel";
import { invitationPath } from "./join/invitationPath";
import { seatPlanBackgroundStyle, useSeatPlanBackground } from "./useSeatPlanBackground";
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
  const backgroundImage = useSeatPlanBackground();

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
    <div className="welcome-page welcome-page-participant" style={seatPlanBackgroundStyle(backgroundImage)}>
      <a className="welcome-skip-link" href="#main">Skip to main content</a>
      <header className="welcome-header">
        <Link className="welcome-header-link" to="/">Back to home</Link>
      </header>

      <main className="welcome-main" id="main">
        <div className="welcome-content participant-content">
          <div className="welcome-center-brand"><Wordmark /></div>
          <LiquidGlassPanel className="participant-panel" aria-labelledby="participant-title">
            <Link className="participant-back" to="/">
              <span aria-hidden="true">←</span> Choose another path
            </Link>
            <div className="welcome-intro participant-intro">
              <p className="welcome-eyebrow">YOUR PLACE IS WAITING</p>
              <h1 id="participant-title">Find your place.</h1>
              <p>Enter the invitation link or code you received to open your event.</p>
            </div>

            <form className="participant-invitation-form" onSubmit={openInvitation}>
              <label htmlFor="participant-invitation">Invitation link or code</label>
              <div className="participant-input-wrap">
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
                <button type="submit" disabled={lookingUpCode}>{lookingUpCode ? "Looking up code…" : <>Open invitation <span aria-hidden="true">↗</span></>}</button>
              </div>
              <p className="participant-form-hint" id="participant-invitation-hint">
                Use the invite link or the code shared by the organiser.
              </p>
              {error && <p className="participant-form-error" id="participant-invitation-error" role="alert">{error}</p>}
            </form>

            <div className="participant-account-links">
              <span>New to SeatPlan?</span>
              <Link to="/my/register">Create a participant account</Link>
              <span className="participant-link-divider" aria-hidden="true">·</span>
              <Link to="/my/sign-in">Participant sign in</Link>
            </div>
          </LiquidGlassPanel>
        </div>
      </main>

      <footer className="welcome-footer">
        <Link to="/staff">Staff area</Link>
      </footer>
    </div>
  );
}
