// The state machine behind every sign-up form (SignUpForm.tsx): the form step, the emailed-code step,
// "send a new code" with its wait, and "use a different email". It knows nothing about any one
// endpoint: the page passes `register` (builds the payload and calls the server) and `verify`.
import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../api/client";
import { splitFieldMessage } from "../account/FormProblem";
import type { FieldErrors } from "../account/FormProblem";
import { listErrors } from "../account/FormProblem";
import { useCooldown } from "../CodeResend";
import { joinName, validateSignUp } from "./validate";
import type { SignUpValues } from "./validate";

/** What every register endpoint answers with, normalised by the page's `register` function. */
export interface CodeSentInfo {
  /** Goes back with the code: a code read out to someone else cannot finish this sign-up. */
  signupId: string;
  /** The masked address, when the server says one; else the form falls back to the typed email. */
  sentTo?: string;
  /** Only in the demo, and only when the server sends it. */
  demoCode?: string;
}

/** What `register` receives: the trimmed values, the joined name, and the page's own extra fields. */
export interface SignUpInput<E extends object = object> {
  firstName: string;
  lastName: string;
  /** `${firstName} ${lastName}`, for the endpoints that take one "name". */
  name: string;
  email: string;
  password: string;
  extra: E;
}

export interface VerifyInput {
  email: string;
  code: string;
  /** From the NEWEST register answer, so a code from an older send is refused. */
  signupId: string;
  password: string;
}

export interface UseSignUpOptions<R, E extends object> {
  register: (input: SignUpInput<E>) => Promise<CodeSentInfo>;
  verify: (input: VerifyInput) => Promise<R>;
  onDone: (result: R) => void;
  initialExtra?: E;
}

const FIELD_KEYS = ["name", "firstName", "lastName", "email", "password", "consent"] as const;
const EMPTY: SignUpValues = { firstName: "", lastName: "", email: "", password: "", consent: false };

function problemOf(error: unknown): { code: string; message: string } {
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  return { code: "unknown", message: error instanceof Error && error.message ? error.message : "Something unexpected happened. Please try again." };
}

export function useSignUp<R, E extends object = object>({ register, verify, onDone, initialExtra }: UseSignUpOptions<R, E>) {
  const [values, setValues] = useState<SignUpValues>(EMPTY);
  const [extra, setExtraState] = useState<E>((initialExtra ?? {}) as E);
  const [sent, setSent] = useState<CodeSentInfo | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [cooldown, startCooldown] = useCooldown();
  const [resent, setResent] = useState(false);
  const [code, setCodeState] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const setValue = (changes: Partial<SignUpValues>): void => setValues((current) => ({ ...current, ...changes }));
  const setExtra = (changes: Partial<E>): void => setExtraState((current) => ({ ...current, ...changes }));
  const setCode = (next: string): void => setCodeState(next.replace(/\s/g, ""));

  /** Sends the register call. On the form step a server message that names a field sits beside it. */
  const sendCode = async (where: "form" | "resend"): Promise<boolean> => {
    setBusy(true);
    setGeneral(null);
    try {
      const answer = await register({
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        name: joinName(values.firstName, values.lastName),
        email: values.email.trim(),
        password: values.password,
        extra,
      });
      setSent(answer);
      startCooldown();
      return true;
    } catch (error) {
      const { code: kind, message } = problemOf(error);
      const split = where === "form" && kind === "validation" ? splitFieldMessage(message, FIELD_KEYS) : { field: null, text: message };
      const field = split.field === "name" ? "firstName" : split.field;
      if (field) setErrors((current) => ({ ...current, [field]: split.text }));
      else setGeneral(split.text);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitForm = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setAttempt((n) => n + 1);
    const found = validateSignUp(values);
    setErrors(found);
    setGeneral(null);
    if (listErrors(found).length > 0) return;
    await sendCode("form");
  };

  const submitCode = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    // Not while a new code is on its way: the old code would go with an id the server is about to retire.
    if (busy || verifying) return;
    setAttempt((n) => n + 1);
    setGeneral(null);
    if (!sent) return;
    if (!/^[0-9]{6}$/.test(code)) {
      setCodeError("Enter the 6 digits from the email.");
      return;
    }
    setCodeError(null);
    setVerifying(true);
    try {
      const result = await verify({ email: values.email.trim(), code, signupId: sent.signupId, password: values.password });
      // The account exists: the password has done its job.
      setValues((current) => ({ ...current, password: "" }));
      onDone(result);
    } catch (error) {
      const { code: kind, message } = problemOf(error);
      // A wrong or expired code belongs to the code field; anything else goes in the box on top.
      if (kind === "validation" || kind === "not_found") setCodeError(message);
      else setGeneral(kind === "conflict" ? "Please try again." : message);
      setVerifying(false);
    }
  };

  /** A new code replaces the old one: the newest signup_id is the only one that works. */
  const resend = async (): Promise<void> => {
    if (busy || verifying) return;
    setAttempt((n) => n + 1);
    setCodeError(null);
    if (await sendCode("resend")) {
      setCodeState("");
      setResent(true);
    }
  };

  /** Back to the form with everything kept except the password, which the person types again. */
  const differentEmail = (): void => {
    setSent(null);
    setValues((current) => ({ ...current, password: "" }));
    setErrors({});
    setGeneral(null);
    setCodeState("");
    setCodeError(null);
    setResent(false);
    startCooldown(0);
  };

  return {
    step: sent ? ("code" as const) : ("form" as const),
    values,
    setValue,
    extra,
    setExtra,
    sent,
    errors,
    general,
    attempt,
    busy,
    cooldown,
    resent,
    code,
    setCode,
    codeError,
    verifying,
    submitForm,
    submitCode,
    resend,
    differentEmail,
  };
}
