// The one set of sign-up checks: every form that creates an account asks the same of the visitor
// and says the same words when something is missing. The server checks everything again.
import { looksLikeEmail } from "../account/FormProblem";
import type { FieldErrors } from "../account/FormProblem";

/** The same rule as the server (section 6.2). */
export const MIN_PASSWORD = 10;
/** First plus last name are joined with a space for the endpoints that take one "name" (max 120). */
export const MAX_NAME_PART = 59;

export interface SignUpValues {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  consent: boolean;
}

/** `${first} ${last}`, trimmed: the single "name" the older endpoints take. */
export function joinName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.trim();
}

/** Checks the form before it is sent. A null or missing entry means "no problem". */
export function validateSignUp(values: SignUpValues): FieldErrors {
  const email = values.email.trim();
  return {
    firstName: values.firstName.trim() === "" ? "Enter your first name." : null,
    lastName: values.lastName.trim() === "" ? "Enter your last name." : null,
    email: email === "" ? "Enter your email address." : looksLikeEmail(email) ? null : "Enter an email address like name@example.com.",
    password:
      values.password.length < MIN_PASSWORD
        ? `Use at least ${MIN_PASSWORD} characters.`
        : values.password.trim().toLowerCase() === email.toLowerCase()
          ? "Choose a password that is not your email address."
          : null,
    consent: values.consent ? null : "Tick the box to agree, so we can store your details and email you about them.",
  };
}
