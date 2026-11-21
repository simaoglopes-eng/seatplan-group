// Route /e/:token: the attendee's personal invitation page. Mobile first.
//
// Journey: Reply -> People you know (optional) -> Choose seat -> Done.
// useAttendee owns the data and the API calls; attendeeRules.currentStep
// decides which step to show; this file only puts the pieces together.
//
// AttendeeJourney is also used by the guest account's seat page
// (pages/account/MySeatPage.tsx), which passes accountApi instead of linkApi.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { PageShell, Stepper } from "../../design/components";
import { ClosedStep, DeclinedStep, AttendeeSkeleton, LinkProblem } from "./AttendeeStates";
import { linkApi } from "./attendeeApi";
import { currentStep, stepIndex } from "./attendeeRules";
import type { AttendeeStep } from "./attendeeRules";
import { DoneStep } from "./DoneStep";
import { EventHeader } from "./EventHeader";
import { PeopleStep } from "./PeopleStep";
import { SeatStep } from "./SeatStep";
import { useAttendee } from "./useAttendee";
import type { AttendeeState } from "./useAttendee";
import { NameProfile } from "./NameProfile";
import { AgeProfile } from "./AgeProfile";
import { WelcomeStep } from "./WelcomeStep";
import { WhoSitsWhere } from "./WhoSitsWhere";
import "./events.css";
import "./attendee.css";

const STEPS = ["Reply", "People you know", "Choose seat", "Done"];

export default function AttendeePage() {
  const { token = "" } = useParams();
  // One adapter per token, so the hooks below do not reload on every render.
  const attendeeApi = useMemo(() => linkApi(token), [token]);
  const state = useAttendee(attendeeApi);

  if (state.load.status === "loading") {
    return (
      <PageShell title="Your invitation">
        <AttendeeSkeleton />
      </PageShell>
    );
  }
  if (state.load.status === "error") {
    return (
      <PageShell title="Invitation link">
        <LinkProblem error={state.load.error} onRetry={state.actions.retry} />
      </PageShell>
    );
  }
  return (
    <PageShell title={state.load.view.event.name}>
      <AttendeeJourney state={state} />
    </PageShell>
  );
}

interface JourneyProps {
  state: AttendeeState;
  /** Shown above the event header, for example "Signed in as ...". */
  top?: ReactNode;
  /** Replaces the Done step's email sentence. */
  doneEmailNote?: string;
}

/** The header, the progress steps and the current step, for a loaded view. */
export function AttendeeJourney({ state, top, doneEmailNote }: JourneyProps) {
  const [peopleDone, setPeopleDone] = useState(false);
  if (state.load.status !== "ready") return null;
  const view = state.load.view;
  // Adding people or moving one of them happens on the seat step too, straight
  // from "Your party": never through "Who do you know here?" again.
  const partyChange = state.party.mode.kind !== "book";
  const step = currentStep({ view, peopleDone: peopleDone || partyChange, changingSeat: state.changingSeat || partyChange });
  return (
    <div className="ev-page ev-attendee">
      {top}
      <EventHeader event={view.event} venueName={view.venue.name} />
      <NameProfile key={`${view.me.first_name ?? ""}-${view.me.last_name ?? ""}`} firstName={view.me.first_name ?? ""} lastName={view.me.last_name ?? ""} currentName={view.me.name} busy={state.busy === "name"} onSave={state.actions.saveNameProfile} />
      <AgeProfile key={`${view.me.birth_date ?? ""}-${view.me.share_age ?? false}`} birthDate={view.me.birth_date ?? null} shareAge={view.me.share_age ?? false} busy={state.busy === "age"} onSave={state.actions.saveAgeProfile} />
      <Stepper steps={STEPS} current={stepIndex(step)} label="Your progress" />
      {/* One polite live region for the results of everything the person does on this page. */}
      <p className="visually-hidden" role="status" aria-live="polite">
        {state.message}
      </p>
      <StepBody step={step} state={state} doneEmailNote={doneEmailNote} onPeopleDone={() => setPeopleDone(true)} />
    </div>
  );
}

interface StepBodyProps {
  step: AttendeeStep;
  state: AttendeeState;
  doneEmailNote?: string;
  onPeopleDone: () => void;
}

function StepBody({ step, state, doneEmailNote, onPeopleDone }: StepBodyProps) {
  // Focus moves to the new step's heading only after the first screen, never on page load.
  const firstStep = useRef(step);
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    if (step !== firstStep.current) setMoved(true);
  }, [step]);

  if (state.load.status !== "ready") return null;
  const view = state.load.view;
  const { actions, busy } = state;
  switch (step) {
    case "welcome":
      return <WelcomeStep firstName={view.me.name.split(" ")[0]} busy={busy === "rsvp"} onAnswer={actions.rsvp} />;
    case "declined":
      return <DeclinedStep busy={busy === "rsvp"} moved={moved} onChangeMind={() => actions.rsvp("yes")} />;
    case "closed":
      return <ClosedStep view={view} />;
    case "people":
      return <PeopleStep people={view.people} busy={busy === "knows"} moved={moved} onSave={(ids) => actions.saveKnows(ids, onPeopleDone)} onSkip={onPeopleDone} />;
    case "seat":
      // "Who is sitting where?" is part of the seat step: the Stepper stays on "Choose seat".
      return state.party.phase === "details" ? <WhoSitsWhere state={state} view={view} /> : <SeatStep state={state} view={view} moved={moved} />;
    case "done":
      return <DoneStep state={state} view={view} moved={moved} emailNote={doneEmailNote} />;
  }
}
