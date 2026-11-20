import { join } from "node:path";
import { tmpdir } from "node:os";
import AxeBuilder from "@axe-core/playwright";
import { demoLinks, expect, lastPart, test } from "./fixtures";
import { openOwnerRoom } from "./room-session";

for (const width of [1440, 390]) {
  test(`owner places fixed elements and zones with undo at ${width}px`, async ({ page, request }) => {
    const links = await demoLinks(request);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
    await page.getByRole("button", { name: "Fixed", exact: true }).click();
    await page.getByRole("button", { name: "Place Bar", exact: true }).click();
    await expect(page.getByLabel("Object width (cm)")).toBeHidden();
    await page.getByText("Size, position and shape", { exact: true }).click();
    await page.getByLabel("Object x (cm)").fill("650");
    await page.getByLabel("Object x (cm)").press("Tab");
    await page.getByLabel("Object y (cm)").fill("250");
    await page.getByLabel("Object y (cm)").press("Tab");
    await page.getByLabel("Object width (cm)").fill("220");
    await page.getByLabel("Object width (cm)").press("Tab");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByLabel("Object width (cm)")).toHaveValue("150");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.getByLabel("Object width (cm)")).toHaveValue("220");
    await page.getByLabel("Object rotation (degrees)").fill("45");
    await page.getByLabel("Object rotation (degrees)").press("Tab");
    await page.screenshot({ path: join(tmpdir(), `seatplan-room-fixed-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Place Quiet zone", exact: true }).click();
    await page.getByRole("button", { name: "Remove zone", exact: true }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.getByLabel("Selected fixed element").selectOption({ label: "Quiet zone" });
    await expect(page.getByRole("button", { name: "Remove zone", exact: true })).toBeVisible();
    await page.screenshot({ path: join(tmpdir(), `seatplan-room-zones-${width}.png`), fullPage: true });
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("palette drop places a fixture and moving it makes one undo step", async ({ page, request }) => {
  const links = await demoLinks(request);
  await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
  await page.getByRole("button", { name: "Fixed", exact: true }).click();
  await page.getByRole("button", { name: "Place TV", exact: true }).dragTo(page.locator(".room-canvas"), { targetPosition: { x: 400, y: 200 } });
  await expect(page.getByRole("button", { name: "Remove fixed element", exact: true })).toBeVisible();
  await expect(page.getByLabel("Fixed element shape")).toHaveValue("rect");
  const before = await page.getByLabel("Object x (cm)").inputValue();
  const circle = (await page.locator(".room-fixture > rect").first().boundingBox())!;
  await page.mouse.move(circle.x + circle.width / 2, circle.y + circle.height / 2);
  await page.mouse.down();
  await page.mouse.move(circle.x + circle.width / 2 + 90, circle.y + circle.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(Number(await page.getByLabel("Object x (cm)").inputValue())).toBeGreaterThan(Number(before));
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Object x (cm)")).toHaveValue(before);
});

test("a fixed element stays inside the room, on a chessboard, and can be placed freely", async ({ page, request }) => {
  const links = await demoLinks(request);
  await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
  await expect(page.locator("[data-room-checker]")).toHaveCount(1);
  await page.getByRole("button", { name: "Fixed", exact: true }).click();
  await page.getByRole("button", { name: "Place WC", exact: true }).click();
  await page.getByText("Size, position and shape", { exact: true }).click();
  const x = page.getByLabel("Object x (cm)");
  expect(Number(await x.inputValue()) % 50).toBe(0); // on the grid by default
  const wc = (await page.locator(".room-fixture").first().boundingBox())!;
  const canvas = (await page.locator(".room-canvas").boundingBox())!;
  await page.mouse.move(wc.x + wc.width / 2, wc.y + wc.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width - 4, wc.y + wc.height / 2, { steps: 12 });
  await page.mouse.up();
  expect(Number(await x.inputValue()) + Number(await page.getByLabel("Object width (cm)").inputValue())).toBeLessThanOrEqual(1100); // stopped at the wall
  await x.fill("5000");
  await x.press("Tab");
  await expect(page.getByText("Keep the element inside the room.", { exact: true })).toBeVisible();
  await page.getByLabel("Free placement (no grid snapping)").check();
  await expect(page.getByLabel("Free placement (no grid snapping)")).toBeChecked();
});

test("a selected fixed element is resized by pulling its grips, like a picture in a slide", async ({ page, request }) => {
  const links = await demoLinks(request);
  await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
  await page.getByRole("button", { name: "Fixed", exact: true }).click();
  const icons = await page.locator(".room-fixture-icon").count();
  await page.getByRole("button", { name: "Place Bar", exact: true }).click();
  await expect(page.locator(".room-fixture-icon")).toHaveCount(icons + 1); // the new bar wears its icon
  await expect(page.locator("[data-fixture-grip]")).toHaveCount(0); // added, but not clicked: no grips yet
  const bar = (await page.locator(".room-fixture > rect").last().boundingBox())!;
  await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await expect(page.locator("[data-fixture-grip]")).toHaveCount(8); // clicked: grips appear
  const width = page.getByLabel("Object width (cm)"), height = page.getByLabel("Object height (cm)"), x = page.getByLabel("Object x (cm)");
  const [w0, h0, x0] = [Number(await width.inputValue()), Number(await height.inputValue()), Number(await x.inputValue())];
  const grip = page.locator('[data-fixture-grip="1,1"]'); // bottom right corner
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  expect(Number(await width.inputValue())).toBeGreaterThan(w0);
  expect(Number(await height.inputValue())).toBeGreaterThan(h0);
  expect(Number(await x.inputValue())).toBe(x0); // the opposite corner stayed put
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(width).toHaveValue(String(w0));
  const left = page.locator('[data-fixture-grip="-1,0"]'); // left side: only the width changes
  const side = (await left.boundingBox())!;
  await page.mouse.move(side.x + side.width / 2, side.y + side.height / 2);
  await page.mouse.down();
  await page.mouse.move(side.x + side.width / 2 - 50, side.y + side.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(Number(await width.inputValue())).toBeGreaterThan(w0);
  await expect(height).toHaveValue(String(h0));
  const canvas = (await page.locator(".room-canvas").boundingBox())!;
  await page.mouse.click(canvas.x + 20, canvas.y + 20); // empty space beside the room
  await expect(page.locator("[data-fixture-grip]")).toHaveCount(0);
});

test("a fixed element is turned with its rotation grip", async ({ page, request }) => {
  const links = await demoLinks(request);
  await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
  await page.getByRole("button", { name: "Fixed", exact: true }).click();
  await page.getByRole("button", { name: "Place TV", exact: true }).click();
  await expect(page.locator("[data-fixture-rotate]")).toHaveCount(0); // not clicked yet
  const tv = (await page.locator(".room-fixture > rect").last().boundingBox())!;
  await page.mouse.click(tv.x + tv.width / 2, tv.y + tv.height / 2);
  await expect(page.locator("[data-fixture-rotate]")).toHaveCount(1);
  const rotation = page.getByLabel("Object rotation (degrees)");
  await expect(rotation).toHaveValue("0");
  const grip = (await page.locator("[data-fixture-rotate] circle").last().boundingBox())!;
  const centre = { x: tv.x + tv.width / 2, y: tv.y + tv.height / 2 };
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(centre.x + 120, centre.y, { steps: 8 }); // swing it to the right of the centre
  await page.mouse.up();
  await expect(rotation).toHaveValue("90");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(rotation).toHaveValue("0");
});

test("a grip answers only right on its square, so the rest of the element still drags it", async ({ page, request }) => {
  const links = await demoLinks(request);
  await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
  await page.getByRole("button", { name: "Fixed", exact: true }).click();
  await page.getByRole("button", { name: "Place Bar", exact: true }).click();
  const body = (await page.locator(".room-fixture > rect").last().boundingBox())!;
  await page.mouse.click(body.x + body.width / 2, body.y + body.height / 2);
  await expect(page.locator("[data-fixture-grip]")).toHaveCount(8);
  const square = (await page.locator('[data-fixture-grip="-1,-1"] rect').boundingBox())!;
  expect(square.width).toBeLessThanOrEqual(9); // small squares
  const width = page.getByLabel("Object width (cm)"), x = page.getByLabel("Object x (cm)");
  const [w0, x0] = [await width.inputValue(), Number(await x.inputValue())];
  await page.mouse.move(body.x + 16, body.y + 16); // inside the corner, but not on the square
  await page.mouse.down();
  await page.mouse.move(body.x + 16 + 80, body.y + 16, { steps: 6 });
  await page.mouse.up();
  await expect(width).toHaveValue(w0); // not resized
  expect(Number(await x.inputValue())).toBeGreaterThan(x0); // moved
});

test("a quiet zone may stand outside the room, a fixed element may not, and there is no Zones tab", async ({ page, request }) => {
  const links = await demoLinks(request);
  await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
  await expect(page.getByRole("button", { name: "Zones", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Fixed", exact: true }).click();
  await expect(page.getByRole("button", { name: "Place Terrace", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Place Quiet zone", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove zone", exact: true })).toBeVisible();
  await page.getByText("Size and position", { exact: true }).click();
  const x = page.getByLabel("Object x (cm)");
  await x.fill("3000"); // far beyond the walls
  await x.press("Tab");
  await expect(x).toHaveValue("3000");
  await expect(page.getByText("Keep the element inside the room.")).toHaveCount(0);
  await page.getByRole("button", { name: "Place WC", exact: true }).click();
  await page.getByText("Size, position and shape", { exact: true }).click();
  const wcX = page.getByLabel("Object x (cm)");
  await wcX.fill("3000");
  await wcX.press("Tab");
  await expect(page.getByText("Keep the element inside the room.", { exact: true })).toBeVisible();
});
