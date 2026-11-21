import { join } from "node:path";
import { tmpdir } from "node:os";
import AxeBuilder from "@axe-core/playwright";
import { demoLinks, expect, lastPart, test } from "./fixtures";
import { openOwnerRoom } from "./room-session";

for (const width of [1440, 390]) {
  test(`owner edits a counter and its chairs at ${width}px`, async ({ page, request }) => {
    const links = await demoLinks(request);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
    await page.getByRole("button", { name: "Tables", exact: true }).click();
    await page.getByRole("button", { name: "Place Counter", exact: true }).click();
    await page.getByRole("button", { name: "Add chair", exact: true }).click();
    await expect(page.getByText("6 chairs", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByText("5 chairs", { exact: true })).toBeVisible();
    await page.screenshot({ path: join(tmpdir(), `seatplan-room-tables-${width}.png`), fullPage: true });
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("moving a table carries its chairs, and a chair can then move independently", async ({ page, request }) => {
  const links = await demoLinks(request);
  await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
  await page.getByRole("button", { name: "Add room", exact: true }).click(); // an empty room: nothing else in the way
  await page.getByLabel("Room name", { exact: true }).fill("Moving tables");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await page.getByRole("button", { name: "Tables", exact: true }).click();
  await page.getByRole("button", { name: "Place Counter", exact: true }).click();
  const key = await page.getByLabel("Selected table", { exact: true }).inputValue();
  const body = page.locator(`[data-room-table="${key}"] .room-table`), chair = page.locator(".room-seat").first();
  const before = { table: (await body.boundingBox())!, chair: (await chair.boundingBox())! };
  const centre = { x: before.table.x + before.table.width / 2, y: before.table.y + before.table.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 60, centre.y, { steps: 5 });
  await page.mouse.up();
  const moved = { table: (await body.boundingBox())!, chair: (await chair.boundingBox())! };
  expect(moved.table.x - before.table.x).toBeGreaterThan(20);
  expect(Math.abs((moved.chair.x - before.chair.x) - (moved.table.x - before.table.x))).toBeLessThan(2); // the chair travels with it
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(Math.abs((await body.boundingBox())!.x - before.table.x)).toBeLessThan(1);
  // A chair can be dragged on its own.
  const seat = (await chair.boundingBox())!;
  await page.mouse.move(seat.x + seat.width / 2, seat.y + seat.height / 2);
  await page.mouse.down();
  await page.mouse.move(seat.x + seat.width / 2 + 30, seat.y + seat.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await chair.boundingBox())!.x).toBeGreaterThan(seat.x + 10);
  expect(Math.abs((await body.boundingBox())!.x - before.table.x)).toBeLessThan(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(Math.abs((await chair.boundingBox())!.x - seat.x)).toBeLessThan(1);
});
