// The account link stays visible in the public header and opens /account. On phones the
// event link sits behind Menu. Events only: no restaurant-owner link.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getGuestToken, getSessionToken } from "../../api/client";
import "./discover.css";

export function PublicHeaderActions() {
  const [open, setOpen] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = (): void => { setOpen(false); button.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent): void => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    const outside = (event: PointerEvent): void => { if (event.target instanceof Node && !nav.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside); };
  }, [open]);
  return (
    <nav ref={nav} className="site-nav" aria-label="Main" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button ref={button} type="button" className="btn btn-ghost site-nav-toggle" aria-expanded={open} aria-controls="site-nav-links" onClick={() => setOpen((v) => !v)}>
        Menu
      </button>
      <div id="site-nav-links" className={`site-nav-links${open ? " is-open" : ""}`}>
        <Link to="/directory" className="btn btn-ghost" onClick={close}>
          Venues
        </Link>
        <Link to="/events" className="btn btn-ghost" onClick={close}>
          Events
        </Link>
      </div>
      {/* One account for bookings and work (plan 2026-11-18): either session means signed in. */}
      <Link to="/account" className="btn btn-primary site-nav-login" onClick={() => setOpen(false)}>
        {getGuestToken() || getSessionToken() ? "My account" : "Log in"}
      </Link>
    </nav>
  );
}
