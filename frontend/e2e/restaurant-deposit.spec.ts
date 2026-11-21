// Deposits, end to end with the real backend and the demo payment provider (no money moves):
// the owner asks for a deposit, a diner accepts it and "pays" on the demo page, the booking is
// only confirmed after that, the staff see the deposit, and cancelling in time refunds it.

import { expect, test } from "./fixtures";
import { dinerMap, holdTable, preparedRestaurant, publishRestaurant } from "./restaurant-fixture";

type Venue = Awaited<ReturnType<typeof preparedRestaurant>>;

async function restaurantWithDeposit(request: Parameters<typeof preparedRestaurant>[0], name: string): Promise<Venue> {
  const venue = await preparedRestaurant(request, name);
  await publishRestaurant(request, venue);
  const rule = await request.put(`/api/owner/restaurants/${venue.id}/payments`, {
    headers: venue.headers,
    data: { policies: [{ service_name: "", per_person_cents: 1000, cancel_hours: 24, min_party: 1 }] },
  });
  expect(rule.status(), await rule.text()).toBe(200);
  return venue;
}

async function floorBookings(request: Parameters<typeof preparedRestaurant>[0], venue: Venue) {
  const floor = await request.get(`/api/staff/${venue.id}/floor?date=${venue.day}&time=13:00`, { headers: venue.headers });
  expect(floor.status(), await floor.text()).toBe(200);
  return ((await floor.json()) as { bookings: { status: string; payment?: { status: string; amount_cents: number } }[] }).bookings;
}

test("a diner accepts a deposit, pays on the demo page, and cancelling in time refunds it", async ({ page, request }) => {
  const venue = await restaurantWithDeposit(request, "Deposit acceptance");
  await dinerMap(page, venue.id, venue.day);
  await holdTable(page, "River 1");

  const panel = page.getByRole("form", { name: "Your details" });
  await expect(panel.getByRole("region", { name: "Deposit" })).toContainText("€20");
  await panel.getByLabel("Name for the booking").fill("Deposit Diner");
  await panel.getByLabel("Email", { exact: true }).fill("deposit.diner@example.com");

  // The terms must be accepted: without the tick nothing is booked.
  await panel.getByRole("button", { name: /Pay €20 deposit/ }).click();
  await expect(panel.getByText("Please accept the deposit terms to book this table.")).toBeVisible();
  expect(await floorBookings(request, venue)).toHaveLength(0);

  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: /Pay €20 deposit/ }).click();

  // The booking is saved and holds the table, but it is not confirmed until the deposit is paid.
  await expect(page).toHaveURL(/\/pay\/demo\//);
  await expect(page.getByText(/No real money moves and no card is needed/)).toBeVisible();
  const waiting = await floorBookings(request, venue);
  expect(waiting).toHaveLength(1);
  expect(waiting[0]).toMatchObject({ status: "pending", payment: { status: "pending", amount_cents: 2000 } });

  await page.getByRole("button", { name: "Pay €20 (demo)" }).click();
  await expect(page.getByRole("heading", { name: "Booking confirmed." })).toBeVisible();
  await expect(page.getByText(/Deposit paid: €20/)).toBeVisible();
  const paid = await floorBookings(request, venue);
  expect(paid[0]).toMatchObject({ status: "confirmed", payment: { status: "paid", amount_cents: 2000 } });

  // The manage link shows the deposit and, before cancelling, what will happen to the money.
  await page.getByRole("link", { name: "Manage booking" }).click();
  await expect(page.getByTestId("deposit-line")).toContainText("Deposit paid: €20");
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByRole("dialog")).toContainText("You will get your €20 deposit back.");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByText(/This booking is cancelled\./)).toBeVisible();
  await expect(page.getByTestId("deposit-line")).toContainText("Deposit refunded: €20");
});

test("giving up on the payment page frees the table straight away", async ({ page, request }) => {
  const venue = await restaurantWithDeposit(request, "Deposit give-up");
  await dinerMap(page, venue.id, venue.day);
  await holdTable(page, "River 1");
  const panel = page.getByRole("form", { name: "Your details" });
  await panel.getByLabel("Name for the booking").fill("Give Up Diner");
  await panel.getByLabel("Email", { exact: true }).fill("giveup.diner@example.com");
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: /Pay €20 deposit/ }).click();
  await expect(page).toHaveURL(/\/pay\/demo\//);
  expect(await floorBookings(request, venue)).toHaveLength(1);

  await page.getByRole("button", { name: "Give up and release the table" }).click();
  await expect(page.getByRole("heading", { name: "We did not keep your table" })).toBeVisible();
  await expect(page.getByText(/Nothing was charged/)).toBeVisible();
  expect(await floorBookings(request, venue)).toHaveLength(0);
});

test("the owner sets the deposit rules from the Deposits page", async ({ page, request }) => {
  const venue = await preparedRestaurant(request, "Deposit owner page");
  await page.goto("/login?next=" + encodeURIComponent(`/owner/${venue.id}/payments`));
  await page.getByLabel("Email").fill("organiser@example.com");
  await page.getByLabel("Password").fill("demo-organiser-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Deposits" })).toBeVisible();
  await expect(page.getByText(/guests book without paying anything up front/)).toBeVisible();
  await page.getByRole("button", { name: "Add a rule" }).click();
  await page.getByLabel("Deposit per person (€)").fill("15");
  await page.getByRole("button", { name: "Save deposit rules" }).click();
  await expect(page.getByText("Deposit rules saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Deposit per person (€)")).toHaveValue("15");
});
