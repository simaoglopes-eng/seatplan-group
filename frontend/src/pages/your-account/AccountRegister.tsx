// Create a SeatPlan account (plan 2026-11-18, decision 5): one sign-up for bookings and work.
// Two steps, like the shared link's sign-up (pages/join/RegisterPage.tsx):
// 1. name, email, password, consent -> POST /account/register (the same 202 answer whether
//    or not the address already has an account; in the demo, example.com codes are shown);
// 2. the 6-digit code -> POST /guest/verify, which signs in. api/account.ts keeps the work
//    session that comes back, or asks /account/login for it with the same password.
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { accountRegister, verifyAccount } from "../../api/account";
import type { AccountSessions } from "../../api/account";
import type { CodeSent } from "../../api/guest";
import { Badge, Button, Field } from "../../design/components";
import { FieldError } from "../../design/components/Field";
import { ProblemBox, asApiError, listErrors, splitFieldMessage } from "../account/FormProblem";
import type { FieldErrors } from "../account/FormProblem";
import { PasswordToggle } from "../account/PasswordToggle";
import { PrivacyText } from "../account/PrivacyText";
import { MIN_PASSWORD, validateRegister } from "../join/RegisterPage";

const FIELDS = ["name", "email", "password", "consent"] as const;
const RESEND_SECONDS = 30;

interface Values {
  name: string;
  email: string;
  password: string;
  consent: boolean;
}

export function AccountRegister({ onCreated }: { onCreated: (sessions: AccountSessions) => void }) {
  const [values, setValues] = useState<Values>({ name: "", email: "", password: "", consent: false });
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  // The code step's heading takes focus when it appears, so a screen reader hears the new step.
  useEffect(() => {
    if (sent) heading.current?.focus();
  }, [sent]);

  const sendCode = async (): Promise<void> => {
    setBusy(true);
    setGeneral(null);
    try {
      setSent(await accountRegister({ name: values.name.trim(), email: values.email.trim(), password: values.password, consent: true }));
      setCooldown(RESEND_SECONDS);
    } catch (error) {
      const apiError = asApiError(error);
      const { field, text } = apiError.code === "validation" ? splitFieldMessage(apiError.message, FIELDS) : { field: null, text: apiError.message };
      if (field) setErrors((current) => ({ ...current, [field]: text }));
      else setGeneral(text);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setAttempt((n) => n + 1);
    const found = validateRegister({ ...values, needsAccessible: false });
    // The event sign-up's consent words mention a seat; this account's are below.
    if (found.consent) found.consent = "Tick the box to agree, so we can store your details and email you about your bookings.";
    setErrors(found);
    setGeneral(null);
    if (listErrors(found).length > 0) return;
    await sendCode();
  };

  if (sent) {
    return (
      <CodeStep
        headingRef={heading}
        sent={sent}
        email={values.email.trim()}
        password={values.password}
        cooldown={cooldown}
        busyResend={busy}
        problem={general}
        onResend={() => void sendCode()}
        onDifferentEmail={() => {
          setSent(null);
          setValues((v) => ({ ...v, password: "" }));
          setGeneral(null);
        }}
        onCreated={onCreated}
      />
    );
  }
  const problems = [...listErrors(errors), ...(general ? [general] : [])];
  return (
    <form className="acc-form" onSubmit={(e) => void onSubmit(e)} noValidate aria-label="Create your account">
      <p className="acc-lede">One account to book tables and event seats, and to work at the restaurants and venues that add you to their team.</p>
      <ProblemBox messages={problems} attempt={attempt} />
      <Field label="Your name" name="name" autoComplete="name" required maxLength={120} value={values.name} error={errors.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />
      <Field
        label="Email"
        hint="We email you a code to check it is yours."
        type="email"
        name="email"
        autoComplete="email"
        required
        maxLength={254}
        value={values.email}
        error={errors.email}
        onChange={(e) => setValues({ ...values, email: e.target.value })}
      />
      <div className="acc-password">
        <Field
          id="account-new-password"
          label="Password"
          hint={`At least ${MIN_PASSWORD} characters.`}
          type={shown ? "text" : "password"}
          name="password"
          autoComplete="new-password"
          required
          maxLength={200}
          value={values.password}
          error={errors.password}
          onChange={(e) => setValues({ ...values, password: e.target.value })}
        />
        <PasswordToggle shown={shown} controls="account-new-password" onToggle={() => setShown((v) => !v)} />
      </div>
      <div className={`acc-consent ${errors.consent ? "field-invalid" : ""}`.trim()}>
        <div className="checkbox">
          <input
            id="account-consent"
            type="checkbox"
            className="checkbox-input"
            required
            checked={values.consent}
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? "account-consent-error" : undefined}
            onChange={(e) => setValues({ ...values, consent: e.target.checked })}
          />
          <label htmlFor="account-consent" className="checkbox-label">
            I agree that SeatPlan stores my details to manage my bookings and seats and emails me about them. (required)
          </label>
        </div>
        {errors.consent && <FieldError id="account-consent-error" message={errors.consent} />}
        <details className="acc-details">
          <summary>What we store</summary>
          <PrivacyText />
        </details>
      </div>
      <Button type="submit" busy={busy} className="acc-submit">
        Send my code
      </Button>
    </form>
  );
}

interface CodeStepProps {
  headingRef: React.RefObject<HTMLHeadingElement>;
  sent: CodeSent;
  email: string;
  password: string;
  cooldown: number;
  busyResend: boolean;
  problem: string | null;
  onResend: () => void;
  onDifferentEmail: () => void;
  onCreated: (sessions: AccountSessions) => void;
}

function CodeStep({ headingRef, sent, email, password, cooldown, busyResend, problem, onResend, onDifferentEmail, onCreated }: CodeStepProps) {
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [general, setGeneral] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setTries((n) => n + 1);
    setGeneral(null);
    if (!/^[0-9]{6}$/.test(code)) {
      setCodeError("Enter the 6 digits from the email.");
      return;
    }
    setCodeError(null);
    setBusy(true);
    try {
      const sessions = await verifyAccount(email, code, sent.signup_id ?? "", password);
      onCreated(sessions);
    } catch (error) {
      const apiError = asApiError(error);
      if (apiError.code === "validation" || apiError.code === "not_found") setCodeError(apiError.message);
      else setGeneral(apiError.code === "conflict" ? "Please try again." : apiError.message);
      setBusy(false);
    }
  };

  const problems = [...(codeError ? [codeError] : []), ...(general ? [general] : []), ...(problem ? [problem] : [])];
  return (
    <form className="acc-form" onSubmit={(e) => void onSubmit(e)} noValidate aria-labelledby="account-code-title">
      <h2 id="account-code-title" ref={headingRef} tabIndex={-1} className="ya-form-title">
        Check your email
      </h2>
      <p>
        We sent a 6-digit code to <strong>{sent.sent_to}</strong>. It works for 15 minutes. If you already have an account with this address, we
        sent a sign-in reminder instead.
      </p>
      {sent.demo_code && <Badge tone="info">Demo only: your code is {sent.demo_code}</Badge>}
      <ProblemBox messages={problems} attempt={tries} />
      <Field
        label="Code"
        hint="6 digits"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={code}
        error={codeError}
        onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
      />
      <Button type="submit" busy={busy} className="acc-submit">
        Create my account
      </Button>
      <div className="acc-links">
        <Button variant="ghost" disabled={cooldown > 0} busy={busyResend} onClick={onResend}>
          Send a new code
          {cooldown > 0 && <span aria-hidden="true"> (in {cooldown} s)</span>}
        </Button>
        <Button variant="ghost" onClick={onDifferentEmail}>
          Use a different email
        </Button>
      </div>
    </form>
  );
}
