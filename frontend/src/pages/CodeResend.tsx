import { useCallback, useEffect, useState } from "react";

/** Seconds to wait before another code can be asked for. The server also limits sends. */
export const RESEND_SECONDS = 30;

/** A countdown in seconds: start(n) sets it, and it ticks down to 0. */
export function useCooldown(): [number, (seconds?: number) => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return undefined;
    const timer = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);
  const start = useCallback((seconds = RESEND_SECONDS) => setLeft(seconds), []);
  return [left, start];
}

type Props = {
  cooldown: number;
  busy: boolean;
  /** True once a second code has been sent, so a screen reader hears it. */
  resent: boolean;
  onResend: () => void;
  onDifferentEmail: () => void;
};

/** Under the code field: ask for a new code, or go back and change the address. */
export function CodeResend({ cooldown, busy, resent, onResend, onDifferentEmail }: Props) {
  return (
    <div className="login-resend">
      <p className="login-resend-status" role="status">
        {resent ? "We sent a new code. Only the newest one works." : ""}
      </p>
      <div className="login-resend-actions">
        <button type="button" className="login-linkbtn" disabled={busy || cooldown > 0} onClick={onResend}>
          {cooldown > 0 ? `Send a new code in ${cooldown} s` : "Send a new code"}
        </button>
        <button type="button" className="login-linkbtn" disabled={busy} onClick={onDifferentEmail}>
          Use a different email
        </button>
      </div>
    </div>
  );
}
