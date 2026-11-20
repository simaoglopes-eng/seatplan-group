import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getOwnerProfile, saveOwnerProfile } from "../../api/owner";
import type { OwnerProfile } from "../../api/owner";
import { Button, ErrorState, Skeleton } from "../../design/components";
import { OwnerShell } from "./OwnerShell";
import { useLoad } from "../restaurant/useLoad";
import { IdentityForm, LocationForm } from "./ProfileForms";
import { ListingPreview } from "./ListingPreview";
import "./owner.css";

export default function ProfilePage() {
  const { venueId = "" } = useParams();
  const { state, reload } = useLoad(() => getOwnerProfile(venueId), venueId);
  return <OwnerShell title="Restaurant profile" venueId={venueId} current="profile">
    <div className="ow-page-head"><div><h1 className="ow-title">Restaurant profile</h1><p className="rb-muted">Help guests recognise your restaurant and find the entrance.</p></div></div>
    {state.status === "loading" && <Skeleton label="Loading your profile" lines={4} />}
    {state.status === "error" && <ErrorState message="Could not open this profile. Check your sign-in or retry." onRetry={() => reload()} />}
    {state.status === "ready" && <Profile key={state.data.public_id} initial={state.data} />}
  </OwnerShell>;
}
function Profile({ initial }: { initial: OwnerProfile }) {
  const [profile, setProfile] = useState(initial);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useSearchParams();
  const location = query.get("section") === "location";
  const selectSection = (next: boolean): void => { setQuery(next ? { section: "location" } : {}, { replace: true }); setMessage(""); };
  const save = async (changes: Parameters<typeof saveOwnerProfile>[1]) => { const next = await saveOwnerProfile(profile.public_id, changes); setProfile(next); setMessage(profile.status === "published" && next.status === "draft" ? "Profile saved as a draft. New bookings are closed until you fix the problems and publish again. Existing bookings are kept." : "Profile saved"); };
  return (
    <div className="ow-two">
      <section className="rb-card ow-checks" aria-label="Profile editor">
        <nav className="owner-profile-tabs" aria-label="Profile sections">
          <Button variant={!location ? "primary" : "secondary"} aria-pressed={!location} onClick={() => selectSection(false)}>Identity</Button>
          <Button variant={location ? "primary" : "secondary"} aria-pressed={location} onClick={() => selectSection(true)}>Location</Button>
        </nav>
        <span role="status">{message}</span>
        {location ? <LocationForm profile={profile} label="Save profile" onSave={save} /> : <IdentityForm profile={profile} label="Save profile" onSave={save} />}
      </section>
      <aside className="rb-card ow-listing" aria-label="Listing preview">
        <h2 className="ow-card-title">Listing preview</h2>
        <ListingPreview venueId={profile.public_id} name={profile.name} profile={profile} />
        <Link className="btn btn-secondary" to={`/owner/${encodeURIComponent(profile.public_id)}/photos`}>Edit photos</Link>
      </aside>
    </div>
  );
}
