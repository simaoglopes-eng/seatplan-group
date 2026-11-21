const VISIT_KEY = "seatplan:discovery-visits";
const SESSION_KEY = "seatplan:discovery-visit";

export const FIRST_HEADLINE = "Find a table you’ll love.";

const RETURNING_HEADLINES = [
  "Where shall we eat this time?",
  "Find another table you’ll love.",
  "A new table to try.",
  "Pick up where you left off.",
  "Plan your next meal out.",
  "Back for something delicious?",
  "Find a spot for your next catch-up.",
  "See what’s free for dinner.",
  "Make your next lunch plan.",
  "Your next table is waiting.",
  "Fancy somewhere different?",
  "Try a new favourite.",
  "Explore another corner of the city.",
  "A table for your next get-together.",
  "See where you could sit tonight.",
  "Pick a place for the weekend.",
  "Find a table worth sharing.",
  "Let’s find your next lunch spot.",
  "Make time for a good meal.",
  "Where are we meeting for dinner?",
  "There’s more on the menu.",
  "Time to find your next spot.",
  "Try a different room tonight.",
  "Take another look around.",
  "Find somewhere for the whole group.",
];

const REGULAR_HEADLINES = [
  "The usual, or somewhere new?",
  "Same neighbourhood, different table?",
  "Book a table for tonight.",
  "Make dinner plans in a few taps.",
  "Where are you sitting this time?",
  "Find a table for your regular catch-up.",
  "Plan this week’s lunch.",
  "Pick a table and make a plan.",
  "Where’s everyone eating this week?",
  "Find time for another dinner out.",
  "See what’s open for your next meal.",
  "Find a table that fits your plans.",
  "Choose your spot for the weekend.",
  "Got a date in mind?",
  "Make room for one more dinner.",
  "Find a spot to bring your friends.",
  "Settle on a table for tonight.",
  "See which tables are free.",
  "Pick your next neighbourhood spot.",
  "Find a place to eat close by.",
  "Take your next lunch outside.",
  "Choose a table with a view.",
  "See what’s free around your time.",
  "Pick a table for two.",
  "Where shall we eat next week?",
  "Choose the room and the table.",
];

function readVisits(storage: Storage, key: string): number {
  const count = Number(storage.getItem(key));
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

/** One visit per browser session. The headline stays stable while browsing or refreshing. */
export function visitHeadline(): string {
  try {
    const session = window.sessionStorage;
    const history = window.localStorage;
    let visit = readVisits(session, SESSION_KEY);
    if (!visit) {
      visit = readVisits(history, VISIT_KEY) + 1;
      session.setItem(SESSION_KEY, String(visit));
      history.setItem(VISIT_KEY, String(visit));
    }
    if (visit === 1) return FIRST_HEADLINE;
    if (visit < 5) {
      // Spread early return visits across the copy without changing it mid-session.
      const key = "seatplan:discovery-headline-offset";
      let offset = history.getItem(key);
      if (offset === null) {
        offset = String(Math.floor(Math.random() * RETURNING_HEADLINES.length));
        history.setItem(key, offset);
      }
      return RETURNING_HEADLINES[(Number(offset) + visit - 2) % RETURNING_HEADLINES.length] ?? RETURNING_HEADLINES[0];
    }
    return REGULAR_HEADLINES[(visit - 5) % REGULAR_HEADLINES.length];
  } catch {
    return FIRST_HEADLINE;
  }
}
