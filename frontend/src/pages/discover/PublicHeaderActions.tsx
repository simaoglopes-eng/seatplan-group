// The right side of the header on every public page: Venues, Events, the primary
// "Create your own event" button and the account link. On phones the first three sit
// behind Menu (the create button is the menu's primary item); the account link stays
// visible. Events only: no restaurant-owner link.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getGuestToken, getSessionToken } from "../../api/client";
import "./discover.css";

/** Where every "Create your own event" button goes: the organiser space, with the new-event form focused. */
export const CREATE_EVENT_HREF = "/organiser?new=1";

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
        <Link to={CREATE_EVENT_HREF} className="btn site-nav-create" onClick={() => setOpen(false)}>
          Create your own event
        </Link>
      </div>
      {/* One account for bookings and work (plan 2026-11-18): either session means signed in. */}
      <Link to="/account" className="btn btn-primary site-nav-login" onClick={() => setOpen(false)}>
        {getGuestToken() || getSessionToken() ? "My account" : "Log in"}
      </Link>
    </nav>
  );
}
