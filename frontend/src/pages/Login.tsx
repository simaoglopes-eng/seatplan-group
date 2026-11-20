// Organiser and staff sign-in. On success the session token is stored by
// api/client.ts and we go back to where the person came from (?next=...).
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, login } from "../api/client";
import { AuthLayout, Button, Field, PageShell, useToast } from "../design/components";
import "./login.css";

/** Only allow in-app paths after login, so a link cannot send people to another site. */
export function safeNextPath(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}

function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong. Please try again.";
  if (error.code === "unauthorised" || error.code === "not_found") return "That email and password do not match an account.";
  if (error.code === "rate_limited") return "Too many attempts. Please wait a minute and try again.";
  return error.message;
}

export default function Login({ defaultNext = "/organiser" }: { defaultNext?: string } = {}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isStaff = params.get("next") === "/staff";
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (email.trim() === "" || password === "") {
      setError("Enter your email and your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await login(email.trim(), password);
      toast.show(`Welcome back, ${result.user.name}.`, "success");
      navigate(safeNextPath(params.get("next") ?? defaultNext));
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell title="Sign in">
      <AuthLayout eyebrow={isStaff ? "STAFF ACCESS" : "FOR ORGANISERS"} headline="Plan the details. Enjoy the moment." description="Bring your event together with a seating plan that feels effortless to manage.">
      <div className="login">
        <h1>{isStaff ? "Staff sign in" : "Organiser sign in"}</h1>
        <p className="login-lede">
          {isStaff ? "Sign in to open your staff workspace." : "Sign in to manage your events and seating plans."} Are you attending an event? <Link to="/my/sign-in">Participant sign in</Link>.
        </p>
        <form onSubmit={onSubmit} noValidate>
          <Field label="Email" type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error}
          />
          <Button type="submit" busy={busy} className="login-submit">
            Sign in
          </Button>
        </form>
        {!isStaff && <p>New to SeatPlan? <Link to="/organiser/register">Create an organiser account</Link>.</p>}
      </div>
      </AuthLayout>
    </PageShell>
  );
}
