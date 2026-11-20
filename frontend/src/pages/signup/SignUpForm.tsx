// THE sign-up form. Every page that creates an account renders this one component, so the pieces
// cannot drift apart again: first and last name side by side, email (a code is emailed), a password
// with its eye inside the field, the privacy consent with "What we store", then the emailed-code
// step with "Send a new code" (30 s wait), "Use a different email" and a way back to sign in.
// A page only says WHAT to call (register, verify), where to go next (onDone), its words (copy),
// its links and, if it truly needs them, extra fields (renderExtra).
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Badge, Button, Field, PasswordField } from "../../design/components";
import { FieldError } from "../../design/components/Field";
import { ProblemBox, listErrors } from "../account/FormProblem";
import { PrivacyText } from "../account/PrivacyText";
import { CodeResend } from "../CodeResend";
import { useSignUp } from "./useSignUp";
import type { UseSignUpOptions } from "./useSignUp";
import { MAX_NAME_PART, MIN_PASSWORD } from "./validate";
import "../account/account.css";
import "../login.css";
import "./signup.css";

export interface SignUpCopy {
  /** The form step's heading. null: the page draws its own (and keeps a switch under it). */
  title: string | null;
  /** One short line under the heading. */
  lede?: string | null;
  /** The code step's heading. */
  codeTitle?: string;
  /** The code step's first paragraph; gets the masked address, or the typed email. */
  codeLede?: (sentTo: string) => ReactNode;
}

interface SignUpFormProps<R, E extends object> extends UseSignUpOptions<R, E> {
  /** Makes the field ids unique per page, for example "reg" gives reg-first, reg-consent-error. */
  idPrefix: string;
  copy: SignUpCopy;
  /** 1 when this form owns the page's h1, 2 when the page already has one. */
  headingLevel?: 1 | 2;
  /** Under the buttons: "Already have an account? Sign in" and any other way out. */
  links?: ReactNode;
  /** false when the page already shows a sign-in switch above the form. */
  linksOnForm?: boolean;
  /** One short line under the name row, for a page that must say who sees the name (the invitation page). */
  nameHint?: ReactNode;
  /** Extra fields a page genuinely needs (for example "I need an accessible seat"). */
  renderExtra?: (extra: E, setExtra: (changes: Partial<E>) => void) => ReactNode;
}

const defaultCodeLede = (sentTo: string): ReactNode => (
  <>
    We sent a 6-digit code to <strong>{sentTo}</strong>. It works for 15 minutes. If you already have an account with this address, we sent a
    sign-in reminder instead.
  </>
);

export function SignUpForm<R, E extends object = object>({
  idPrefix,
  copy,
  headingLevel = 1,
  links,
  linksOnForm = true,
  renderExtra,
  nameHint,
  ...options
}: SignUpFormProps<R, E>) {
  const s = useSignUp<R, E>(options);
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(s.step);
  // Focus follows the step so a screen reader hears the new one: the heading, or the first field
  // when the page owns the form step's heading. Never on page load.
  useEffect(() => {
    if (previous.current === s.step) return;
    previous.current = s.step;
    if (heading.current) heading.current.focus();
    else document.getElementById(`${idPrefix}-first`)?.focus();
  }, [s.step, idPrefix]);

  const H = headingLevel === 1 ? "h1" : "h2";
  const titleClass = headingLevel === 1 ? "acc-title" : "acc-title su-h2";
  const id = (part: string): string => `${idPrefix}-${part}`;

  if (s.step === "code" && s.sent) {
    const problems = [...(s.codeError ? [s.codeError] : []), ...(s.general ? [s.general] : [])];
    const sentTo = s.sent.sentTo ?? s.values.email.trim();
    return (
      <div className="su">
        <H ref={heading} tabIndex={-1} className={titleClass}>
          {copy.codeTitle ?? "Check your email"}
        </H>
        <p className="su-text">{(copy.codeLede ?? defaultCodeLede)(sentTo)}</p>
        {s.sent.demoCode && <Badge tone="info">Demo only: your code is {s.sent.demoCode}</Badge>}
        <form className="su-form" onSubmit={(e) => void s.submitCode(e)} noValidate aria-label="Enter your code">
          <ProblemBox messages={problems} attempt={s.attempt} />
          <Field
            id={id("code")}
            label="Code"
            hint="6 digits"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={s.code}
            error={s.codeError}
            onChange={(e) => s.setCode(e.target.value)}
          />
          <Button type="submit" busy={s.verifying} disabled={s.busy} className="acc-submit">
            Create my account
          </Button>
          <CodeResend cooldown={s.cooldown} busy={s.busy} resent={s.resent} onResend={() => void s.resend()} onDifferentEmail={s.differentEmail} />
          {links && <div className="acc-links su-links">{links}</div>}
        </form>
      </div>
    );
  }

  const problems = [...listErrors(s.errors), ...(s.general ? [s.general] : [])];
  return (
    <div className="su">
      {copy.title && (
        <H ref={heading} tabIndex={-1} className={titleClass}>
          {copy.title}
        </H>
      )}
      {copy.lede && <p className="acc-lede">{copy.lede}</p>}
      <form className="su-form" onSubmit={(e) => void s.submitForm(e)} noValidate aria-label="Create your account">
        <ProblemBox messages={problems} attempt={s.attempt} />
        <div className="su-names">
          <Field
            id={id("first")}
            label="First name"
            name="firstName"
            autoComplete="given-name"
            required
            maxLength={MAX_NAME_PART}
            value={s.values.firstName}
            error={s.errors.firstName}
            onChange={(e) => s.setValue({ firstName: e.target.value })}
          />
          <Field
            id={id("last")}
            label="Last name"
            name="lastName"
            autoComplete="family-name"
            required
            maxLength={MAX_NAME_PART}
            value={s.values.lastName}
            error={s.errors.lastName}
            onChange={(e) => s.setValue({ lastName: e.target.value })}
          />
        </div>
        {nameHint && (
          <p id={id("name-hint")} className="field-hint su-name-hint">
            {nameHint}
          </p>
        )}
        <Field
          id={id("email")}
          label="Email"
          hint="We email you a code to check it is yours."
          type="email"
          name="email"
          autoComplete="email"
          required
          maxLength={254}
          value={s.values.email}
          error={s.errors.email}
          onChange={(e) => s.setValue({ email: e.target.value })}
        />
        <PasswordField
          id={id("password")}
          label="Password"
          hint={`At least ${MIN_PASSWORD} characters.`}
          name="password"
          autoComplete="new-password"
          required
          maxLength={200}
          value={s.values.password}
          error={s.errors.password}
          onChange={(e) => s.setValue({ password: e.target.value })}
        />
        {renderExtra?.(s.extra, s.setExtra)}
        <div className={`acc-consent ${s.errors.consent ? "field-invalid" : ""}`.trim()}>
          <div className="checkbox">
            <input
              id={id("consent")}
              type="checkbox"
              className="checkbox-input"
              required
              checked={s.values.consent}
              aria-invalid={s.errors.consent ? true : undefined}
              aria-describedby={s.errors.consent ? id("consent-error") : undefined}
              onChange={(e) => s.setValue({ consent: e.target.checked })}
            />
            <label htmlFor={id("consent")} className="checkbox-label">
              I agree that SeatPlan stores my details to manage bookings and seats and emails me about them. (required)
            </label>
          </div>
          {s.errors.consent && <FieldError id={id("consent-error")} message={s.errors.consent} />}
          <details className="acc-details">
            <summary>What we store</summary>
            <PrivacyText />
          </details>
        </div>
        <Button type="submit" busy={s.busy} className="acc-submit">
          Send my code
        </Button>
        {links && linksOnForm && <div className="acc-links su-links">{links}</div>}
      </form>
    </div>
  );
}
