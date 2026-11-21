// Any unknown address (direction E): a photo band, the credited ballroom photo
// (photoCredits.ts) under the veil, with the message in a glass panel and glass buttons.
import { Link } from "react-router-dom";
import { PageShell } from "../design/components";
import { PublicHeaderActions } from "./discover/PublicHeaderActions";
import "./not-found.css";

export default function NotFound() {
  return (
    <div className="nf-route">
      <PageShell title="Page not found" headerActions={<PublicHeaderActions />}>
        <section className="photo-band nf-band" aria-labelledby="nf-title">
          <div className="photo-band-photo">
            <img src="/images/photos/ballroom.jpg" alt="" />
          </div>
          <div className="photo-band-inner nf-inner">
            <div className="glass-panel nf-panel">
              <p className="glass-eyebrow nf-eyebrow">Page not found</p>
              <h1 id="nf-title">This seat does not exist</h1>
              <p className="glass-muted">The link may be old or mistyped. Personal links from an email still work if you open them exactly as sent.</p>
              <div className="nf-actions">
                <Link className="btn btn-glass-green" to="/">
                  Back to the start
                </Link>
                <Link className="btn btn-glass" to="/directory">
                  Browse venues
                </Link>
              </div>
            </div>
          </div>
        </section>
      </PageShell>
    </div>
  );
}
