// Route /events/staff, "Event staff" (plan 2026-11-18, decision 3): pick an event type, then an
// event you run, and open its organiser workspace (/organiser/<id>). Without a work session the
// page is a sign-in (POST /account/login, both sessions kept) with a link to create an account.
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { accountSignOut, getAccountWork, listRunnableEvents } from "../../api/account";
import type { AccountSessions } from "../../api/account";
import { ApiError, clearSessionToken, getSessionToken } from "../../api/client";
import { getEventTypes } from "../../api/eventsPublic";
import { Button, EmptyState, ErrorState, PageShell, Skeleton, useToast } from "../../design/components";
import { Chip, Chips } from "../discover/Chips";
import { PublicHeaderActions } from "../discover/PublicHeaderActions";
import { errorMessage } from "../restaurant/format";
import { useLoad } from "../restaurant/useLoad";
import { AccountSignIn } from "../your-account/AccountSignIn";
import { EventRow } from "../your-account/StaffPanel";
import { eventTypeFrom } from "./eventsModel";
import "../account/account.css";
import "../discover/discover.css";
import "./events-public.css";

export default function EventStaffPage() {
  const [working, setWorking] = useState(() => getSessionToken() !== null);
  const [note, setNote] = useState("");
  const toast = useToast();
  const signedIn = (sessions: AccountSessions): void => {
    if (sessions.work) {
      toast.show(`Welcome, ${sessions.work.user.name}.`, "success");
      setNote("");
    } else setNote("This account has no staff tools yet. When a venue adds your email to its team, its events appear here.");
    setWorking(sessions.work !== undefined);
  };
  const ended = useCallback(() => {
    clearSessionToken();
    setWorking(false);
  }, []);
  return (
    <div className="discover-route">
      <PageShell title="Event staff" width="wide" headerActions={<PublicHeaderActions />}>
        <section className="discover-top" aria-labelledby="staff-heading">
          <h1 id="staff-heading">Event staff</h1>
          <p>Pick a kind of event, then an event you run, and plan its room: guests, seats and the share link.</p>
        </section>
        {working ? (
          <StaffEvents onEnded={ended} onSignOut={() => void accountSignOut().then(() => setWorking(false))} />
        ) : (
          <div className="ep-signin">
            <h2 className="ep-signin-title">Sign in to see your events</h2>
            <p className="ep-muted">Use your SeatPlan account. Organisers see their own events; venue staff see the events at their venues.</p>
            {note && (
              <p className="acc-notice" role="status">
                {note}
              </p>
            )}
            <AccountSignIn
              onSignedIn={signedIn}
              links={
                <>
                  <Link to="/account?mode=create">Create an account</Link>
                  <Link to="/my/forgot">Forgot your password?</Link>
                </>
              }
            />
          </div>
        )}
      </PageShell>
    </div>
  );
}

function StaffEvents({ onEnded, onSignOut }: { onEnded: () => void; onSignOut: () => void }) {
  const [params, setParams] = useSearchParams();
  const types = useLoad(getEventTypes, "event-types");
  const events = useLoad(listRunnableEvents, "runnable-events");
  const work = useLoad(getAccountWork, "account-work");
  const typeList = types.state.status === "ready" ? types.state.data : [];
  const type = eventTypeFrom(params.get("type"), typeList);
  const unauthorised = [events.state, work.state].some((s) => s.status === "error" && s.error instanceof ApiError && s.error.code === "unauthorised");
  useEffect(() => {
    if (unauthorised) onEnded();
  }, [unauthorised, onEnded]);
  const choose = (key: string | null): void => {
    const next = new URLSearchParams(params);
    if (key) next.set("type", key);
    else next.delete("type");
    setParams(next, { replace: true });
  };
  const forbidden = events.state.status === "error" && events.state.error instanceof ApiError && events.state.error.code === "forbidden";
  const rows = events.state.status === "ready" ? events.state.data.filter((e) => type === null || e.event_type === type) : [];
  const typeLabel = typeList.find((t) => t.key === type)?.label;
  return (
    <>
      <p className="ep-staff-account">
        <Link to="/account?tab=staff">All my staff tools</Link>
        <Button variant="ghost" onClick={onSignOut}>
          Sign out
        </Button>
      </p>
      {types.state.status === "ready" && (
        <Chips label="Event type">
          <Chip pressed={type === null} onClick={() => choose(null)}>
            All
          </Chip>
          {typeList.map((t) => (
            <Chip key={t.key} pressed={type === t.key} onClick={() => choose(t.key)}>
              {t.label}
            </Chip>
          ))}
        </Chips>
      )}
      <section className="ep-staff-section" aria-labelledby="ep-my-events">
        <h2 id="ep-my-events">{typeLabel ? `Your ${typeLabel.toLowerCase()} events` : "Your events"}</h2>
        {events.state.status === "loading" && <Skeleton lines={4} label="Loading your events" />}
        {forbidden && (
          <EmptyState title="This account runs restaurants only">
            <p>
              Event staff need an organiser account or a place on a venue’s team. Your restaurants are under <Link to="/account?tab=staff">Staff in your account</Link>.
            </p>
          </EmptyState>
        )}
        {events.state.status === "error" && !forbidden && !unauthorised && (
          <ErrorState title="We could not load your events" message={errorMessage(events.state.error)} onRetry={() => events.reload()} />
        )}
        {events.state.status === "ready" &&
          (rows.length === 0 ? (
            <EmptyState title={type ? `No ${typeLabel?.toLowerCase() ?? ""} events to run` : "No events to run yet"} action={type ? <Button onClick={() => choose(null)}>Show all my events</Button> : undefined}>
              <p>{type ? "Try another kind of event." : "When a venue adds your email to its team, its events appear here."}</p>
            </EmptyState>
          ) : (
            <ul className="ep-staff-list" aria-label="Events you can run">
              {rows.map((e) => (
                <EventRow key={e.public_id} event={e} />
              ))}
            </ul>
          ))}
      </section>
      {work.state.status === "ready" && work.state.data.event_venues.length > 0 && (
        <section className="ep-staff-section" aria-labelledby="ep-my-venues">
          <h2 id="ep-my-venues">Venues you run</h2>
          <ul className="ep-staff-list">
            {work.state.data.event_venues.map((v) => (
              <li key={v.public_id} className="ep-staff-row">
                <div>
                  <h3>{v.name}</h3>
                  <p>
                    {v.venue_type === "quinta" ? "Quinta" : "Event hall"} · {v.role === "owner" ? "Owner" : "Staff"}
                  </p>
                </div>
                {v.slug && v.status === "published" && (
                  <Link className="btn btn-secondary" to={`/venues/${encodeURIComponent(v.slug)}`}>
                    Public page<span className="visually-hidden"> of {v.name}</span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
