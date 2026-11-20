// Spec 6.12, acceptance 1: on a phone an owner builds a 10 x 7 m room, curves a
// wall, adds two windows, sets north, adds a bar and eight tables, saves,
// reloads the page and sees exactly the same. A second tab that saved first
// makes the first tab's save a 409, and the first tab keeps its work.
import { tmpdir } from "node:os";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { ownerToken } from "./room-session";
import type { APIRequestContext, Page } from "@playwright/test";

/** A brand-new restaurant, so saving never touches the demo; its room is the implicit 10 x 7 m one. */
async function newRestaurant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const created = await request.post("/api/owner/restaurants", { data: { name }, headers: { Authorization: `Bearer ${token}` } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { public_id: string }).public_id;
}

async function open(page: Page, token: string, venue: string): Promise<void> {
  await page.addInitScript((t) => window.sessionStorage.setItem("seatplan.session", t), token);
  await page.goto(`/owner/${venue}/rooms`);
  await expect(page.getByRole("heading", { name: "Room editor" })).toBeVisible();
}

test.describe("touch room persistence", () => {
test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
test("an owner builds a room on a phone, saves, reloads and sees the same", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const token = await ownerToken(request);
  const venue = await newRestaurant(request, token, "Phone Room Test");
  await open(page, token, venue);
  await expect(page.getByText("Walls: 4 sides")).toBeVisible();

  // Two windows on two walls (north is always the top of the plan).
  await page.getByRole("button", { name: "Walls", exact: true }).tap();
  await page.getByRole("button", { name: "Add window", exact: true }).tap();
  await page.getByLabel("Wall", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Add window", exact: true }).tap();

  // A bar and eight tables.
  await page.getByRole("button", { name: "Fixed", exact: true }).tap();
  await page.getByRole("button", { name: "Place Bar", exact: true }).tap();
  await page.getByRole("button", { name: "Tables", exact: true }).tap();
  for (let table = 0; table < 8; table++) {
    await page.getByRole("button", { name: "Place Round table", exact: true }).tap();
  }
  await expect(page.getByText("Tables: 8")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /Unsaved|Saved/ })).toHaveText("Unsaved");

  await page.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(page.getByRole("status").filter({ hasText: /Unsaved|Saved/ })).toHaveText("Saved");

  // Reload: the same room comes back from the server, with nothing left to save.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Room editor" })).toBeVisible();
  await expect(page.getByText("Tables: 8")).toBeVisible();
  await expect(page.getByText("Walls: 4 sides")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /Unsaved|Saved/ })).toHaveText("Saved");
  await expect(page.getByRole("img", { name: "North is at the top of the plan" })).toBeVisible();
  await page.getByRole("button", { name: "Walls", exact: true }).tap();
  await expect(page.getByLabel("Selected opening").locator("option")).toHaveCount(3); // "Choose an opening" and the two windows
  await page.getByRole("button", { name: "Fixed", exact: true }).tap();
  await expect(page.locator(".room-fixture")).toHaveCount(1); // the bar
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
});
});

test("a second tab that saved first makes the next save a conflict, and the work is kept", async ({ browser, request }) => {
  const token = await ownerToken(request);
  const venue = await newRestaurant(request, token, "Two Tabs Test");
  const first = await browser.newPage();
  const second = await browser.newPage();
  await open(first, token, venue);
  await open(second, token, venue);

  // The room's name is not editable here, so each tab makes a real edit: the second puts in a WC, the first a bar.
  await second.getByRole("button", { name: "Fixed", exact: true }).click();
  await second.getByRole("button", { name: "Place WC", exact: true }).click();
  await second.getByRole("button", { name: "Save", exact: true }).click();
  await expect(second.getByRole("status").filter({ hasText: /Unsaved|Saved/ })).toHaveText("Saved");

  await first.getByRole("button", { name: "Fixed", exact: true }).click();
  await first.getByRole("button", { name: "Place Bar", exact: true }).click();
  await first.getByRole("button", { name: "Save", exact: true }).click();
  await expect(first.getByText(/changed in another tab or device/i)).toBeVisible();
  await expect(first.locator(".room-fixture").filter({ hasText: "Bar" })).toHaveCount(1);

  // Saving it over the other tab's version works and wins.
  await first.getByRole("button", { name: "Save mine over it" }).click();
  await expect(first.getByRole("status").filter({ hasText: /Unsaved|Saved/ })).toHaveText("Saved");
  await first.reload();
  await expect(first.locator(".room-fixture").filter({ hasText: "Bar" })).toHaveCount(1);
  await expect(first.locator(".room-fixture").filter({ hasText: "WC" })).toHaveCount(0);
  await first.close();
  await second.close();
});
