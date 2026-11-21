import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { accountSignOut } from "../../api/account";
import { getGuestToken } from "../../api/client";
import { Button, PageShell, useToast } from "../../design/components";
import { SignInForm } from "../account/SignInForm";
import "../account/account.css";
import { DinerDashboard } from "./DinerDashboard";

export default function DinerAccountPage() {
  const [signedIn, setSignedIn] = useState(() => Boolean(getGuestToken()));
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { state } = useLocation();
  const reviewSlug = typeof state?.reviewSlug === "string" ? state.reviewSlug : "";
  const toast = useToast();

  async function signOut() {
    setBusy(true);
    try {
      // Both sessions of the tab, as on /account: never leave the work one open for the next person.
      await accountSignOut();
    } finally {
      setSignedIn(false);
      setBusy(false);
    }
  }

  return (
    <PageShell title={signedIn ? "My account" : "Log in"} restaurantBrand>
      <div className={`acc-page${signedIn ? " acc-wide" : ""}`}>
        <p className="acc-links">
          <Link to="/">Back to restaurants</Link>
          <Link to="/account">Your whole account: bookings and staff</Link>
        </p>
        <h1 className="acc-title">{signedIn ? "My account" : "Log in to SeatPlan"}</h1>
        {signedIn ? (
          <>
          <DinerDashboard />
          <Button variant="secondary" busy={busy} onClick={() => void signOut()}>Sign out</Button>
          </>
        ) : (
          <SignInForm
            onSignedIn={({ account }) => {
              toast.show(`Welcome back, ${account.name}.`, "success");
              setSignedIn(true);
              if (reviewSlug) navigate(`/restaurants/${encodeURIComponent(reviewSlug)}#reviews`, { replace: true });
              else if (typeof state?.returnTo === "string" && /^\/restaurants\/[^/?#]+$/.test(state.returnTo)) navigate(state.returnTo, { replace: true });
            }}
            links={<Link to="/my/forgot">Forgot your password?</Link>}
          />
        )}
      </div>
    </PageShell>
  );
}
