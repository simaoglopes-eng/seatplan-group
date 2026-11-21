// One hall or quinta on /venues and in the "Halls and quintas" section of /events.
import { useState } from "react";
import { Link } from "react-router-dom";
import type { EventVenueCard } from "../../api/eventsPublic";
import { areaOf } from "./eventsModel";

export function VenueCard({ venue, typeLabels }: { venue: EventVenueCard; typeLabels: Map<string, string> }) {
  const [failed, setFailed] = useState(false);
  const href = `/venues/${encodeURIComponent(venue.slug)}`;
  const area = areaOf(venue.address);
  const types = venue.event_types.map((key) => typeLabels.get(key) ?? key);
  return (
    <article className="ep-venue-card" aria-labelledby={`venue-${venue.slug}`}>
      <Link to={href} className="ep-venue-photo" tabIndex={-1} aria-hidden="true">
        {venue.cover_url && !failed ? (
          <img src={venue.cover_url} alt="" loading="lazy" width={640} height={400} onError={() => setFailed(true)} />
        ) : (
          <span className="discover-card-nophoto">Photo unavailable</span>
        )}
      </Link>
      <div className="ep-venue-body">
        <p className="ep-type">{[venue.is_demo ? "Demo venue" : null, venue.venue_type_label, area].filter(Boolean).join(" · ")}</p>
        <h3 id={`venue-${venue.slug}`}>
          <Link to={href}>{venue.name}</Link>
        </h3>
        <p className="discover-card-line">
          Up to {venue.capacity} guests
          {venue.upcoming_count > 0 && ` · ${venue.upcoming_count} upcoming ${venue.upcoming_count === 1 ? "event" : "events"}`}
        </p>
        {types.length > 0 && (
          <ul className="ep-tags" aria-label={`Events at ${venue.name}`}>
            {types.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
