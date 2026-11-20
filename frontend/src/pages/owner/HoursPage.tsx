// Step 4 of the owner's setup: opening hours (spec 5.3). It wraps the staff
// schedule editor, and for a restaurant with no services yet it offers a model
// to start from. Nothing is saved until the owner taps "Use this".
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getSchedule, saveSchedule } from "../../api/restaurant";
import type { Schedule } from "../../api/restaurant";
import { Button, ErrorState, Skeleton } from "../../design/components";
import { OwnerShell } from "./OwnerShell";
import { ScheduleEditor } from "../restaurant/StaffSchedule";
import { errorMessage } from "../restaurant/format";
import { useLoad } from "../restaurant/useLoad";
import { TEMPLATE_SCHEDULE, TEMPLATE_TEXT } from "./hoursTemplate";
import { WeeklyServices } from "./WeeklyServices";
import "./owner.css";
import "../restaurant/staff.css";

export default function HoursPage() {
  const { venueId = "" } = useParams();
  const { state, reload, setData } = useLoad(() => getSchedule(venueId), venueId);
  const [custom, setCustom] = useState(false);
  return (
    <OwnerShell title="Opening hours" venueId={venueId} current="hours">
      <div className="ow-page-head"><div><h1 className="ow-title">Opening hours</h1><p className="rb-muted">Set the services guests can book each week.</p></div></div>
      {state.status === "loading" && <Skeleton label="Loading your opening hours" lines={4} />}
      {state.status === "error" && <ErrorState message="Could not open your opening hours. Check your sign-in or retry." onRetry={() => reload()} />}
      {state.status === "ready" && state.data.services.length === 0 && !custom && (
        <Proposal
          venueId={venueId}
          onSaved={setData}
          onCustom={() => setCustom(true)}
        />
      )}
      {state.status === "ready" && (state.data.services.length > 0 || custom) && <ScheduleEditor key={venueId} venueId={venueId} saved={state.data} onSaved={(next) => { setCustom(true); setData(next); }} servicesEditor={WeeklyServices} heading={false} />}
      <nav className="ow-page-next" aria-label="Setup steps">
        <Link className="btn btn-secondary" to={`/owner/${encodeURIComponent(venueId)}/photos`}>Back to photos</Link>
        <Link className="btn btn-secondary" to={`/owner/${encodeURIComponent(venueId)}/review`}>Review and publish</Link>
        <Link className="btn btn-primary" to={`/owner/${encodeURIComponent(venueId)}/rooms`}>Continue to rooms</Link>
      </nav>
    </OwnerShell>
  );
}

function Proposal({ venueId, onSaved, onCustom }: {
  venueId: string;
  onSaved: (schedule: Schedule) => void;
  onCustom: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const use = async (): Promise<void> => {
    setBusy(true);
    setProblem("");
    try {
      onSaved(await saveSchedule(venueId, { services: TEMPLATE_SCHEDULE.service_periods, turn_times: TEMPLATE_SCHEDULE.turn_times, blackout_dates: [] }));
    } catch (error) {
      setProblem(errorMessage(error, "We could not save the opening hours. Please try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="owner-card" aria-label="A model to start from">
      <div className="owner-card-body">
        <h2>Start from a model?</h2>
        <p>{TEMPLATE_TEXT}. You can change anything afterwards.</p>
        {problem && (
          <p role="alert" className="room-error">
            {problem}
          </p>
        )}
        <div className="rb-actions">
          <Button busy={busy} onClick={() => void use()}>Use this</Button>
          <Button variant="secondary" disabled={busy} onClick={onCustom}>Set my own hours</Button>
        </div>
      </div>
    </section>
  );
}
