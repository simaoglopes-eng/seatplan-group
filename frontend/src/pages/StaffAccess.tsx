import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, getMe } from "../api/client";
import { Button, Field, PageShell } from "../design/components";
import "./login.css";

/** Staff use the existing venue-specific service workspace. */
export default function StaffAccess() {
  const navigate = useNavigate();
  const [venue, setVenue] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    getMe().then(() => { if (active) setReady(true); }).catch((caught: unknown) => {
      if (!active) return;
      if (caught instanceof ApiError && caught.status === 401) navigate("/login?next=%2Fstaff", { replace: true });
      else setError("We could not check your sign-in. Please try again later.");
    });
    return () => { active = false; };
  }, [navigate]);

  function openVenue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = venue.trim();
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      setError("Enter the venue ID you were given.");
      return;
    }
    navigate(`/staff/${encodeURIComponent(id)}`);
  }

  return <PageShell title="Staff area"><div className="login">
    <h1>Staff area</h1>
    <p className="login-lede">Open a venue’s service workspace using the venue ID provided to you.</p>
    {error && <p role="alert">{error} <Link to="/login?next=%2Fstaff">Staff sign in</Link></p>}
    {ready && <form onSubmit={openVenue}>
      <Field label="Venue ID" value={venue} onChange={(event) => { setVenue(event.target.value); setError(""); }} required />
      <Button className="login-submit" type="submit">Open workspace</Button>
    </form>}
    <p><Link to="/">Back to home</Link></p>
  </div></PageShell>;
}
