// Event room layouts (docs/api.md, "Event room layouts"): event staff switch a seeded
// event from Banquet to Theatre in the organiser's Layout tab, confirm because guests
// are seated, and every seated guest gets a seat on the new setup. The other event at
// the same quinta keeps its room and its seats. One sign-in only: the server allows 10
// a minute from one address, shared by every spec file.
//
// It changes Sofia and Tiago's wedding for the rest of the run. Later specs only read
// that event's name, type and hall (events-parity), which stay the same.

import type { APIRequestContext, Page } from "@playwright/test";
import { expect, lastPart, signIn, test } from "./fixtures";

/** Rita: on the team of Quinta da Serra Azul (seed/demo_member.py). */
const RITA = { email: "rita@example.com", password: "demo-member-2026" };
const WEDDING = "Sofia and Tiago's wedding";
const CHRISTENING = "Leonor's christening lunch";

interface Layouts {
  current: string;
  own_layout: boolean;
  venue_id: string;
  capacity: number;
  guests: number;
  seated: number;
}

interface Snapshot {
  layouts: Layouts;
  /** guest id -> seat id, for guests with a seat. */
  seats: Record<number, number>;
  /** Seat ids on the event's map. */
  mapSeats: number[];
}

/** The work session the page keeps, so the checks read the same data the page shows. */
async function workToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => window.sessionStorage.getItem("seatplan.session"));
  expect(token, "signed in with a work session").toBeTruthy();
  return token ?? "";
}

async function snapshot(request: APIRequestContext, token: string, eventId: string): Promise<Snapshot> {
  const headers = { Authorization: `Bearer ${token}` };
  const [layouts, detail, guests] = await Promise.all([
    request.get(`/api/events/${eventId}/layouts`, { headers }),
    request.get(`/api/events/${eventId}`, { headers }),
    request.get(`/api/events/${eventId}/guests`, { headers }),
  ]);
  for (const answer of [layouts, detail, guests]) expect(answer.status()).toBe(200);
  const seats: Record<number, number> = {};
  for (const guest of (await guests.json()) as { id: number; seat_id: number | null }[]) {
    if (guest.seat_id !== null) seats[guest.id] = guest.seat_id;
  }
  const map = ((await detail.json()) as { map: { seats: { id: number }[] } }).map;
  return { layouts: (await layouts.json()) as Layouts, seats, mapSeats: map.seats.map((s) => s.id) };
}

test("event staff switch a wedding from Banquet to Theatre; guests are re-seated and the other event is unchanged", async ({ page, request }) => {
  await signIn(page, RITA, "/events/staff");
  const list = page.getByRole("list", { name: "Events you can run" });
  const link = (name: string) => list.getByRole("listitem").filter({ hasText: name }).getByRole("link", { name: /Open organiser workspace/ });
  const weddingId = lastPart((await link(WEDDING).getAttribute("href")) ?? "");
  const christeningId = lastPart((await link(CHRISTENING).getAttribute("href")) ?? "");
  expect(weddingId).not.toBe("");
  expect(christeningId).not.toBe("");

  const token = await workToken(page);
  const weddingBefore = await snapshot(request, token, weddingId);
  const christeningBefore = await snapshot(request, token, christeningId);
  expect(weddingBefore.layouts).toMatchObject({ current: "banquet", own_layout: true });
  expect(christeningBefore.layouts).toMatchObject({ current: "banquet", own_layout: true });
  expect(weddingBefore.layouts.venue_id).not.toBe(christeningBefore.layouts.venue_id);
  const seated = weddingBefore.layouts.seated;
  expect(seated).toBeGreaterThan(0);

  await link(WEDDING).click();
  await page.waitForURL((url) => url.pathname === `/organiser/${weddingId}`);
  await expect(page.getByRole("heading", { level: 1, name: WEDDING })).toBeVisible();

  // Tap one: the Theatre card. The setup shows on the map; nothing changes yet.
  await page.getByRole("tab", { name: "Layout" }).click();
  const setups = page.getByRole("list", { name: "Room setups" });
  await expect(setups.getByRole("button", { name: /^Banquet/ })).toContainText("In use");
  const theatre = setups.getByRole("button", { name: /^Theatre/ });
  await expect(theatre).toContainText("140 seats for");
  await theatre.click();
  await expect(theatre).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Preview of the Theatre setup, not applied.")).toBeVisible();

  // Tap two: Apply. Guests are seated, so the page asks first and says what will happen.
  await page.getByRole("button", { name: "Apply Theatre setup" }).click();
  const dialog = page.getByRole("dialog", { name: "Apply the Theatre setup?" });
  await expect(dialog).toContainText(`${seated} guests already have a seat. They will be re-seated automatically`);
  await expect(dialog).toContainText("Anyone whose seat changes gets the usual seat-change email.");
  await dialog.getByRole("button", { name: "Apply and re-seat guests" }).click();

  await expect(page.locator(".ev-layout-result")).toHaveText(`Theatre setup applied. ${seated} guests re-seated.`);
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Preview of the Theatre setup, not applied.")).toBeHidden();
  await expect(setups.getByRole("button", { name: /^Theatre/ })).toContainText("In use");
  await expect(page.locator(".ev-org-header .ev-progress")).toContainText(`${seated} of`);

  // Every seated guest sits on a seat of the new map; the editor link keeps the same copy.
  const weddingAfter = await snapshot(request, token, weddingId);
  expect(weddingAfter.layouts).toMatchObject({ current: "theatre", own_layout: true, venue_id: weddingBefore.layouts.venue_id, seated });
  expect(Object.keys(weddingAfter.seats).sort()).toEqual(Object.keys(weddingBefore.seats).sort());
  const newSeats = new Set(weddingAfter.mapSeats);
  for (const seatId of Object.values(weddingAfter.seats)) expect(newSeats.has(seatId)).toBe(true);
  expect(new Set(Object.values(weddingAfter.seats)).size).toBe(seated);
  expect(weddingAfter.mapSeats.some((id) => weddingBefore.mapSeats.includes(id))).toBe(false);

  // The other event at the same quinta: same setup, same room copy, same seats.
  const christeningAfter = await snapshot(request, token, christeningId);
  expect(christeningAfter).toEqual(christeningBefore);

  // Fine-tune opens the wedding's own copy in the editor.
  const fineTune = page.getByRole("link", { name: "Fine-tune in the editor" });
  await expect(fineTune).toHaveAttribute("href", `/editor/${weddingBefore.layouts.venue_id}`);
  await fineTune.click();
  await page.waitForURL((url) => url.pathname === `/editor/${weddingBefore.layouts.venue_id}`);
  await expect(page.getByRole("heading", { level: 1, name: `${WEDDING}: room setup` })).toBeVisible();
});
