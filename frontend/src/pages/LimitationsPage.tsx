import { useState } from "react";
import { Link } from "react-router-dom";
import { PageShell } from "../design/components";
import { PublicHeaderActions } from "./discover/PublicHeaderActions";
import "./limitations.css";

const roadmap = [
  {
    title: "From discovery to booking",
    photo: "/images/venues/relation-5424595.jpg",
    limit: "Organisers can find venues across several cities. They still have to contact the venue to check dates and book.",
    solution: "Pilot booking requests with a few partner venues. Add instant reservations once partners can keep availability up to date.",
    measure: "Track response time and the share of enquiries that turn into confirmed bookings.",
  },
  {
    title: "Ready-to-use floor plans",
    photo: "/images/photos/palazzo-hall.jpg",
    limit: "Organisers still draw the room for each event. Capacity and seating vary by setup.",
    solution: "Publish venue-approved banquet, theatre and reception layouts that organisers can adapt.",
    measure: "Compare setup time and record how often organisers need to correct a template.",
  },
  {
    title: "Scale city by city",
    photo: "/images/venues/way-144502504.jpg",
    limit: "As the directory grows, contact details, opening hours and accessibility information are harder to keep current.",
    solution: "Expand city by city and let venues manage their listings. A useful local directory attracts organisers, whose enquiries give venues a reason to stay active.",
    measure: "Track recently verified listings, active venues and repeat organisers by city.",
  },
  {
    title: "Venue and catering partnerships",
    photo: "/images/photos/hero-dinner-giant.jpg",
    limit: "After choosing a venue, organisers still find and coordinate suppliers separately.",
    solution: "Offer optional introductions to catering and event partners. Test clearly disclosed referral fees or paid venue services.",
    measure: "Track accepted referrals, supplier response times and organiser satisfaction.",
  },
  {
    title: "Reliability when everyone joins",
    photo: "/images/photos/hero-dining-hall.jpg",
    limit: "Many guests may try to book the same seat. Event-day traffic still needs testing.",
    solution: "Load-test simultaneous reservations, expired holds and repeat requests at realistic event sizes.",
    measure: "Check that no seat is assigned twice and track response latency under load.",
  },
];

const walkthrough = [
  {
    title: "Follow the invitation into the app",
    file: "frontend/src/App.tsx",
    detail: "Trace the token from the URL to AttendeePage. The personal invitation and the shared event link enter through different routes. The live demo starts with a personal guest link.",
    code: '<Route path="/e/:token" element={<AttendeePage />} />',
  },
  {
    title: "Follow a seat choice to the server",
    file: "backend/app/routers/attendee.py",
    detail: "The confirmation endpoint receives a typed seat ID, resolves the attendee and delegates the write to confirm_seat. Follow that call to see where the booking rules are applied.",
    code: 'row = confirm_seat(session, event_of(session, me), me, body.seat_id, token)',
  },
  {
    title: "Read the test for the losing request",
    file: "backend/tests/test_e2e_slice.py",
    detail: "The test confirms a seat, tries the same seat as another attendee, checks the confirmation email outbox and checks that organiser auto-fill preserves the guest’s choice.",
    code: 'assert clash.status_code == 409\nassert clash.json()["error"]["code"] == "seat_taken"',
  },
];

function RoadmapExplorer() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { title, photo, limit, solution, measure } = roadmap[selectedIndex];

  return (
    <section className="sp-review-wrap sp-review-section" id="roadmap" aria-labelledby="sp-roadmap">
      <h2 id="sp-roadmap">Where SeatPlan goes next</h2>
      <div className="sp-review-explorer">
        <div className="sp-review-topics" role="group" aria-label="Roadmap topics">
          {roadmap.map((item, index) => (
            <button
              key={item.title}
              type="button"
              aria-pressed={selectedIndex === index}
              aria-controls="sp-review-topic"
              onClick={() => setSelectedIndex(index)}
            >
              {item.title}
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
        <article className="sp-review-topic" id="sp-review-topic" aria-labelledby="sp-review-topic-title">
          <div className="sp-review-topic-cover">
            <img key={photo} src={photo} alt="" loading="lazy" decoding="async" />
          </div>
          <div className="sp-review-topic-copy">
            <h3 id="sp-review-topic-title" aria-live="polite">{title}</h3>
            <dl key={title}>
              <div>
                <dt>Today</dt>
                <dd>{limit}</dd>
              </div>
              <div>
                <dt>Proposed solution</dt>
                <dd>{solution}</dd>
              </div>
              <div className="sp-review-topic-measure">
                <dt>How to measure it</dt>
                <dd>{measure}</dd>
              </div>
            </dl>
          </div>
        </article>
      </div>
    </section>
  );
}

export default function LimitationsPage() {
  return (
    <div className="sp-review">
      <PageShell title="Limitations and solutions" width="wide" variant="overlay" headerActions={<PublicHeaderActions />}>
        <section className="sp-review-hero" aria-labelledby="sp-review-title">
          <img className="sp-review-hero-img" src="/images/photos/hero-terrace-assisi.jpg" width={2000} height={1333} alt="" fetchPriority="high" />
          <div className="sp-review-panel">
            <p className="sp-review-kicker">Nova SBE team project</p>
            <h1 id="sp-review-title">Limitations and solutions</h1>
            <p>SeatPlan helps organisers find venues, plan rooms and let guests choose their seats. Here’s where it falls short today and what we’d build next.</p>
            <div className="sp-review-actions">
              <a className="sp-review-action sp-review-action-primary" href="#roadmap">Explore the roadmap <span aria-hidden="true">↓</span></a>
              <a className="sp-review-action sp-review-action-secondary" href="#code-walkthrough">Code walkthrough</a>
            </div>
          </div>
        </section>
        <RoadmapExplorer />
        <section className="sp-review-wrap sp-review-section" id="code-walkthrough" aria-labelledby="sp-code-title">
          <h2 id="sp-code-title">Code walkthrough</h2>
          <p>Follow one guest action from the interface to the API and its tests. Open these files in the repository during the presentation.</p>
          <ol className="sp-review-code">
            {walkthrough.map(({ title, file, detail, code }) => (
              <li key={file} className="sp-review-code-card">
                <h3>{title}</h3>
                <a className="sp-review-file" href={`https://github.com/f3deric0/seatplan-federico-private/blob/main/${file}`}>{file}</a>
                <p>{detail}</p>
                <pre><code>{code}</code></pre>
              </li>
            ))}
          </ol>
          <h3>How the course shaped the work</h3>
          <ul className="sp-review-course">
            <li><strong>Design the workflow first.</strong> Describe what the organiser and guest each need to accomplish before splitting the work across screens and API calls.</li>
            <li><strong>Read and explain the code.</strong> Follow inputs, branches and return values across files, including code written by another teammate or suggested by AI.</li>
            <li><strong>Verify behaviour.</strong> Compare the intended result with API responses, persisted data and the live demo. Check the failure case as well as the happy path.</li>
          </ul>
          <Link className="sp-review-back" to="/">← Back to SeatPlan</Link>
        </section>
      </PageShell>
    </div>
  );
}
