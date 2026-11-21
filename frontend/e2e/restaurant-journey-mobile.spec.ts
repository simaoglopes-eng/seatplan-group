// The whole diner journey on a phone: from a free time on a discovery card to the confirmation,
// once without a chair request and once with one.

import type { ServerSlots } from "../src/api/restaurant";
import { expect, isoDaysFromToday, test } from "./fixtures";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function fromDiscoveryToTable(page: import("@playwright/test").Page, daysAhead: number): Promise<void> {
  await page.goto("/");
  // Discovery with the "When and where" panel (the integrated design) is driven end to end. Before it exists the
  // phone has a different bar, so the journey starts from the same link a card's time would open.
  const context = page.getByRole("button", { name: /When and where/ });
  if (await context.isVisible()) {
    await context.click();
    const dialog = page.getByRole("dialog", { name: "Filters" });
    await dialog.getByLabel("Date", { exact: true }).fill(isoDaysFromToday(daysAhead));
    await dialog.getByRole("button", { name: /^Apply/ }).click();
    const card = page.getByRole("article").filter({ hasText: "Tasca do Bairro" });
    const time = card.getByRole("link", { name: /^\d\d:\d\d$/ }).first();
    await expect(time).toBeVisible();
    await time.click();
  } else {
    await page.goto(`/restaurants/tasca-do-bairro?date=${isoDaysFromToday(daysAhead)}&time=20:00&party=2`);
  }
  await expect(page).toHaveURL(/\/restaurants\/tasca-do-bairro\?date=.*&time=.*&party=2/);
  await expect(page.getByRole("heading", { name: "Choose your table" })).toBeVisible();
  // The suggestion first, with one main action. The plan and the list wait behind "Choose another table".
  await expect(page.getByRole("button", { name: "Continue with this table" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Choose another table" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Hold .* & continue/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pick a table to continue" })).toHaveCount(0);
}

async function sideways(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

test("on a phone, from a discovery time to a confirmed booking without a chair", async ({ page }) => {
  await fromDiscoveryToTable(page, 8);
  expect(await sideways(page)).toBe(false);
  await page.getByRole("button", { name: "Continue with this table" }).click();
  await expect(page.getByRole("form", { name: "Your details" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Booking steps" }).locator('[aria-current="step"]')).toContainText("Details");
  await page.getByLabel("Name for the booking").fill("Journey Diner");
  await page.getByLabel("Email", { exact: true }).fill("journey.diner@example.com");
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: "Booking confirmed." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage booking" })).toBeVisible();
  expect(await sideways(page)).toBe(false);
});

test("on a phone, from a discovery time to a confirmed booking with a chair request", async ({ page }) => {
  await fromDiscoveryToTable(page, 9);
  await page.getByRole("button", { name: "Continue with this table" }).click();
  await page.getByRole("button", { name: "Choose a chair" }).click();
  await expect(page.getByRole("heading", { name: /Request a chair/ })).toBeVisible();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Save chair request" }).click();
  await expect(page.getByText(/Chair requested/)).toBeVisible();
  await page.getByLabel("Name for the booking").fill("Chair Journey");
  await page.getByLabel("Email", { exact: true }).fill("chair.journey@example.com");
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: "Booking confirmed." })).toBeVisible();
  await expect(page.getByText("Chair request", { exact: true })).toBeVisible();
  expect(await sideways(page)).toBe(false);
});

test("at 320 px, accessible tables and expanded choices work with the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto(`/restaurants/tagus-terrace?date=${isoDaysFromToday(10)}&time=20:00&party=2`);
  const accessible = page.getByRole("checkbox", { name: "I need a wheelchair-accessible table" });
  await accessible.focus();
  const filtered = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/map") && new URL(response.url()).searchParams.get("accessible") === "true");
  await page.keyboard.press("Space");
  expect((await filtered).ok()).toBe(true);
  await expect(accessible).toBeChecked();
  await expect(accessible).toBeFocused();
  const more = page.getByRole("button", { name: "Choose another table" });
  await more.press("Enter");
  await expect(page.getByRole("button", { name: "Map", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "List", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Tables that suit your party" })).toBeVisible();
  await page.getByRole("button", { name: /Back to the suggested table/ }).press("Enter");
  await expect(more).toBeFocused();
  const continueButton = page.getByRole("button", { name: "Continue with this table" });
  expect((await continueButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await sideways(page)).toBe(false);
  await page.getByRole("button", { name: "Edit date, time and guests" }).click();
  await expect(page.getByRole("checkbox", { name: "Someone needs an accessible table" })).toBeChecked();
});

test("a sold-out link at 390 px shows nearby times for the same date and party", async ({ page }) => {
  const date = isoDaysFromToday(11);
  await page.route("**/slots?**", async (route) => {
    const response = await route.fetch();
    const answer: ServerSlots = await response.json();
    // Keep the server's times, simulating another diner taking the final table at 20:00.
    await route.fulfill({ response, json: {
      ...answer,
      slots: answer.slots.map((slot) => slot.time === "20:00" ? { ...slot, status: "full" } : slot),
    } });
  });
  await page.goto(`/restaurants/tagus-terrace?date=${date}&time=20:00&party=2`);
  await expect(page.getByRole("heading", { name: "Pick another time" })).toBeFocused();
  await expect(page.getByText("20:00 is not available.")).toBeVisible();
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue(date);
  const alternatives = page.getByRole("region", { name: "Next available times" });
  const next = alternatives.getByRole("link").first();
  await expect(next).toBeVisible();
  const time = (await next.textContent())?.match(/\d\d:\d\d/)?.[0];
  await next.click();
  await page.getByRole("button", { name: `Choose a table at ${time}` }).click();
  await expect(page.getByRole("heading", { name: "Choose your table" })).toBeFocused();
  await expect(page.getByText(new RegExp(`${time}.*2 guests`)).first()).toBeVisible();
  expect(await sideways(page)).toBe(false);
});

test("an expired table hold at 390 px restores selection and preserves entered details", async ({ page }) => {
  await page.clock.install();
  await page.goto(`/restaurants/tagus-terrace?date=${isoDaysFromToday(12)}&time=20:00&party=2`);
  const holdResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/hold"));
  await page.getByRole("button", { name: "Continue with this table" }).click();
  const hold = await holdResponse;
  expect(hold.ok()).toBe(true);
  const { hold_id: id } = await hold.json() as { hold_id: string };
  await page.getByLabel("Name for the booking").fill("Expiry Diner");
  await page.getByLabel("Email", { exact: true }).fill("expiry@example.com");
  // Release the real server-side hold, then move the browser past its expiry.
  expect((await page.request.delete(`${hold.url()}/${encodeURIComponent(id)}`)).ok()).toBe(true);
  await page.clock.fastForward(301_000);
  await expect(page.getByRole("heading", { name: "Choose your table" })).toBeFocused();
  const recovery = page.getByRole("alert").filter({ hasText: /expired/ });
  await expect(recovery).toContainText("Your details are saved for this booking.");
  // Bring the browser clock back in sync before accepting a fresh server-side hold.
  await page.clock.setSystemTime(new Date());
  await recovery.getByRole("button", { name: /Hold table/ }).first().click();
  await expect(page.getByLabel("Name for the booking")).toHaveValue("Expiry Diner");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("expiry@example.com");
  expect(await sideways(page)).toBe(false);
});
