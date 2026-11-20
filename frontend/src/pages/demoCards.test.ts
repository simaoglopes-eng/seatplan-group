import { describe, expect, it } from "vitest";
import { DEMO_CARD_LINKS, demoCards } from "./demoLinks";

// Everything GET /demo/links answers on a seeded demo, old and new (backend/app/seed/).
const ALL = {
  attendee_ana: "/a/demo-token",
  wedding_guest_choosing: `/a/${"x".repeat(43)}`,
  wedding_organiser: "/organiser/ev1",
  wedding_share: "/j/share",
  my_events: "/my",
  diner: "/r/demo-venue",
  restaurant_booking: "/r/casa",
  restaurant_staff: "/staff/casa",
  restaurant_manage: "/b/token",
  showcase_tagus_terrace: "/restaurants/tagus-terrace",
  editor_bistro: "/editor/demo-venue",
  event_booking: "/events",
  event_staff: "/events/staff",
  showcase_venue_tagus_forum: "/venues/tagus-forum",
  docs: "/api/docs",
};

describe("demoCards (the allow-list of the /demo cards)", () => {
  it("names exactly two links per card, by link name and never by path", () => {
    expect(DEMO_CARD_LINKS.restaurant.map((l) => l.name)).toEqual(["restaurant_booking", "restaurant_staff"]);
    expect(DEMO_CARD_LINKS.events.map((l) => l.name)).toEqual(["event_booking", "event_staff"]);
  });

  it("keeps only the allowed links, with their own labels and words", () => {
    const cards = demoCards(ALL);
    expect(cards.restaurant).toEqual([
      { name: "restaurant_booking", label: "Restaurant booking", path: "/r/casa", description: "Book a table as a diner" },
      { name: "restaurant_staff", label: "Restaurant staff", path: "/staff/casa", description: "Run the dining room during service" },
    ]);
    expect(cards.events).toEqual([
      { name: "event_booking", label: "Event booking", path: "/events", description: "Choose an event and pick your seat" },
      { name: "event_staff", label: "Event staff", path: "/events/staff", description: "Plan the room for an event you run" },
    ]);
  });

  it("hides every other demo link, which the backend still sends", () => {
    const shown = [...demoCards(ALL).restaurant, ...demoCards(ALL).events].map((l) => l.name);
    for (const hidden of ["attendee_ana", "wedding_guest_choosing", "wedding_organiser", "wedding_share", "my_events", "diner", "restaurant_manage", "showcase_tagus_terrace", "editor_bistro", "showcase_venue_tagus_forum", "docs"]) {
      expect(shown).not.toContain(hidden);
    }
  });

  it("does not let a look-alike path through: only the name counts", () => {
    // "/staff/x" under another name, and "/events" under another name, stay hidden.
    const cards = demoCards({ staff_floor: "/staff/x", events_old: "/events", restaurant_staff: "/staff/casa" });
    expect(cards.restaurant.map((l) => l.name)).toEqual(["restaurant_staff"]);
    expect(cards.events).toEqual([]);
  });

  it("keeps links inside the app: a full URL becomes its path, and the API's /a/ becomes the page /e/", () => {
    const cards = demoCards({ restaurant_booking: "https://seatplan.example/r/casa", event_booking: "/a/token" });
    expect(cards.restaurant[0].path).toBe("/r/casa");
    expect(cards.events[0].path).toBe("/e/token");
  });

  it("gives nothing when the demo is off", () => {
    expect(demoCards({})).toEqual({ restaurant: [], events: [] });
  });
});
