// The frame around every page: skip link, header with the wordmark, the main
// landmark and a footer. Pages only supply their content.
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import seatPlanLogo from "../seatplan-logo.png";

// /pay is where a diner pays a restaurant deposit and returns from the payment page.
const RESTAURANT_ROOTS = ["/restaurants", "/r", "/b", "/owner", "/staff", "/pay"];

/** The routes of the Restaurants product (diner, owner, staff). Events, the home page and their sign-ins are not in it. */
export function isRestaurantRoute(pathname: string, search = ""): boolean {
  if (RESTAURANT_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`))) return true;
  // The sign-in a restaurant page sends people to (/login?next=/owner...) is part of the owner's journey, not of Events.
  if (pathname === "/login") {
    const next = new URLSearchParams(search).get("next") ?? "";
    return RESTAURANT_ROOTS.some((root) => root !== "/r" && root !== "/b" && (next === root || next.startsWith(`${root}/`)));
  }
  return false;
}

interface PageShellProps {
  /** Sets the browser tab title, so tabs and history are readable. */
  title: string;
  children: ReactNode;
  /** "wide" for map-heavy screens such as the editor. */
  width?: "normal" | "wide";
  /** "overlay": the header sits transparent, in white, over a full-bleed hero photo (home page only). */
  variant?: "default" | "overlay";
  /** Extra items on the right of the header, e.g. a "Sign out" button. */
  headerActions?: ReactNode;
  /** Page-specific links, kept between the brand and account actions. */
  headerNavigation?: ReactNode;
  footerContent?: ReactNode;
  restaurantBrand?: boolean;
}

export function Wordmark({ restaurantBrand = false }: { restaurantBrand?: boolean } = {}) {
  return (
    <Link to="/" className={restaurantBrand ? "wordmark wordmark-restaurants" : "wordmark"}
      aria-label={restaurantBrand ? "SeatPlan Restaurantes, home" : "SeatPlan, home"}>
      {restaurantBrand
        ? <img className="wordmark-logo" src={seatPlanLogo} alt="" width={132} height={40} />
        : <span className="wordmark-text" aria-hidden="true">SeatPlan</span>}
    </Link>
  );
}

export function PageShell({ title, children, width = "normal", variant = "default", headerActions, headerNavigation, footerContent, restaurantBrand }: PageShellProps) {
  useEffect(() => {
    document.title = `${title} · SeatPlan`;
  }, [title]);

  // The Restaurants look (restaurant-theme.css) applies to <html> on its own routes only.
  const { pathname, search } = useLocation();
  const restaurants = isRestaurantRoute(pathname, search);
  useEffect(() => {
    const root = document.documentElement;
    if (restaurants) root.dataset.surface = "restaurants";
    else delete root.dataset.surface;
    return () => {
      delete root.dataset.surface;
    };
  }, [restaurants]);

  return (
    <div className={variant === "overlay" ? "shell shell-overlay" : "shell"}>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="shell-header">
        <div className={`shell-inner shell-${width}`}>
          <Wordmark restaurantBrand={restaurantBrand} />
          {headerNavigation && <nav className="shell-navigation" aria-label="Page navigation">{headerNavigation}</nav>}
          {headerActions && <div className="shell-actions">{headerActions}</div>}
        </div>
      </header>
      {/* tabIndex -1 lets the skip link move keyboard focus here, not just scroll. */}
      <main id="main" tabIndex={-1} className={`shell-main shell-inner shell-${width}`}>
        {children}
      </main>
      <footer className="shell-footer">
        <div className={`shell-inner shell-${width}`}>
          <p>SeatPlan, a student project at Nova SBE. Events, guests and seat maps are demo data and every person is invented; the venue directory lists real places from OpenStreetMap.</p>
          <p className="shell-footer-links">
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
              Venue data © OpenStreetMap contributors<span className="visually-hidden"> (opens in a new tab)</span>
            </a>
            <Link to="/credits">Photo credits</Link>
          </p>
          {footerContent}
        </div>
      </footer>
    </div>
  );
}
