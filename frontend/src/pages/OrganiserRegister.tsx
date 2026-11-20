import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { request, setSessionToken } from "../api/client";
import { AuthLayout, Button, Field, PageShell } from "../design/components";
import "./login.css";

type CodeResponse = { signup_id: string; sent_to: string };
type SessionResponse = { token: string };

export default function OrganiserRegister() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<CodeResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      if (!pending) {
        if (!name.trim() || password.length < 10) throw new Error("Enter your name and a password of at least 10 characters.");
        setPending(await request<CodeResponse>("POST", "/auth/register", { name: name.trim(), email: email.trim(), password }, "none"));
        setPassword("");
      } else {
        const result = await request<SessionResponse>("POST", "/auth/verify", { email: email.trim(), code, signup_id: pending.signup_id }, "none");
        setSessionToken(result.token); navigate("/organiser");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  }
  return <PageShell title="Create an organiser account"><AuthLayout eyebrow="FOR ORGANISERS" headline="A place for every detail." description="Set up your event, shape the room and make it easy for everyone to find their seat."><div className="login">
    <h1>{pending ? "Check your email" : "Create your organiser account"}</h1>
    <p className="login-lede">{pending ? `If this address can be registered, a verification code will be sent to ${pending.sent_to}. Email delivery must be configured for the code to arrive.` : "Create an account to plan and manage your events."}</p>
    <form onSubmit={submit}>
      {!pending ? <><Field label="Name" name="name" autoComplete="name" required value={name} onChange={e => setName(e.target.value)} /><Field label="Email" name="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /><Field label="Password" name="password" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={e => setPassword(e.target.value)} /></> : <Field label="Verification code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={code} onChange={e => setCode(e.target.value)} />}
      {error && <p role="alert">{error}</p>}
      <Button type="submit" busy={busy} className="login-submit">{pending ? "Verify email" : "Continue"}</Button>
    </form>
    <p><Link to="/login">Already have an account? Sign in</Link></p>
  </div></AuthLayout></PageShell>;
}
