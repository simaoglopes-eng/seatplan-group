// Route /account: one panel for the whole SeatPlan account (plan 2026-11-18, decision 5).
// Signed out: Sign in (POST /account/login) or Create account (?mode=create).
// Signed in: who it is, Sign out (both sessions), and a Booking | Staff switch (?tab=staff).
// Either half can be missing: a work-only sign-in has no bookings, a guest-only one no staff
// tools. Each side then says why and offers the right sign-in, instead of sending the person away.
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AccountSessions } from "../../api/account";
import { accountSignOut, getAccountWork } from "../../api/account";
import { getGuestToken, getSessionToken } from "../../api/client";
import { getMyAccount } from "../../api/guest";
import { Button, PageShell, useToast } from "../../design/components";
import { PublicHeaderActions } from "../discover/PublicHeaderActions";
import { AuthPhoto } from "../Login";
import { AccountRegister } from "./AccountRegister";
import { AccountSignIn } from "./AccountSignIn";
import { BookingPanel } from "./BookingPanel";
import { StaffPanel } from "./StaffPanel";
import { useLoad } from "../restaurant/useLoad";
import "../account/account.css";
import "../discover/discover.css";
import "../discover/dinerAccount.css";
import "../events-public/events-public.css";
import "./your-account.css";

interface Signed {
  guest: boolean;
  work: boolean;
}

const readSessions = (): Signed => ({ guest: getGuestToken() !== null, work: getSessionToken() !== null });

export default function YourAccountPage() {
  const [signed, setSigned] = useState<Signed>(readSessions);
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // The address the header shows, so the Staff side can say when its sign-in is someone else's.
  const [shownEmail, setShownEmail] = useState<string | null>(null);
  const refresh = useCallback(() => setSigned(readSessions()), []);
  const setParam = (key: string, value: string | null): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const signedIn = (sessions: AccountSessions): void => {
    const name = sessions.guest?.account.name ?? sessions.work?.user.name;
    if (name) toast.show(`Welcome, ${name}.`, "success");
    setParam("mode", null);
    refresh();
  };
  const signOut = async (): Promise<void> => {
    setBusy(true);
    await accountSignOut();
    setBusy(false);
    toast.show("You are signed out.", "success");
    refresh();
  };

  const anySession = signed.guest || signed.work;
  const create = params.get("mode") === "create";
  const tab = params.get("tab") === "staff" ? "staff" : "booking";
  // Signed out, the forms sit in a glass panel over the terrace photo (direction E, like /login).
  const Frame = anySession ? PlainFrame : AuthPhoto;
  return (
    <Frame compact={create}>
    <div className="discover-route">
      <PageShell title={anySession ? "My account" : create ? "Create your account" : "Sign in"} width="wide" variant={anySession ? "default" : "overlay"} headerActions={<PublicHeaderActions />}>
        <div className="ya-page">
          {!anySession ? (
            <div className="ya-signed-out auth-content acc-solo">
              <h1 className="acc-title">{create ? "Create your account" : "Sign in to SeatPlan"}</h1>
              <p className="acc-lede">One account for bookings and for work.</p>
              <div className="discover-view-switch ya-switch" role="group" aria-label="Sign in or create an account">
                <Button variant={!create ? "primary" : "secondary"} aria-pressed={!create} onClick={() => setParam("mode", null)}>
                  Sign in
                </Button>
                <Button variant={create ? "primary" : "secondary"} aria-pressed={create} onClick={() => setParam("mode", "create")}>
                  Create account
                </Button>
              </div>
              {create ? (
                <AccountRegister onCreated={signedIn} />
              ) : (
                <AccountSignIn
                  onSignedIn={signedIn}
                  links={
                    <>
                      <Link to="/account?mode=create">Create an account</Link>
                      <Link to="/my/forgot">Forgot your password?</Link>
                    </>
                  }
                />
              )}
            </div>
          ) : (
            <>
              <WhoBar signed={signed} busy={busy} onSignOut={() => void signOut()} onWho={setShownEmail} />
              <div className="discover-view-switch ya-switch" role="group" aria-label="Account side">
                <Button variant={tab === "booking" ? "primary" : "secondary"} aria-pressed={tab === "booking"} onClick={() => setParam("tab", null)}>
                  Booking
                </Button>
                <Button variant={tab === "staff" ? "primary" : "secondary"} aria-pressed={tab === "staff"} onClick={() => setParam("tab", "staff")}>
                  Staff
                </Button>
              </div>
              {tab === "booking" &&
                (signed.guest ? (
                  <BookingPanel onSessionGone={refresh} />
                ) : (
                  <MissingSide
                    title="Your bookings are on the personal side of your account"
                    text="This sign-in opened your staff tools only. Sign in with the email and password you book with to see your bookings and event seats."
                    onSignedIn={signedIn}
                  />
                ))}
              {tab === "staff" &&
                (signed.work ? (
                  <StaffPanel onSessionGone={refresh} shownEmail={signed.guest ? shownEmail : null} />
                ) : (
                  <MissingSide
                    title="Sign in again to open your staff tools"
                    text="Your staff tools need the work side of your account, which this sign-in did not open (or it has ended). Sign in again with your password. If no restaurant or venue has added your email to its team yet, there is nothing to run here. A team opens staff tools only for an account made on this page, or one whose email an emailed code confirmed: a code shown on screen in the demo confirms nothing."
                    onSignedIn={signedIn}
                  />
                ))}
            </>
          )}
        </div>
      </PageShell>
    </div>
    </Frame>
  );
}

// `compact` (the sign-up view) only matters on the photo: its page chrome is tighter there, so the whole form fits one screen.
function PlainFrame({ children }: { children: ReactNode; compact?: boolean }) {
  return <>{children}</>;
}

/** Who is signed in, from whichever half is open, and Sign out for both. */
function WhoBar({ signed, busy, onSignOut, onWho }: { signed: Signed; busy: boolean; onSignOut: () => void; onWho: (email: string | null) => void }) {
  const me = useLoad<{ name: string; email: string }>(
    () => (signed.guest ? getMyAccount().then((m) => m.account) : getAccountWork().then((w) => w.user)),
    `${signed.guest}-${signed.work}`,
  );
  const who = me.state.status === "ready" ? me.state.data : null;
  const whoEmail = who?.email ?? null;
  useEffect(() => onWho(whoEmail), [whoEmail, onWho]);
  return (
    <header className="ya-who">
      <div>
        <h1 className="acc-title">{who ? who.name : "My account"}</h1>
        <p className="acc-lede">{who ? who.email : "Signed in"}</p>
      </div>
      <Button variant="secondary" busy={busy} onClick={onSignOut}>
        Sign out
      </Button>
    </header>
  );
}

function MissingSide({ title, text, onSignedIn }: { title: string; text: string; onSignedIn: (sessions: AccountSessions) => void }) {
  return (
    <section className="ya-missing" aria-labelledby="ya-missing-title">
      <h2 id="ya-missing-title">{title}</h2>
      <p>{text}</p>
      <AccountSignIn onSignedIn={onSignedIn} submitLabel="Sign in again" links={<Link to="/my/forgot">Forgot your password?</Link>} />
    </section>
  );
}
