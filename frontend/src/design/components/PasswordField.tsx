// A password input with a show/hide eye inside its right edge. One control for every password on
// the site: sign-up, sign-in and reset. The eye is a real button (aria-pressed, aria-controls, a
// label that says what it will do) and never takes focus from the input when it is clicked.
import { useId, useState } from "react";
import { Field } from "./Field";
import type { FieldProps } from "./Field";

type PasswordFieldProps = Omit<FieldProps, "type" | "trailing">;

export function PasswordField({ id, label = "Password", ...rest }: PasswordFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [shown, setShown] = useState(false);
  return (
    <Field
      {...rest}
      id={inputId}
      label={label}
      type={shown ? "text" : "password"}
      // A revealed password is not a word: no spell check, no capital, no autocorrect.
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      trailing={
        <button
          type="button"
          className="field-eye"
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          aria-controls={inputId}
          // Keeps the caret in the field when the eye is clicked or tapped.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setShown((value) => !value)}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" className="field-eye-icon">
            {shown ? (
              <>
                <path d="M3 3l18 18" />
                <path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c5 0 8.6 3.6 10 7-.5 1.2-1.3 2.4-2.4 3.5M6.5 6.6C4.6 7.9 3.2 9.8 2 12c1.4 3.4 5 7 10 7 1.6 0 3-.4 4.3-1" />
                <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
              </>
            ) : (
              <>
                <path d="M2 12c1.4-3.4 5-7 10-7s8.6 3.6 10 7c-1.4 3.4-5 7-10 7S3.4 15.4 2 12z" />
                <circle cx="12" cy="12" r="3" />
              </>
            )}
          </svg>
        </button>
      }
    />
  );
}
