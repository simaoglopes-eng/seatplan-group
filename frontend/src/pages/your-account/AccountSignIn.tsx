// One sign-in for both halves of a SeatPlan account (POST /account/login). Used on /account
// and on /events/staff. The answer carries the sessions this password opens; api/account.ts
// keeps exactly those and forgets any other left in the tab.
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { accountLogin } from "../../api/account";
import type { AccountSessions } from "../../api/account";
import { Button, Field, PasswordField } from "../../design/components";
import { ProblemBox, asApiError } from "../account/FormProblem";

/** Wrong email and wrong password get the same words, so nobody learns who has an account. */
function messageFor(error: unknown): string {
  const apiError = asApiError(error);
  if (apiError.code === "unauthorised") return "Email or password is not correct.";
  if (apiError.code === "rate_limited") return "Too many attempts. Please wait a minute and try again.";
  return apiError.message;
}

interface Props {
  onSignedIn: (sessions: AccountSessions) => void;
  /** Links under the button, such as "Create an account". */
  links?: ReactNode;
  submitLabel?: string;
}

export function AccountSignIn({ onSignedIn, links, submitLabel = "Sign in" }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setAttempt((n) => n + 1);
    if (email.trim() === "" || password === "") {
      setProblem("Enter your email and your password.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const sessions = await accountLogin(email.trim(), password);
      setBusy(false);
      onSignedIn(sessions);
    } catch (error) {
      setProblem(messageFor(error));
      setBusy(false);
    }
  };

  return (
    <form className="acc-form" onSubmit={(e) => void onSubmit(e)} noValidate aria-label="Sign in">
      <ProblemBox messages={problem ? [problem] : []} attempt={attempt} />
      <Field label="Email" type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <PasswordField
        id="account-password"
        label="Password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button type="submit" busy={busy} className="acc-submit">
        {submitLabel}
      </Button>
      {links && <div className="acc-links">{links}</div>}
    </form>
  );
}
