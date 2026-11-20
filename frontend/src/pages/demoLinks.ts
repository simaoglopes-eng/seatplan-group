// Turns the backend's demo links ({"attendee_ana": "/e/<token>", ...}) into
// labelled entries grouped by vertical, ready for the home page cards.

export type DemoGroup = "events" | "restaurant" | "tools";

export interface DemoEntry {
  name: string;
  label: string;
  path: string;
  group: DemoGroup;
}

/** Which card a link belongs on, judged by the frontend route it opens. */
function groupFor(path: string): DemoGroup {
  if (path.startsWith("/e/") || path.startsWith("/organiser/")) return "events";
  // The shared event link and the guest account pages.
  if (path.startsWith("/j/") || path === "/my" || path.startsWith("/my/")) return "events";
  if (path.startsWith("/r/") || path.startsWith("/b/") || path.startsWith("/staff/") || path.startsWith("/restaurants/")) return "restaurant";
  return "tools";
}

/**
 * Keeps links inside the app. A full URL is cut to its path, and the API's
 * attendee path "/a/<token>" is mapped to the page route "/e/<token>".
 */
export function toAppPath(link: string): string {
  const path = link.startsWith("http") ? new URL(link).pathname : link;
  return path.startsWith("/a/") ? `/e/${path.slice(3)}` : path;
}

/** "attendee_ana" becomes "Attendee Ana". */
export function labelFor(name: string): string {
  return name
    .split(/[_-]+/)
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function demoEntries(links: Record<string, string>): DemoEntry[] {
  return Object.keys(links)
    .sort()
    .map((name) => {
      const path = toAppPath(links[name]);
      return { name, label: labelFor(name), path, group: groupFor(path) };
    });
}

// ---------- The /demo cards (plan 2026-11-18, "Later decisions") ----------
// The cards start with few options. An explicit allow-list of link NAMES (never
// path prefixes, which other links share) decides what each card shows. Every
// other demo link stays in the backend, where the tests use it, and is hidden here.

export type DemoCard = "restaurant" | "events";

export interface DemoCardLink {
  name: string;
  label: string;
  path: string;
  description: string;
}

export const DEMO_CARD_LINKS: Record<DemoCard, { name: string; label: string; description: string }[]> = {
  restaurant: [
    { name: "restaurant_booking", label: "Restaurant booking", description: "Book a table as a diner" },
    { name: "restaurant_staff", label: "Restaurant staff", description: "Run the dining room during service" },
  ],
  events: [
    { name: "event_booking", label: "Event booking", description: "Choose an event and pick your seat" },
    { name: "event_staff", label: "Event staff", description: "Plan the room for an event you run" },
  ],
};

/** The allowed links that the backend sent, in the card's own order. */
export function demoCards(links: Record<string, string>): Record<DemoCard, DemoCardLink[]> {
  const pick = (card: DemoCard): DemoCardLink[] =>
    DEMO_CARD_LINKS[card]
      .filter((entry) => typeof links[entry.name] === "string")
      .map((entry) => ({ name: entry.name, label: entry.label, path: toAppPath(links[entry.name]), description: entry.description }));
  return { restaurant: pick("restaurant"), events: pick("events") };
}
