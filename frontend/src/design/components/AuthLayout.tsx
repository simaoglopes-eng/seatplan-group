import type { ReactNode } from "react";

interface AuthLayoutProps {
  eyebrow: string;
  headline: string;
  description: string;
  children: ReactNode;
  /** A short phone version: the story above the form is hidden so a sign-up form fits one screen. */
  compact?: boolean;
}

/** A consistent, calm frame for the account journeys. */
export function AuthLayout({ eyebrow, headline, description, children, compact = false }: AuthLayoutProps) {
  return (
    <section className={`auth-layout${compact ? " auth-layout-compact" : ""}`} aria-label={`${eyebrow} account`}>
      <aside className="auth-story">
        <p className="auth-eyebrow">{eyebrow}</p>
        <h2>{headline}</h2>
        <p className="auth-description">{description}</p>
        <svg className="auth-illustration" viewBox="0 0 260 180" aria-hidden="true">
          <circle cx="130" cy="90" r="65" fill="none" stroke="currentColor" strokeOpacity=".2" />
          <circle cx="130" cy="90" r="49" fill="none" stroke="currentColor" strokeOpacity=".35" />
          <rect x="91" y="56" width="78" height="68" rx="25" fill="currentColor" fillOpacity=".14" stroke="currentColor" strokeOpacity=".46" />
          <circle cx="130" cy="38" r="8" fill="currentColor" />
          <circle cx="185" cy="66" r="8" fill="currentColor" />
          <circle cx="185" cy="114" r="8" fill="currentColor" />
          <circle cx="130" cy="142" r="8" fill="currentColor" />
          <circle cx="75" cy="114" r="8" fill="currentColor" />
          <circle cx="75" cy="66" r="8" fill="currentColor" />
          <circle cx="130" cy="90" r="6" fill="currentColor" />
        </svg>
        <p className="auth-note"><span aria-hidden="true">✳</span> Thoughtful seating for good gatherings.</p>
      </aside>
      <div className="auth-content">{children}</div>
    </section>
  );
}
