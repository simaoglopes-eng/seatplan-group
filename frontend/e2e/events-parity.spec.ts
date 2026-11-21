// Events parity and one account (docs/superpowers/plans/2026-11-18-eventos-paridade.md), on a
// laptop-sized screen with one check at phone width. Each test uses its own made-up
// example.com address (the demo shows its code on screen), so the tests do not depend on each
// other. They only add: a new account, a team member at the demo restaurant, a guest at one
// listed event. Account sign-ins are kept few: the server allows 10 a minute from one address.

import type { APIRequestContext, Page } from "@playwright/test";
import { ORGANISER, demoLinks, expect, lastPart, signIn, test } from "./fixtures";

/** Rita: staff at Casa Lumen and Quinta da Serra Azul, with a booking and an event seat (seed/demo_member.py). */
const RITA = { email: "rita@example.com", password: "demo-member-2026" };

/** A new address per run and per test, so a rerun on the same database never collides. */
function newPerson(tag: string): { name: string; email: string; password: string } {
  const id = `${tag}${Date.now().toString(36)}`;
  return { name: `Pat ${tag}`, email: `pat.${id}@example.com`, password: "a long test password" };
}

/** Reads the 6-digit demo code from the badge on a "Check your email" step. */
async function demoCode(page: Page): Promise<string> {
  const badge = page.getByText(/Demo only: your code is \d{6}/);
  await expect(badge).toBeVisible();
  return ((await badge.innerText()).match(/\d{6}/) ?? [""])[0];
}

/**
 * Makes an account through the API (register, then verify with the demo code), as the page would.
 * Returns the two sessions verify hands back, so a test need not spend one of the 10 sign-ins a minute.
 */
async function accountByApi(request: APIRequestContext, person: { name: string; email: string; password: string }): Promise<{ guest: string; work: string }> {
  const sent = await request.post("/api/account/register", { data: { name: person.name, email: person.email, password: person.password, consent: true } });
  expect(sent.status()).toBe(202);
  const { signup_id: signupId, demo_code: code } = (await sent.json()) as { signup_id: string; demo_code: string };
  expect(code).toMatch(/^\d{6}$/);
  const verified = await request.post("/api/guest/verify", { data: { email: person.email, code, signup_id: signupId } });
  expect(verified.status()).toBe(201);
  const body = (await verified.json()) as { token: string; work?: { token: string } };
  expect(body.work?.token, "a new address gets its work session from verify").toBeTruthy();
  return { guest: body.token, work: body.work?.token ?? "" };
}

/**
 * The server allows 10 sign-ins a minute from one address, counted per calendar minute
 * (backend/app/security.py, rate_limit), and every test file shares that address. This file
 * needs four, so it starts on a fresh minute and leaves the next file a fresh one too;
 * otherwise a busy minute makes later files fail with 429 one after another.
 */
async function waitForNextMinute(): Promise<void> {
  const now = new Date();
  await new Promise((resolve) => setTimeout(resolve, (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 500));
}

test.beforeAll(async () => {
  test.setTimeout(90_000);
  await waitForNextMinute();
});

test.afterAll(async () => {
  test.setTimeout(90_000);
  await waitForNextMinute();
});

/** Signs in on /account (one form for both halves of the account). */
async function accountSignIn(page: Page, who: { email: string; password: string }): Promise<void> {
  const form = page.getByRole("form", { name: "Sign in" });
  await form.getByLabel("Email").fill(who.email);
  await form.getByLabel("Password", { exact: true }).fill(who.password);
  await form.getByRole("button", { name: /^Sign in/ }).click();
}

test("the /demo cards show exactly two entries and a browse link each", async ({ page }) => {
  await page.goto("/demo");
  const restaurant = page.locator("article.home-card", { has: page.getByRole("heading", { name: "Restaurant", exact: true }) });
  const events = page.locator("article.home-card", { has: page.getByRole("heading", { name: "Events", exact: true }) });
  await expect(restaurant.getByRole("link")).toHaveCount(3);
  await expect(events.getByRole("link")).toHaveCount(3);
  await expect(restaurant.getByRole("link", { name: /Restaurant booking/ })).toHaveAttribute("href", /^\/r\//);
  await expect(restaurant.getByRole("link", { name: /Restaurant staff/ })).toHaveAttribute("href", /^\/staff\//);
  await expect(restaurant.getByRole("link", { name: "Browse restaurants" })).toHaveAttribute("href", "/");
  await expect(events.getByRole("link", { name: /Event booking/ })).toHaveAttribute("href", "/events");
  await expect(events.getByRole("link", { name: /Event staff/ })).toHaveAttribute("href", "/events/staff");
  await expect(events.getByRole("link", { name: "Browse halls and quintas" })).toHaveAttribute("href", "/venues");
  await expect(page.getByRole("heading", { name: "Venue tools" })).toHaveCount(0);
  await expect(page.locator("article.home-card")).toHaveCount(2);
});

test("a new account: create with the demo code, sign out, sign in, then Booking and Staff", async ({ page }) => {
  const person = newPerson("acc");
  await page.goto("/");
  await page.getByRole("link", { name: "Log in" }).click();
  await page.waitForURL((url) => url.pathname === "/account");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("First name").fill(person.name.split(" ")[0]);
  await page.getByLabel("Last name").fill(person.name.split(" ").slice(1).join(" "));
  await page.getByRole("textbox", { name: "Email" }).fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page.getByRole("checkbox", { name: /I agree that SeatPlan stores my details/ }).check();
  await page.getByRole("button", { name: "Send my code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.getByLabel("Code").fill(await demoCode(page));
  await page.getByRole("button", { name: "Create my account" }).click();

  // Signed in on both sides at once.
  await expect(page.getByRole("heading", { level: 1, name: person.name })).toBeVisible();
  await expect(page.getByRole("button", { name: "Booking", pressed: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "My bookings" })).toBeVisible();
  await expect(page.getByText("No bookings here yet.")).toBeVisible();
  await page.getByRole("button", { name: "Staff" }).click();
  await expect(page.getByRole("heading", { name: "Restaurants" })).toBeVisible();
  await expect(page.getByText("No restaurants yet. When an owner adds your email to their team, the restaurant appears here.")).toBeVisible();
  await expect(page.getByRole("link", { name: "My account" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to SeatPlan" })).toBeVisible();
  expect(await page.evaluate(() => [sessionStorage.getItem("seatplan.guest-session"), sessionStorage.getItem("seatplan.session")])).toEqual([null, null]);

  await accountSignIn(page, person);
  await expect(page.getByRole("heading", { level: 1, name: person.name })).toBeVisible();
  // The address bar still says Staff: the panel opens on the side the person was on.
  await expect(page.getByRole("heading", { name: "Event venues" })).toBeVisible();
  await page.getByRole("button", { name: "Booking" }).click();
  await expect(page.getByRole("heading", { name: "My events" })).toBeVisible();
});

test("an owner adds a member by email; the member sees the restaurant under Staff and opens its floor", async ({ page, request }) => {
  const links = await demoLinks(request);
  const venueId = lastPart(links.restaurant_staff);
  const member = newPerson("team");
  const memberSessions = await accountByApi(request, member);

  await signIn(page, ORGANISER, `/owner/${venueId}/team`);
  await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
  await expect(page.getByText(/needs a SeatPlan account with this email/)).toBeVisible();
  await page.getByRole("textbox", { name: /^Email/ }).fill(member.email);
  await page.getByRole("button", { name: "Add to team" }).click();
  await expect(page.locator(".ow-team-list strong", { hasText: member.email })).toBeVisible();

  // The member, in the same tab after the owner has gone, with the sessions their sign-up gave them
  // (the sign-in form itself is covered by the account test above).
  await page.evaluate((s) => {
    sessionStorage.clear();
    sessionStorage.setItem("seatplan.guest-session", s.guest);
    sessionStorage.setItem("seatplan.session", s.work);
  }, memberSessions);
  await page.goto("/account?tab=staff");
  await expect(page.getByRole("heading", { level: 1, name: member.name })).toBeVisible();
  const floor = page.locator(`a[href="/staff/${venueId}"]`);
  await expect(floor).toBeVisible();
  await expect(page.locator(".ep-staff-row", { has: floor }).getByText("Staff", { exact: true })).toBeVisible();
  await floor.click();
  await page.waitForURL((url) => url.pathname === `/staff/${venueId}`);
  await expect(page.getByRole("heading", { name: "Service floor" })).toBeVisible();
});

test("a quinta's owner adds a member from Staff; the member sees the quinta and its events", async ({ page, request }) => {
  const member = newPerson("venue");
  const memberSessions = await accountByApi(request, member);

  await signIn(page, ORGANISER, "/account");
  await page.getByRole("button", { name: "Staff" }).click();
  const quinta = page.locator(".ep-staff-row", { has: page.getByRole("heading", { name: /Quinta da Serra Azul/ }) });
  await quinta.getByRole("link", { name: "Team" }).click();
  await page.waitForURL((url) => /^\/owner\/[^/]+\/team$/.test(url.pathname));
  await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
  await expect(page.getByText("Quinta da Serra Azul", { exact: true })).toBeVisible();
  await expect(page.getByText(/the venue then appears under Staff/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Floor plan" })).toHaveCount(0);
  await page.getByRole("textbox", { name: /^Email/ }).fill(member.email);
  await page.getByRole("button", { name: "Add to team" }).click();
  await expect(page.locator(".ow-team-list strong", { hasText: member.email })).toBeVisible();

  await page.evaluate((s) => {
    sessionStorage.clear();
    sessionStorage.setItem("seatplan.guest-session", s.guest);
    sessionStorage.setItem("seatplan.session", s.work);
  }, memberSessions);
  await page.goto("/account?tab=staff");
  await expect(page.getByRole("heading", { level: 1, name: member.name })).toBeVisible();
  const row = page.locator(".ep-staff-row", { has: page.getByRole("heading", { name: /Quinta da Serra Azul/ }) });
  await expect(row.getByText("Staff", { exact: true })).toBeVisible();
  await expect(row.getByRole("link", { name: "Team" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Open organiser workspace for Sofia and Tiago's wedding/ })).toBeVisible();
});

test("Event booking: filter by type, open an event, and the shared link reaches the seat choice", async ({ page }) => {
  const person = newPerson("seat");
  await page.goto("/");
  await page.getByRole("link", { name: "Plan an event" }).click();
  await page.waitForURL((url) => url.pathname === "/events");
  await expect(page.getByRole("heading", { level: 1, name: "Choose your seat at an event." })).toBeVisible();
  await page.getByRole("group", { name: "Event type" }).getByRole("button", { name: "Conference" }).click();
  await expect(page).toHaveURL(/\?type=conference$/);
  await expect(page.getByRole("heading", { name: /upcoming conference events?$/ })).toBeVisible();
  const cards = page.locator("article.ep-event-card");
  expect(await cards.count()).toBeGreaterThan(0);
  for (const label of await cards.locator(".ep-type").allInnerTexts()) expect(label).toBe("Conference");

  await cards.first().getByRole("link", { name: /Choose your seat/ }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/j/"));
  await page.getByRole("link", { name: "Create an account to choose a seat" }).first().click();
  await page.getByLabel("First name").fill(person.name.split(" ")[0]);
  await page.getByLabel("Last name").fill(person.name.split(" ").slice(1).join(" "));
  await page.getByRole("textbox", { name: "Email" }).fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page.getByRole("checkbox", { name: /I agree that SeatPlan stores my details/ }).check();
  await page.getByRole("button", { name: "Send my code" }).click();
  await page.getByLabel("Code").fill(await demoCode(page));
  await page.getByRole("button", { name: "Create my account" }).click();
  await page.waitForURL((url) => /^\/my\/[^/]+$/.test(url.pathname));

  const seatHeading = page.getByRole("heading", { name: "Choose your seat" });
  const yes = page.getByRole("button", { name: "Yes, I will be there" });
  const skip = page.getByRole("button", { name: "Skip this step" });
  await expect(seatHeading.or(yes).or(skip)).toBeVisible();
  if (await yes.isVisible()) await yes.click();
  await expect(seatHeading.or(skip)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(seatHeading).toBeVisible();
});

test("Event staff: sign in, pick a type, open the organiser workspace", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("link", { name: /Event staff/ }).click();
  await page.waitForURL((url) => url.pathname === "/events/staff");
  await expect(page.getByRole("heading", { name: "Sign in to see your events" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/account?mode=create");
  await accountSignIn(page, RITA);

  const list = page.getByRole("list", { name: "Events you can run" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("group", { name: "Event type" }).getByRole("button", { name: "Wedding" }).click();
  await expect(page.getByRole("heading", { name: "Your wedding events" })).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByText("Staff", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Venues you run" })).toBeVisible();
  await list.getByRole("link", { name: /Open organiser workspace/ }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/organiser/"));
  await expect(page.getByRole("heading", { level: 1, name: "Sofia and Tiago's wedding" })).toBeVisible();
  await expect(page.locator(".ev-org-header .ev-eyebrow")).toHaveText("Wedding");
  await expect(page.locator(".ev-org-header .ev-when")).toContainText("Quinta da Serra Azul");
  await expect(page.getByRole("tab", { name: "Guests" })).toBeVisible();

  // The same sign-in opened Rita's personal side: her seeded table booking and event seat.
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1, name: "Rita Rossi" })).toBeVisible();
  await expect(page.locator(".diner-booking-list").first().getByRole("listitem")).not.toHaveCount(0);
  await expect(page.getByRole("list", { name: "Your events" }).getByRole("heading", { name: "Lisbon Product Conference" })).toBeVisible();
  await page.getByRole("button", { name: "Staff" }).click();
  await expect(page.locator(".ep-staff-row", { hasText: "Casa Lumen" })).toBeVisible();
  await expect(page.locator(".ep-staff-row", { hasText: "Quinta da Serra Azul" }).first()).toBeVisible();
});

test("the new public pages fit a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/events", "/venues", "/venues/quinta-da-serra-azul", "/events/staff", "/account", "/account?mode=create", "/demo"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});
