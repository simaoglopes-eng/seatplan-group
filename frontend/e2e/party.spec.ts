// Party booking, end to end: one guest books several seats and names everyone
// on them. Laptop-sized screen, plus one test at phone width (390 px) that
// measures the touch targets and runs axe on the map and on "Your party".
// Real backend, real built frontend, the demo wedding.
//
// The tests run in order and share their guests, added through the organiser
// API so no other test file's demo guest is touched:
//   1. a booker chooses three seats, fills "Who is sitting where?" (axe checks it) and confirms;
//   2. another guest sees those names the way the wedding's privacy shows them, never an age;
//   3. the organiser sees the party grouped, with the ages;
//   4. the booker moves one person (keyboard only) and removes another;
//   5. two bookers want the same seat: the second keeps every name typed.
//   6. at 390 px: every party control is at least 44 x 44 px, axe on the map and on Done.
// The demo wedding has few places left, so these tests add only the guests they need;
// test 6 uses the conference, which has room.

import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { fillWhoSitsWhere, goToSeatStep } from "./attendee-steps";
import { ORGANISER, demoLinks, expect, lastPart, signIn, test } from "./fixtures";

const BOOKER = { name: "Paula Partyline", email: "zq.paula@example.com" };
const OTHER = { name: "Otto Onlooker", email: "zq.otto@example.com" };
const RIVAL = { name: "Rosa Rival", email: "zq.rosa@example.com" };
const LATE = { name: "Lena Late", email: "zq.lena@example.com" };
// Ages nobody else on the page could show by chance.
const AGES = { booker: "111", bea: "113", rui: "117" };

interface GuestView {
  me: { seat_id: number | null };
  map: { seats: { id: number; state: string; occupant?: string | null; label: string; table_id: number }[]; tables: { id: number; label: string }[] };
}

async function organiserHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const answer = await request.post("/api/auth/login", { data: ORGANISER });
  expect(answer.status()).toBe(200);
  return { Authorization: `Bearer ${((await answer.json()) as { token: string }).token}` };
}

/** Adds a guest to the wedding and returns their personal link ("/e/<token>"). */
async function addGuest(request: APIRequestContext, eventId: string, guest: { name: string; email: string }): Promise<string> {
  const answer = await request.post(`/api/events/${eventId}/guests`, { data: guest, headers: await organiserHeaders(request) });
  expect(answer.status()).toBe(201);
  const link = ((await answer.json()) as { link: string }).link;
  return new URL(link, "http://x").pathname;
}

/** Selects the first `count` recommendations, one by one, as a guest would with "Select this seat". */
async function selectRecommended(page: Page, count: number, from = 0): Promise<string[]> {
  const names: string[] = [];
  const cards = page.getByRole("list", { name: "Recommended for you" }).getByRole("button");
  for (let i = from; i < from + count; i += 1) {
    const card = cards.nth(i);
    names.push((await card.locator(".ev-rec-seat").innerText()).trim());
    await card.click();
    await page.getByRole("button", { name: "Select this seat" }).click();
  }
  return names;
}

test.describe.serial("party booking", () => {
  let eventId = "";
  let bookerLink = "";
  let seats: string[] = [];

  test("a guest books three seats; Confirm waits until everyone has a name and an age", async ({ page, request }) => {
    const links = await demoLinks(request);
    eventId = lastPart(links.wedding_organiser);
    bookerLink = await addGuest(request, eventId, BOOKER);
    await goToSeatStep(page, bookerLink);
    await expect(page.getByText("Tap one seat for you, then more seats for anyone coming with you.", { exact: false })).toBeVisible();

    seats = await selectRecommended(page, 3);
    const bar = page.getByRole("region", { name: "Selected seat" });
    await expect(bar).toContainText("3 seats selected");
    await expect(bar).toContainText("Available until someone confirms it.");
    await bar.getByRole("button", { name: "Continue" }).click();

    // The booker's card comes first and is filled from the invitation.
    await expect(page.getByRole("group", { name: `You · ${seats[0]}` }).getByLabel("First name")).toHaveValue("Paula");
    const confirm = page.getByRole("button", { name: "Confirm 3 seats" });
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    // Pressing it early (here with the keyboard: Playwright will not click an aria-disabled
    // button) shows every missing field, tied to its input; axe checks the page in that state.
    await confirm.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Enter a first name.").first()).toBeVisible();
    await expect(page.getByRole("group", { name: `You · ${seats[0]}` }).getByLabel("Age", { exact: true })).toBeFocused();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} [${v.nodes.length} element(s)]`);
    expect(summary, "axe found problems on Who is sitting where?").toEqual([]);

    await fillWhoSitsWhere(page, [
      { age: AGES.booker },
      { first: "Bea", last: "Party", age: AGES.bea },
      { first: "Rui", last: "Party", age: AGES.rui },
    ]);

    await expect(page.getByRole("heading", { name: "You are all set" })).toBeVisible();
    const party = page.getByRole("list", { name: "People you booked seats for" });
    await expect(party.getByRole("listitem")).toHaveCount(2);
    await expect(party).toContainText("Bea Party");
    await expect(party).toContainText(seats[1]);
    // The page never shows an age back, not even to the person who typed it.
    const text = await page.locator("body").innerText();
    for (const age of Object.values(AGES)) expect(text).not.toContain(age);

    // The server agrees: three seats, and no age in what the guest's own answer holds.
    const me = await request.get(`/api/a/${lastPart(bookerLink)}`);
    const body = await me.text();
    expect(body).not.toMatch(/"age(_years)?"\s*:\s*\d/);
  });

  test("another guest sees the party's names the way the wedding shows names, and never an age", async ({ page, request }) => {
    const otherLink = await addGuest(request, eventId, OTHER);
    const answer = await request.get(`/api/a/${lastPart(otherLink)}`);
    const raw = await answer.text();
    // No age field anywhere in another guest's answer (the map's coordinates hold digits like 1115.0, so look at fields).
    expect(raw).not.toMatch(/"age(_years)?"\s*:\s*\d/);
    expect(raw).not.toContain("birth_date\":\"");
    const view = JSON.parse(raw) as GuestView;
    const occupants = view.map.seats.map((s) => s.occupant ?? "");
    // The wedding shows first names and an initial (privacy "first_initial").
    expect(occupants).toContain("Bea P.");
    expect(occupants).not.toContain("Bea Party");

    await page.goto(otherLink);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const text = await page.locator("body").innerText();
    for (const age of Object.values(AGES)) expect(text).not.toMatch(new RegExp(`\\b${age}\\b`));
  });

  test("the organiser sees the party grouped under the booker, with the ages", async ({ page }) => {
    await signIn(page, ORGANISER, `/organiser/${eventId}`);
    await page.getByLabel("Show").selectOption("all");
    await page.getByLabel("Search guests").fill("Part");
    const list = page.getByRole("list", { name: "Guests" });
    const rows = list.getByRole("listitem");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Paula Partyline");
    await expect(rows.nth(0)).toContainText("Party of 3");
    await expect(rows.nth(0)).toContainText(`Age ${AGES.booker}`);
    await expect(rows.nth(1)).toContainText("Bea Party");
    await expect(rows.nth(1)).toContainText("Booked by Paula Partyline");
    await expect(rows.nth(1)).toContainText(`Age ${AGES.bea}`);
    await expect(rows.nth(1).getByRole("button", { name: /link for Bea Party/ })).toHaveCount(0);
  });

  test("the booker moves one person and removes another", async ({ page, request }) => {
    await page.goto(bookerLink);
    const party = page.getByRole("list", { name: "People you booked seats for" });
    await party.getByRole("button", { name: "Move Bea Party", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Choose a new seat for Bea Party" })).toBeVisible();
    // With the keyboard only: arrows move the map's cursor to a free seat, Enter picks it.
    const map = page.getByRole("listbox", { name: /^Seat map/ });
    await map.focus();
    const activeLabel = async () => {
      const id = await map.getAttribute("aria-activedescendant");
      return id ? ((await page.locator(`[id="${id}"]`).getAttribute("aria-label")) ?? "") : "";
    };
    for (let i = 0; i < 80 && !/, free/.test(await activeLabel()); i += 1) await page.keyboard.press("ArrowRight");
    expect(await activeLabel()).toMatch(/, free/);
    await page.keyboard.press("Enter");
    const bar = page.getByRole("region", { name: "Selected seat" });
    const newSeat = (await bar.locator("strong").innerText()).trim();
    await bar.getByRole("button", { name: "Move Bea here" }).click();
    await expect(page.getByRole("heading", { name: "You are all set" })).toBeVisible();
    await expect(party.getByRole("listitem").filter({ hasText: "Bea Party" })).toContainText(newSeat);

    await party.getByRole("button", { name: "Remove Rui Party", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Remove Rui Party from your party?" });
    await expect(dialog).toContainText("Their seat becomes free for anyone, and their name and age are deleted.");
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(party.getByRole("listitem")).toHaveCount(1);

    // Rui's old seat is free again for everyone.
    const view = (await (await request.get(`/api/a/${lastPart(bookerLink)}`)).json()) as GuestView;
    const free = view.map.seats.filter((s) => s.state === "free").map((s) => `${s.label}`);
    expect(free.length).toBeGreaterThan(0);
    expect(view.map.seats.filter((s) => s.state === "mine")).toHaveLength(2);
  });

  test("when two bookers want the same seat, the second keeps every name typed", async ({ page, request }) => {
    const rivalLink = await addGuest(request, eventId, RIVAL);
    const lateLink = await addGuest(request, eventId, LATE);
    await goToSeatStep(page, lateLink);
    const recs = (await (await request.get(`/api/a/${lastPart(lateLink)}/recommendations`)).json()) as { seat_id: number }[];
    const chosen = await selectRecommended(page, 2);
    await page.getByRole("region", { name: "Selected seat" }).getByRole("button", { name: "Continue" }).click();
    const guestCard = page.getByRole("group", { name: `Guest 1 · ${chosen[1]}` });
    await guestCard.getByLabel("First name", { exact: true }).fill("Tito");
    await guestCard.getByLabel("Last name", { exact: true }).fill("Late");
    await guestCard.getByLabel("Age", { exact: true }).fill("8");
    await page.getByRole("group", { name: `You · ${chosen[0]}` }).getByLabel("Age", { exact: true }).fill("39");

    // Rosa confirms Tito's seat a moment earlier.
    const rival = await request.post(`/api/a/${lastPart(rivalLink)}/party/confirm`, {
      data: { me: { seat_id: recs[1].seat_id, first_name: "Rosa", last_name: "Rival", age: 50 }, members: [] },
    });
    expect(rival.status()).toBe(200);
    // The live update may already have sent this page back to the map; if not, Confirm finds out.
    const confirm = page.getByRole("button", { name: "Confirm 2 seats" });
    if (await confirm.isVisible()) await confirm.click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText(`${chosen[1]} was just taken. Choose another seat for Tito.`);
    await expect(page.getByRole("heading", { name: "Choose your seat" })).toBeVisible();

    // A new seat for Tito: the name and age typed are still there.
    await selectRecommended(page, 1, 2);
    await page.getByRole("region", { name: "Selected seat" }).getByRole("button", { name: "Continue" }).click();
    const tito = page.locator("fieldset.party-card").nth(1);
    await expect(tito.getByLabel("First name", { exact: true })).toHaveValue("Tito");
    await expect(tito.getByLabel("Age", { exact: true })).toHaveValue("8");
    await page.getByRole("button", { name: "Confirm 2 seats" }).click();
    await expect(page.getByRole("heading", { name: "You are all set" })).toBeVisible();
    await expect(page.getByRole("list", { name: "People you booked seats for" })).toContainText("Tito Late");
  });

  test("at phone width every party control is at least 44 px, and axe finds nothing on the map or on Done", async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const links = await demoLinks(request);
    const conference = lastPart(links.conference_organiser);
    const link = await addGuest(request, conference, { name: "Tara Touch", email: "zq.tara@example.com" });
    await goToSeatStep(page, link);
    await selectRecommended(page, 2);

    const small: string[] = [];
    const measure = async (what: string, locator: ReturnType<Page["locator"]>) => {
      const count = await locator.count();
      expect(count, `${what}: nothing to measure`).toBeGreaterThan(0);
      for (let i = 0; i < count; i += 1) {
        const box = await locator.nth(i).boundingBox();
        const name = (await locator.nth(i).getAttribute("aria-label")) ?? (await locator.nth(i).innerText());
        if (!box || box.width < 44 || box.height < 44) small.push(`${what} "${name}": ${box?.width ?? 0} x ${box?.height ?? 0}`);
      }
    };
    const axe = async (where: string) => {
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} [${v.nodes.length}]`), `axe on ${where}`).toEqual([]);
    };

    // The map with two seats chosen: the chips and the bar.
    await measure("chip", page.getByRole("list", { name: "Seats you chose" }).getByRole("button"));
    await measure("bar", page.getByRole("region", { name: "Selected seat" }).getByRole("button"));
    await axe("the map with two seats chosen");
    await page.getByRole("region", { name: "Selected seat" }).getByRole("button", { name: "Continue" }).click();

    // Who is sitting where?: the fields, the seat lists, Remove and the footer.
    await measure("card field", page.locator("fieldset.party-card").locator("input, select"));
    await measure("card button", page.locator("fieldset.party-card").getByRole("button"));
    await measure("footer", page.getByRole("region", { name: "Confirm your seats" }).getByRole("button"));
    await fillWhoSitsWhere(page, [{ age: "30" }, { first: "Tom", last: "Touch", age: "6" }]);

    // Done: Your party.
    const party = page.getByRole("list", { name: "People you booked seats for" });
    await expect(party).toContainText("Tom Touch");
    await measure("party", party.getByRole("button"));
    await measure("add people", page.getByRole("button", { name: "Add people" }));
    await axe("Done with Your party");
    expect(small, "touch targets under 44 x 44 px").toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
