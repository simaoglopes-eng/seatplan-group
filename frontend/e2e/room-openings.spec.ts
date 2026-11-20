import { tmpdir } from "node:os";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { demoLinks, expect, lastPart, test } from "./fixtures";
import { openOwnerRoom } from "./room-session";

for (const width of [1440, 390]) {
  test(`owner adds windows with north at the top at ${width}px`, async ({ page, request }) => {
    const links = await demoLinks(request);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
    await page.getByRole("button", { name: "Walls", exact: true }).click();
    await page.getByRole("button", { name: "Add window", exact: true }).click();
    await expect(page.getByLabel("Opening width (cm)")).toBeVisible();
    for (const gone of ["Window top height (cm)", "View", "View at night", "Sun"]) await expect(page.getByLabel(gone, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("img", { name: "North is at the top of the plan" })).toBeVisible();
    await page.screenshot({ path: join(tmpdir(), `seatplan-room-north-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Walls", exact: true }).click();
    await page.getByRole("button", { name: "Add door", exact: true }).click();
    await page.getByLabel("This door is the main entrance").check();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByLabel("This door is the main entrance")).not.toBeChecked();
    await page.screenshot({ path: join(tmpdir(), `seatplan-room-openings-${width}.png`), fullPage: true });
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("opening gestures resize and move in single undo steps, and the north compass is a fixed mark", async ({ page, request }) => {
  const links = await demoLinks(request);
  await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
  await page.getByRole("button", { name: "Walls", exact: true }).click();
  await page.getByRole("button", { name: "Add window", exact: true }).click();
  const body = (await page.locator("[data-opening-body]").boundingBox())!;
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2);
  await page.mouse.down();
  await page.mouse.move(body.x + body.width / 2 + 100, body.y + body.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await page.locator("[data-opening-body]").boundingBox())!.x).toBeGreaterThan(body.x + 20); // it moved along the wall
  await expect(page.getByLabel("Opening offset (cm)")).toHaveCount(0); // the position is set on the plan, not in a field
  const end = (await page.locator('[data-opening-handle="end"]').boundingBox())!;
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2 + 70, end.y + end.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(Number(await page.getByLabel("Opening width (cm)").inputValue())).toBeGreaterThan(120);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Opening width (cm)")).toHaveValue("120");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(Math.abs((await page.locator("[data-opening-body]").boundingBox())!.x - body.x)).toBeLessThan(1);
  await expect(page.getByRole("img", { name: "North is at the top of the plan" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "North direction" })).toHaveCount(0);
});

test("the owner says what is outside a wall, it is drawn and saved, and suggestions need the location", async ({ page, request }) => {
  const links = await demoLinks(request);
  await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
  await page.getByRole("button", { name: "Walls", exact: true }).click();
  await expect(page.locator("[data-room-view]")).toHaveCount(0);
  await page.getByLabel("Wall", { exact: true }).selectOption("2");
  await page.getByLabel("What is outside").selectOption("sea");
  await expect(page.locator('[data-room-view="sea"]')).toHaveCount(1);
  await page.getByLabel("Wall", { exact: true }).selectOption("1");
  await page.getByLabel("What is outside").selectOption("park");
  await expect(page.locator("[data-room-view]")).toHaveCount(2);
  await page.getByLabel("What is outside").selectOption("");
  await expect(page.locator("[data-room-view]")).toHaveCount(1);
  // Saved with the room: it comes back after a reload.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /Unsaved|Saved/ })).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Walls", exact: true }).click();
  await expect(page.locator('[data-room-view="sea"]')).toHaveCount(1);
  // The suggestion reads the map around the restaurant; with the map unreachable it says so and the owner can still choose.
  await page.route("https://tiles.openfreemap.org/**", route => route.abort());
  await page.getByRole("button", { name: "Suggest from my location" }).click();
  await expect(page.getByText(/Could not look around your location/)).toBeVisible();
});


test("a terrace is chosen on a wall, tables can stand on it, and it is saved", async ({ page, request }) => {
  const links = await demoLinks(request);
  await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
  await page.getByRole("button", { name: "Add room", exact: true }).click();
  await page.getByLabel("Room name", { exact: true }).fill("Terrace room");
  await page.getByRole("button", { name: "Create room", exact: true }).click();
  await page.getByRole("button", { name: "Fixed", exact: true }).click();
  await expect(page.getByRole("button", { name: "Place Terrace", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Walls", exact: true }).click();
  await expect(page.locator("[data-room-object]")).toHaveCount(0);
  await page.getByLabel("Wall", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Add terrace", exact: true }).click();
  await expect(page.locator(".room-zone")).toHaveCount(1);
  await expect(page.getByLabel("Terrace depth (m)")).toHaveValue(/2[,.]5/);
  // Its walls are changed on the plan, like the room's: click the terrace, then pull a side.
  const area = (await page.locator(".room-zone-terrace > rect").boundingBox())!;
  await page.mouse.click(area.x + area.width / 2, area.y + area.height / 2);
  const grip = (await page.locator('[data-fixture-grip="0,1"]').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  const depth = Number((await page.getByLabel("Terrace depth (m)").inputValue()).replace(",", "."));
  expect(depth).toBeGreaterThan(2.6);
  await page.screenshot({ path: join(tmpdir(), "seatplan-room-terrace.png"), fullPage: true });
  await page.getByRole("button", { name: "Tables", exact: true }).click();
  await page.getByLabel("Put new tables").selectOption({ label: "On Terrace" });
  await page.getByRole("button", { name: "Place Round table", exact: true }).click();
  await expect(page.locator(".room-invalid-table")).toHaveCount(0); // outside the walls, but on the terrace
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /Unsaved|Saved/ })).toHaveText("Saved");
  await page.reload();
  await page.getByLabel("Room", { exact: true }).selectOption({ label: "Terrace room" });
  await page.getByRole("button", { name: "Walls", exact: true }).click();
  await page.getByLabel("Wall", { exact: true }).selectOption("2");
  await expect(page.getByRole("button", { name: "Remove terrace", exact: true })).toBeVisible();
});
