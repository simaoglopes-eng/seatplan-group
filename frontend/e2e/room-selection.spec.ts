import { demoLinks, expect, lastPart, test } from "./fixtures";
import { openOwnerRoom } from "./room-session";
import { join } from "node:path";
import { tmpdir } from "node:os";
import AxeBuilder from "@axe-core/playwright";

const count = async (page: import("@playwright/test").Page) => Number(((await page.getByText(/^Tables: \d+$/).textContent()) ?? "").replace("Tables: ", ""));

test("owner duplicates and deletes a table with the keyboard, with undo", async ({ page, request }) => {
  const links = await demoLinks(request);
  await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
  await page.getByRole("button", { name: "Tables", exact: true }).click();
  const start = await count(page);
  await page.getByRole("button", { name: "Place Square table", exact: true }).click();
  await expect(page.getByText(`Tables: ${start + 1}`, { exact: true })).toBeVisible();
  await page.locator(".room-canvas").focus();
  await page.keyboard.press("Control+d");
  await expect(page.getByText(`Tables: ${start + 2}`, { exact: true })).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(page.getByText(`Tables: ${start + 1}`, { exact: true })).toBeVisible();
  await page.keyboard.press("Control+y");
  await expect(page.getByText(`Tables: ${start + 2}`, { exact: true })).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(page.getByText(`Tables: ${start + 1}`, { exact: true })).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(page.getByText(`Tables: ${start + 2}`, { exact: true })).toBeVisible();
});

test("a table turns with its grip but has no way to be resized by hand", async ({ page, request }) => {
  const links = await demoLinks(request);
  await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
  await page.getByRole("button", { name: "Add room", exact: true }).click();
  await page.getByLabel("Room name", { exact: true }).fill("Selection gestures");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await page.getByRole("button", { name: "Tables", exact: true }).click();
  await page.getByRole("button", { name: "Place Long table", exact: true }).click();
  const key = await page.getByLabel("Selected table", { exact: true }).inputValue();
  await expect(page.locator('[data-table-handle="resize"]')).toHaveCount(0);
  await expect(page.getByText("Size and position", { exact: true })).toHaveCount(0);
  const body = page.locator(`[data-room-table="${key}"] .room-table`);
  const flat = (await body.boundingBox())!;
  expect(flat.width).toBeGreaterThan(flat.height);
  const handle = (await page.locator('[data-table-handle="rotate"]').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(flat.x + flat.width / 2 + 200, flat.y + flat.height / 2, { steps: 5 }); await page.mouse.up();
  const turned = (await body.boundingBox())!;
  expect(turned.height).toBeGreaterThan(turned.width); // a quarter turn
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const back = (await body.boundingBox())!;
  expect(back.width).toBeGreaterThan(back.height);
  await page.screenshot({ path: join(tmpdir(), "seatplan-room-selection-1440.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Fit room", exact: true }).click();
  await page.screenshot({ path: join(tmpdir(), "seatplan-room-selection-390.png"), fullPage: true });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
});
