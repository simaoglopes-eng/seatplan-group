import { demoLinks, expect, lastPart, test } from "./fixtures";
import { openOwnerRoom } from "./room-session";
import { join } from "node:path";
import { tmpdir } from "node:os";
import AxeBuilder from "@axe-core/playwright";

test("an outside table is marked and its problem selects and centres the table", async ({ page, request }) => {
  const links = await demoLinks(request);
  await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
  const token = await page.evaluate(() => sessionStorage.getItem("seatplan.session"));
  const made = await request.post("/api/owner/restaurants", { data: { name: "Validation restaurant" }, headers: { Authorization: `Bearer ${token}` } });
  expect(made.status()).toBe(201);
  const vid = ((await made.json()) as { public_id: string }).public_id;
  await page.goto(`/owner/${vid}/rooms`);
  await page.getByRole("button", { name: "Add room", exact: true }).click();
  await page.getByLabel("Room name", { exact: true }).fill("Validation room");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await page.getByRole("button", { name: "Tables", exact: true }).click();
  await page.getByRole("button", { name: "Place Round table", exact: true }).click();
  await page.locator(".room-canvas").focus();
  for (let i = 0; i < 80; i++) await page.keyboard.press("Shift+ArrowRight"); // 8 m to the right: beyond the walls
  await expect(page.locator(".room-invalid-table")).toHaveCount(1);
  await page.getByRole("button", { name: "Shape", exact: true }).click();
  await page.getByRole("button", { name: /Table 1 is outside the walls/ }).click();
  await expect(page.getByRole("button", { name: "Tables", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".room-invalid-table .room-table")).toBeInViewport();
  await page.screenshot({ path: join(tmpdir(), "seatplan-room-validation-1440.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Table 1 is outside the walls/ }).click();
  await expect(page.locator(".room-invalid-table .room-table")).toBeInViewport();
  await page.screenshot({ path: join(tmpdir(), "seatplan-room-validation-390.png"), fullPage: true });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
});
