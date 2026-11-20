import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { verifyCode, type CodeSent } from "../../api/guest";
import { AuthLayout, Button, Checkbox, Field, PageShell } from "../../design/components";
import { PrivacyText } from "./PrivacyText";
import { PublicHeaderActions } from "../discover/PublicHeaderActions";
import { AuthPhoto } from "../Login";
import { CodeResend, useCooldown } from "../CodeResend";
import "../login.css";
import "./account.css";

export default function ParticipantRegisterPage() {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<CodeSent | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [cooldown, startCooldown] = useCooldown();

  // The password stays in memory until the account exists, so a new code can be sent.
  async function sendCode(): Promise<void> {
    setPending(await api.post<CodeSent>("/guest/register", { name: `${firstName.trim()} ${lastName.trim()}`, email: email.trim(), password, needs_accessible: false, consent: true }, "none"));
    startCooldown();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      if (!pending) {
        if (!firstName.trim() || !lastName.trim() || password.length < 10 || !consent) throw new Error("Enter your name, use a password of at least 10 characters and agree to the privacy notice.");
        await sendCode();
      } else {
        await verifyCode(email.trim(), code, pending.signup_id ?? "");
        setPassword("");
        navigate("/my");
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again."); }
    finally { setBusy(false); }
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
  return <AuthPhoto><PageShell title="Create a participant account" variant="overlay" headerActions={<PublicHeaderActions />}><AuthLayout eyebrow="FOR PARTICIPANTS" headline="Your invitation, all in one place." description="Find your event, choose a seat and keep the details close at hand."><div className="login">
    <h1>{pending ? "Check your email" : "Create your participant account"}</h1>
    <p className="login-lede">{pending ? `If this address can be registered, a verification code will be sent to ${pending.sent_to}. Email delivery must be configured for the code to arrive.` : "Create an account now, then open an event invitation to choose your seat."}</p>
    <form onSubmit={submit}>
      {!pending ? <><Field label="First name" name="firstName" autoComplete="given-name" required value={firstName} onChange={e => setFirstName(e.target.value)} /><Field label="Last name" name="lastName" autoComplete="family-name" required value={lastName} onChange={e => setLastName(e.target.value)} /><Field label="Email" name="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /><Field label="Password" name="password" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={e => setPassword(e.target.value)} /><PrivacyText /><Checkbox label="I agree to the privacy notice" checked={consent} onChange={e => setConsent(e.target.checked)} /></> : <Field label="Verification code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={code} onChange={e => setCode(e.target.value)} />}
      {error && <p role="alert" className="login-error">{error}</p>}
      <Button type="submit" busy={busy} className="login-submit">{pending ? "Verify email" : "Continue"}</Button>
      {pending && <CodeResend cooldown={cooldown} busy={busy} resent={resent} onResend={() => void resend()} onDifferentEmail={differentEmail} />}
    </form>
    <p><Link to="/my/sign-in">Already have an account? Sign in</Link></p>
  </div></AuthLayout></PageShell></AuthPhoto>;
}
