// One upcoming event on /events and on a venue page. The same frame as a restaurant
// result (discover-card): the venue's cover on the left, the words on the right, and
// one main action, "Choose your seat", which opens the event's shared link (/j/<token>).
// That page already shows the room and handles creating an account or signing in.
import { useState } from "react";
import { Link } from "react-router-dom";
import type { PublicEvent } from "../../api/eventsPublic";
import { areaOf, placesLeftText, shortDateTime } from "./eventsModel";

export function EventCard({ event, showVenue = true }: { event: PublicEvent; showVenue?: boolean }) {
  const [failed, setFailed] = useState(false);
  const venueHref = `/venues/${encodeURIComponent(event.venue.slug)}`;
  const area = areaOf(event.venue.address);
  const places = placesLeftText(event.places_left);
  const titleId = `event-${event.public_id}`;
  return (
    <article className="discover-card ep-event-card" aria-labelledby={titleId}>
      <Link to={venueHref} className="discover-card-photo" tabIndex={-1} aria-hidden="true">
        {event.venue.cover_url && !failed ? (
          <img src={event.venue.cover_url} alt="" loading="lazy" width={640} height={400} onError={() => setFailed(true)} />
        ) : (
          <span className="discover-card-nophoto">Photo unavailable</span>
        )}
      </Link>
      <div className="discover-card-body">
        <div className="discover-card-main">
        {event.event_type_label && <p className="ep-type">{event.event_type_label}</p>}
        <h3 id={titleId}>{event.name}</h3>
        <p className="discover-card-line">
          <time dateTime={event.starts_at}>{shortDateTime(event.starts_at)}</time>
        </p>
        {showVenue && (
          <p className="discover-card-line">
            <Link to={venueHref}>{event.venue.name}</Link>
            {area && ` · ${area}`}
          </p>
        )}
        <div className="ep-card-foot">
          {places && <p className={`ep-places${event.places_left === 0 ? " is-full" : ""}`}>{places}</p>}
          <Link className="btn btn-primary" to={event.join_path}>
            {event.places_left === 0 ? "See the room" : "Choose your seat"}
            <span className="visually-hidden"> at {event.name}</span>
          </Link>
        </div>
        </div>
      </div>
    </article>
  );
}
