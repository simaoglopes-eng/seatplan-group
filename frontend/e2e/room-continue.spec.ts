import { demoLinks, expect, lastPart, test } from "./fixtures";
import { openOwnerRoom } from "./room-session";

test("the floor plan has a way forward: it saves what is unsaved, then moves on to the review", async ({ page, request }) => {
  const links = await demoLinks(request);
  await openOwnerRoom(page, request, lastPart(links.restaurant_booking));
  await page.getByRole("button", { name: "Tables", exact: true }).click();
  await page.getByRole("button", { name: "Place Square table", exact: true }).click();
  await page.getByRole("button", { name: "Save and continue to review", exact: true }).click();
  await expect(page).toHaveURL(/\/owner\/[^/]+\/review$/);
  // Back in the editor with nothing unsaved, the same button just goes on.
  await page.goBack();
  await expect(page.getByRole("status").filter({ hasText: /Unsaved|Saved/ })).toHaveText("Saved");
  await page.getByRole("button", { name: "Continue to review", exact: true }).click();
  await expect(page).toHaveURL(/\/owner\/[^/]+\/review$/);
});
