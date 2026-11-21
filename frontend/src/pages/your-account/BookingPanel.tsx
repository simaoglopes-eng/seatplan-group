// The Booking side of /account: restaurant bookings and saved restaurants (DinerDashboard, as on
// /restaurants/account) and the events this account has a place at (GET /guest/me), each opening /my/:eventId.
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { getMyAccount } from "../../api/guest";
import type { MyEvent } from "../../api/guest";
import { ErrorState, Skeleton } from "../../design/components";
import { seatText } from "../account/MyEventsPage";
import { DinerDashboard } from "../discover/DinerDashboard";
import { errorMessage } from "../restaurant/format";
import { useLoad } from "../restaurant/useLoad";
import { shortDateTime } from "../events-public/eventsModel";

/** /guest/me may add the event type later; it is shown when it is there. */
type MyEventRow = MyEvent & { event_type_label?: string | null };

export function BookingPanel({ onSessionGone }: { onSessionGone: () => void }) {
  const me = useLoad(getMyAccount, "guest-me");
  const gone = me.state.status === "error" && me.state.error instanceof ApiError && me.state.error.code === "unauthorised";
  useEffect(() => {
    if (gone) onSessionGone();
  }, [gone, onSessionGone]);
  return (
    <div className="ya-panel">
      <DinerDashboard />
      <section aria-labelledby="ya-events-title" className="ya-section">
        <h2 id="ya-events-title">My events</h2>
        <p>Events where you have a place. Open one to see the room and choose or change your seat.</p>
        {me.state.status === "loading" && <Skeleton lines={3} label="Loading your events" />}
        {me.state.status === "error" && !gone && <ErrorState title="Could not load your events" message={errorMessage(me.state.error)} onRetry={() => me.reload()} />}
        {me.state.status === "ready" &&
          (me.state.data.events.length === 0 ? (
            <p>
              No events yet. <Link to="/events">Find an event</Link>
            </p>
          ) : (
            <ul className="diner-booking-list" aria-label="Your events">
              {(me.state.data.events as MyEventRow[]).map((event) => (
                <li key={event.event_id}>
                  <div>
                    {event.event_type_label && <p className="ep-type">{event.event_type_label}</p>}
                    <h3>{event.name}</h3>
                    <p>
                      <time dateTime={event.starts_at}>{shortDateTime(event.starts_at)}</time> · {event.venue_name}
                    </p>
                    <p>{seatText(event)}</p>
                  </div>
                  <div className="diner-booking-actions">
                    <Link className="btn btn-secondary" to={`/my/${encodeURIComponent(event.event_id)}`}>
                      Open<span className="visually-hidden"> {event.name}</span>
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}
