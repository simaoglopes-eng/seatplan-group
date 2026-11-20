import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { request, setSessionToken } from "../api/client";
import { AuthLayout, Button, Field, PageShell } from "../design/components";
import { PublicHeaderActions } from "./discover/PublicHeaderActions";
import { CodeResend, useCooldown } from "./CodeResend";
import { AuthPhoto } from "./Login";
import "./login.css";

/**
 * Where to go once the account is verified: ?next= when it is a path on this site
 * (starts with "/", not "//" and no backslash, which browsers read as "//"), else the
 * organiser space. So /organiser?new=1 survives sign-up, and a link cannot send the
 * new organiser to another site.
 */
export function registerNext(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) return next;
  return "/organiser";
}

type CodeResponse = { signup_id: string; sent_to: string };
type SessionResponse = { token: string };

export default function OrganiserRegister() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<CodeResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [cooldown, startCooldown] = useCooldown();

  // The password stays in memory until the account exists, so a new code can be sent.
  async function sendCode(): Promise<void> {
    setPending(await request<CodeResponse>("POST", "/auth/register", { name: name.trim(), email: email.trim(), password }, "none"));
    startCooldown();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      if (!pending) {
        if (!name.trim() || password.length < 10) throw new Error("Enter your name and a password of at least 10 characters.");
        await sendCode();
      } else {
        const result = await request<SessionResponse>("POST", "/auth/verify", { email: email.trim(), code, signup_id: pending.signup_id }, "none");
        setPassword("");
        setSessionToken(result.token); navigate(registerNext(params.get("next")));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  }

  async function resend() {
    setError(""); setBusy(true);
    try { await sendCode(); setCode(""); setResent(true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again."); }
    finally { setBusy(false); }
  }

  function differentEmail() {
    setPending(null); setCode(""); setPassword(""); setError(""); setResent(false); startCooldown(0);
  }
  return <AuthPhoto><PageShell title="Create an organiser account" variant="overlay" headerActions={<PublicHeaderActions />}><AuthLayout eyebrow="FOR ORGANISERS" headline="A place for every detail." description="Set up your event, shape the room and make it easy for everyone to find their seat."><div className="login">
    <h1>{pending ? "Check your email" : "Create your organiser account"}</h1>
    <p className="login-lede">{pending ? `If this address can be registered, a verification code will be sent to ${pending.sent_to}. Email delivery must be configured for the code to arrive.` : "Create an account to plan and manage your events."}</p>
    <form onSubmit={submit}>
      {!pending ? <><Field label="Name" name="name" autoComplete="name" required value={name} onChange={e => setName(e.target.value)} /><Field label="Email" name="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /><Field label="Password" name="password" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={e => setPassword(e.target.value)} /></> : <Field label="Verification code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={code} onChange={e => setCode(e.target.value)} />}
      {error && <p className="login-error" role="alert">{error}</p>}
      <Button type="submit" busy={busy} className="login-submit">{pending ? "Verify email" : "Continue"}</Button>
      {pending && <CodeResend cooldown={cooldown} busy={busy} resent={resent} onResend={() => void resend()} onDifferentEmail={differentEmail} />}
    </form>
    <p><Link to={params.get("next") ? `/login?next=${encodeURIComponent(registerNext(params.get("next")))}` : "/login"}>Already have an account? Sign in</Link></p>
  </div></AuthLayout></PageShell></AuthPhoto>;
}
