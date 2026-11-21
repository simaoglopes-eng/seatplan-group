import { join } from "node:path";
import { tmpdir } from "node:os";
import { demoLinks, expect, lastPart, test } from "./fixtures";
import { openOwnerRoom } from "./room-session";

test("a terrace follows a sloping wall and tables can stand on it", async ({ page, request }) => {
  const links = await demoLinks(request);
  await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
  await page.getByRole("button", { name: "Add room", exact: true }).click();
  await page.getByLabel("Room name", { exact: true }).fill("Sloping room");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  // Tilt the bottom wall by pulling its right-hand corner up.
  const corner = page.locator('[data-shape-handle="corner-2"]');
  const box = (await corner.boundingBox())!;
  await page.getByRole("button", { name: "Shape", exact: true }).click();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 30, { steps: 6 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Walls", exact: true }).click();
  await page.getByLabel("Wall", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Add terrace", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Tables", exact: true }).click();
  await page.getByLabel("Put new tables").selectOption({ label: "On Terrace" });
  await page.getByRole("button", { name: "Place Round table", exact: true }).click();
  await expect(page.locator(".room-invalid-table")).toHaveCount(0);
  await page.screenshot({ path: join(tmpdir(), "seatplan-room-terrace-slope.png"), fullPage: true });
});
