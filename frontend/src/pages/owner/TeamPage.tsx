// Route /owner/:venueId/team: the owner gives staff access by email (docs/api.md, "Venue team").
// A member runs the service floor; only the owner changes the profile, photos, rooms, menu,
// deposits, publishing and this list. The same page serves an event venue (hall or quinta): the
// restaurant profile is not found there, so the venue's name comes from /account/work and the page
// drops the restaurant steps and words (its staff run the events held there). The server never says whether an email has an account,
// so neither does this page: it explains that the person needs one with that address.
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { addMember, getAccountWork, listMembers, removeMember } from "../../api/account";
import type { VenueMember } from "../../api/account";
import { ApiError } from "../../api/client";
import { getOwnerProfile } from "../../api/owner";
import { Button, Dialog, EmptyState, ErrorState, Field, PageShell, Skeleton, useToast } from "../../design/components";
import { looksLikeEmail } from "../account/FormProblem";
import { errorMessage } from "../restaurant/format";
import { useLoad } from "../restaurant/useLoad";
import { OwnerShell } from "./OwnerShell";
import "../account/account.css";
import "./owner.css";

export default function TeamPage() {
  const { venueId = "" } = useParams();
  const members = useLoad(() => listMembers(venueId), venueId);
  const profile = useLoad(() => getOwnerProfile(venueId), `profile-${venueId}`);
  const name = profile.state.status === "ready" ? profile.state.data.name : undefined;
  // No restaurant by this id: it may be an event venue this person owns.
  const notRestaurant = profile.state.status === "error" && profile.state.error instanceof ApiError && profile.state.error.code === "not_found";
  const work = useLoad(() => (notRestaurant ? getAccountWork() : Promise.resolve(null)), notRestaurant ? `work-${venueId}` : "none");
  const eventVenue = work.state.status === "ready" ? work.state.data?.event_venues.find((v) => v.public_id === venueId && v.role === "owner") : undefined;
  const notFound = members.state.status === "error" && members.state.error instanceof ApiError && members.state.error.code === "not_found";
  const signIn = members.state.status === "error" && members.state.error instanceof ApiError && members.state.error.code === "unauthorised";
  const place: Place = eventVenue ? "venue" : "restaurant";
  const body = (
    <>
      {members.state.status === "loading" && <Skeleton lines={3} label="Loading your team" />}
      {notFound && (
        <EmptyState title={`We cannot find this ${place}`} action={eventVenue ? <Link to="/account?tab=staff">Your account</Link> : <Link to="/owner">My restaurants</Link>}>
          <p>Only the owner can see its team.</p>
        </EmptyState>
      )}
      {signIn && (
        <EmptyState title="Sign in to manage your team">
          <p>
            <Link to={`/owner/sign-in?next=${encodeURIComponent(`/owner/${venueId}/team`)}`}>Sign in</Link> with your owner account.
          </p>
        </EmptyState>
      )}
      {members.state.status === "error" && !notFound && !signIn && (
        <ErrorState title="We could not load your team" message={errorMessage(members.state.error)} onRetry={() => members.reload()} />
      )}
      {members.state.status === "ready" && (
        <TeamList venueId={venueId} place={place} items={members.state.data.items} onChange={(items) => members.setData({ items })} />
      )}
    </>
  );
  if (eventVenue) {
    return (
      <>
      <PageShell title="Team" width="wide">
        <div className="ow-team-venue">
          <p className="acc-links">
            <Link to="/account?tab=staff">Back to your account</Link>
          </p>
          <p className="ow-workspace">{eventVenue.name}</p>
          <div className="ow-page-head">
            <div>
              <h1 className="ow-title">Team</h1>
              <p className="rb-muted">People who run the events held here with you. They open those events, seat guests and change room setups; only you change the venue itself and this list.</p>
            </div>
          </div>
          {body}
        </div>
      </PageShell>
      <EventsSurface />
      </>
    );
  }
  return (
    <OwnerShell title="Team" venueId={venueId} venueName={name} current="team">
      <div className="ow-page-head">
        <div>
          <h1 className="ow-title">Team</h1>
          <p className="rb-muted">People who run the service floor with you. They see the floor, the bookings and the schedule; only you change the restaurant itself.</p>
        </div>
      </div>
      {body}
    </OwnerShell>
  );
}

type Place = "restaurant" | "venue";

/**
 * An event venue's team belongs to Events, not to the Restaurants look that PageShell
 * puts on every /owner path. Rendered as PageShell's next sibling, so this effect runs
 * after PageShell's own and takes the restaurant surface off <html> again. Visual only.
 */
function EventsSurface() {
  useEffect(() => {
    delete document.documentElement.dataset.surface;
  }, []);
  return null;
}

function TeamList({ venueId, place, items, onChange }: { venueId: string; place: Place; items: VenueMember[]; onChange: (items: VenueMember[]) => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<VenueMember | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const add = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const value = email.trim();
    if (!looksLikeEmail(value)) {
      setError("Enter an email address like name@example.com.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const member = await addMember(venueId, value);
      onChange([...items.filter((m) => m.id !== member.id), member]);
      setEmail("");
      toast.show(`${member.email} is on your team.`, "success");
    } catch (caught) {
      setError(errorMessage(caught, "We could not add this person. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await removeMember(venueId, removing.id);
      onChange(items.filter((m) => m.id !== removing.id));
      toast.show(`${removing.email} is no longer on your team.`, "success");
      setRemoving(null);
    } catch (caught) {
      toast.show(errorMessage(caught), "danger");
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <div className="ow-team">
      <form className="ow-team-add" onSubmit={(e) => void add(e)} noValidate>
        <h2>Add a member</h2>
        <Field
          label="Email"
          hint={`The person needs a SeatPlan account with this email. If they do not have one yet, they can create it at any time with this address; the ${place} then appears under Staff in their account.`}
          type="email"
          name="email"
          autoComplete="off"
          maxLength={254}
          value={email}
          error={error}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" busy={busy}>
          Add to team
        </Button>
      </form>
      <section aria-labelledby="ow-team-list">
        <h2 id="ow-team-list">Members</h2>
        {items.length === 0 ? (
          <p className="rb-muted">No members yet. You are the owner and can always run {place === "venue" ? "its events" : "the floor"} yourself.</p>
        ) : (
          <ul className="ow-team-list">
            {items.map((member) => (
              <li key={member.id}>
                <div>
                  <strong>{member.email}</strong>
                  <span className="rb-muted"> · Staff, added {new Date(member.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                </div>
                <Button variant="ghost" onClick={() => setRemoving(member)}>
                  Remove<span className="visually-hidden"> {member.email}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Dialog open={removing !== null} title="Remove this member?" onClose={() => { if (!removeBusy) setRemoving(null); }}>
        <p>
          {removing?.email} will no longer be able to open {place === "venue" ? "this venue’s events" : "this restaurant’s service floor"}. Their own bookings are not affected.
        </p>
        <div className="ow-team-actions">
          <Button variant="secondary" disabled={removeBusy} onClick={() => setRemoving(null)}>
            Keep member
          </Button>
          <Button variant="danger" busy={removeBusy} onClick={() => void remove()}>
            Remove member
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
