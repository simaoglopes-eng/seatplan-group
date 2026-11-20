import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { verifyCode, type CodeSent } from "../../api/guest";
import { AuthLayout, Button, Checkbox, Field, PageShell } from "../../design/components";
import { PrivacyText } from "./PrivacyText";
import "../login.css";

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      if (!pending) {
        if (!firstName.trim() || !lastName.trim() || password.length < 10 || !consent) throw new Error("Enter your name, use a password of at least 10 characters and agree to the privacy notice.");
        setPending(await api.post<CodeSent>("/guest/register", { name: `${firstName.trim()} ${lastName.trim()}`, email: email.trim(), password, needs_accessible: false, consent: true }, "none"));
        setPassword("");
      } else {
        await verifyCode(email.trim(), code, pending.signup_id ?? "");
        navigate("/my");
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again."); }
    finally { setBusy(false); }
  }
  return <PageShell title="Create a participant account"><AuthLayout eyebrow="FOR PARTICIPANTS" headline="Your invitation, all in one place." description="Find your event, choose a seat and keep the details close at hand."><div className="login">
    <h1>{pending ? "Check your email" : "Create your participant account"}</h1>
    <p className="login-lede">{pending ? `If this address can be registered, a verification code will be sent to ${pending.sent_to}. Email delivery must be configured for the code to arrive.` : "Create an account now, then open an event invitation to choose your seat."}</p>
    <form onSubmit={submit}>
      {!pending ? <><Field label="First name" name="firstName" autoComplete="given-name" required value={firstName} onChange={e => setFirstName(e.target.value)} /><Field label="Last name" name="lastName" autoComplete="family-name" required value={lastName} onChange={e => setLastName(e.target.value)} /><Field label="Email" name="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /><Field label="Password" name="password" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={e => setPassword(e.target.value)} /><PrivacyText /><Checkbox label="I agree to the privacy notice" checked={consent} onChange={e => setConsent(e.target.checked)} /></> : <Field label="Verification code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={code} onChange={e => setCode(e.target.value)} />}
      {error && <p role="alert">{error}</p>}
      <Button type="submit" busy={busy} className="login-submit">{pending ? "Verify email" : "Continue"}</Button>
    </form>
    <p><Link to="/my/sign-in">Already have an account? Sign in</Link></p>
  </div></AuthLayout></PageShell>;
}
