import { Link } from "react-router-dom";
import { Wordmark } from "../design/components";
import LiquidGlassPanel from "./LiquidGlassPanel";
import { seatPlanBackgroundStyle, useSeatPlanBackground } from "./useSeatPlanBackground";
import "./home.css";

/** The first screen asks visitors to choose a clear, role-specific path. */
export default function Home() {
  const backgroundImage = useSeatPlanBackground();

  return (
    <div className="welcome-page" style={seatPlanBackgroundStyle(backgroundImage)}>
      <a className="welcome-skip-link" href="#main">Skip to main content</a>
      <header className="welcome-header">
        <Link className="welcome-header-link" to="/login">
          Organiser sign in <span aria-hidden="true">↗</span>
        </Link>
      </header>

      <main className="welcome-main" id="main">
        <div className="welcome-content">
          <div className="welcome-center-brand"><Wordmark /></div>

          <LiquidGlassPanel aria-labelledby="welcome-title">
            <div className="welcome-intro">
              <h1 id="welcome-title">
                Welcome to <em>SeatPlan</em>
              </h1>
              <p>How are you joining us? Choose your path.</p>
            </div>

            <div className="welcome-role-grid" role="group" aria-label="Choose how to use SeatPlan">
              <Link className="welcome-role-card welcome-role-organiser" to="/organiser/register">
                <span className="welcome-role-topline">
                  <span className="welcome-role-icon" aria-hidden="true">✳</span>
                  <span>01 / ORGANISE</span>
                </span>
                <span className="welcome-role-copy">
                  <strong>I’m an organiser</strong>
                  <span>Create an event, arrange your tables and bring your guest list together.</span>
                </span>
                <span className="welcome-role-action">
                  Create an event <span aria-hidden="true">↗</span>
                </span>
              </Link>

              <Link className="welcome-role-card welcome-role-participant" to="/participant">
                <span className="welcome-role-topline">
                  <span className="welcome-role-icon" aria-hidden="true">♡</span>
                  <span>02 / ATTEND</span>
                </span>
                <span className="welcome-role-copy">
                  <strong>I’m a participant</strong>
                  <span>Open your invitation, meet the table and find a seat that feels right.</span>
                </span>
                <span className="welcome-role-action">
                  Open an invitation <span aria-hidden="true">↗</span>
                </span>
              </Link>
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
