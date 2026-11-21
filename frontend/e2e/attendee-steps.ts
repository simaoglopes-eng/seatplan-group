// Steps of the attendee journey that both the desktop and the phone tests use.

import { expect, type Page } from "@playwright/test";

/**
 * From a fresh personal link to the "Choose your seat" step. The demo data
 * decides whether the guest still has to reply and whether the optional
 * "People you know" step shows, so each of those is answered only if it appears.
 */
export async function goToSeatStep(page: Page, link: string): Promise<void> {
  await page.goto(link);
  const seatHeading = page.getByRole("heading", { name: "Choose your seat" });
  const yes = page.getByRole("button", { name: "Yes, I will be there" });
  const skip = page.getByRole("button", { name: "Skip this step" });

  await expect(seatHeading.or(yes).or(skip)).toBeVisible();
  if (await yes.isVisible()) await yes.click();
  await expect(seatHeading.or(skip)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(seatHeading).toBeVisible();
}

/** The first card under "Recommended for you", and the seat name it shows, such as "Table 4, seat 3". */
export async function firstRecommendation(page: Page) {
  const card = page.getByRole("list", { name: "Recommended for you" }).getByRole("button").first();
  await expect(card).toBeVisible();
  const seatName = (await card.locator(".ev-rec-seat").innerText()).trim();
  expect(seatName).toMatch(/^(Table|Row) .+, seat .+$/);
  return { card, seatName };
}

/** The seat on the SVG map whose spoken name starts with `seatName`. */
export function seatOnMap(page: Page, seatName: string) {
  const escaped = seatName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByRole("option", { name: new RegExp(`^${escaped}, `) });
}

/** The page should now show the success step with that seat. */
export async function expectConfirmed(page: Page, seatName: string): Promise<void> {
  await expect(page.getByRole("heading", { name: "You are all set" })).toBeVisible();
  await expect(page.locator(".ev-seat-big")).toHaveText(seatName);
}

/** One card of "Who is sitting where?": a name left out keeps what the page filled in (or "Guest" when it is empty). */
export interface PersonDetails {
  first?: string;
  last?: string;
  age: string;
}

/**
 * "Who is sitting where?": one card per chosen seat, the booker first. Fills
 * every card, checks Confirm is unavailable until the last age is in, then
 * confirms all seats at once.
 */
export async function fillWhoSitsWhere(page: Page, people: PersonDetails[]): Promise<void> {
  await expect(page.getByRole("heading", { name: "Who is sitting where?" })).toBeVisible();
  const cards = page.locator("fieldset.party-card");
  await expect(cards).toHaveCount(people.length);
  const count = people.length;
  const confirm = page.getByRole("button", { name: `Confirm ${count} ${count === 1 ? "seat" : "seats"}` });
  for (const [index, person] of people.entries()) {
    const card = cards.nth(index);
    for (const [label, value] of [["First name", person.first], ["Last name", person.last]] as const) {
      const field = card.getByLabel(label, { exact: true });
      if (value !== undefined) await field.fill(value);
      else if ((await field.inputValue()).trim() === "") await field.fill("Guest");
    }
    if (index === count - 1) await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await card.getByLabel("Age", { exact: true }).fill(person.age);
  }
  await expect(confirm).not.toHaveAttribute("aria-disabled", "true");
  await confirm.click();
}
