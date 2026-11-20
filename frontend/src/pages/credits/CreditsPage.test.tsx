import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ALL_ILLUSTRATIVE } from "../../data/illustrativePhotos";
import { CREDIT_GROUPS, PHOTO_CREDITS } from "../../data/photoCredits";
import { VENUE_PHOTOS } from "../../data/venuePhotos";
import CreditsPage from "./CreditsPage";

const SITE_FILES = [
  "/images/photos/hero-auditorium.jpg",
  "/images/photos/palazzo-hall.jpg",
  "/images/photos/douro-quinta-2.jpg",
  "/images/photos/ballroom.jpg",
  "/images/photos/conference-room.jpg",
  "/images/photos/hero-ballroom.jpg",
  "/images/photos/hero-square-brussels.jpg",
  "/images/photos/hero-terrace-assisi.jpg",
  "/images/photos/hero-dinner-giant.jpg",
  "/images/photos/hero-dining-hall.jpg",
];
// Commons file pages, or the permanent page-id link Commons gives for a file (?curid=).
const COMMONS_SOURCE = /^https:\/\/commons\.wikimedia\.org\/(wiki\/File:|w\/index\.php\?curid=\d+$)/;

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/credits"]}>
      <CreditsPage />
    </MemoryRouter>,
  );
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("CreditsPage", () => {
  it("lists every photo with its author, licence and a link to the source, and the OpenStreetMap line", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Photographs and data" })).toBeTruthy();
    const main = screen.getByRole("main");
    const items = within(main).getAllByRole("listitem");
    expect(items).toHaveLength(PHOTO_CREDITS.length);
    // The page shows the groups in CREDIT_GROUPS order, and PHOTO_CREDITS is already in that order.
    PHOTO_CREDITS.forEach((credit, i) => {
      const item = items[i];
      expect(within(item).getByText(credit.title)).toBeTruthy();
      expect(within(item).getByText(new RegExp(escape(credit.author)))).toBeTruthy();
      expect(within(item).getByRole("link", { name: new RegExp(escape(credit.licence)) }).getAttribute("href")).toBe(credit.licenceUrl);
      expect(within(item).getByRole("link", { name: /Source on Wikimedia Commons/ }).getAttribute("href")).toBe(credit.sourceUrl);
    });
    expect(within(main).getByText(/Open Database Licence \(ODbL\)/)).toBeTruthy();
    expect(within(main).getByRole("link", { name: /OpenStreetMap contributors/ }).getAttribute("href")).toBe("https://www.openstreetmap.org/copyright");
  });

  it("groups the photos under Site photos, Venue photos and Illustrative photos", () => {
    renderPage();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent ?? "");
    expect(headings.slice(0, 3).map((h) => h.replace(/\s*\(\d+\)$/, ""))).toEqual(["Site photos", "Venue photos", "Illustrative photos"]);
    for (const group of CREDIT_GROUPS) {
      const section = screen.getByRole("region", { name: new RegExp(`^${group.title}`) });
      const files = within(section)
        .getAllByRole("listitem")
        .map((li) => li.querySelector("img")?.getAttribute("src"));
      expect(files).toEqual(PHOTO_CREDITS.filter((c) => c.group === group.key).map((c) => c.file));
    }
  });

  it("credits the site photos, every venue photo and every illustrative photo, once per file", () => {
    const files = PHOTO_CREDITS.map((c) => c.file);
    expect(new Set(files).size).toBe(files.length);
    expect(PHOTO_CREDITS.filter((c) => c.group === "site").map((c) => c.file)).toEqual(SITE_FILES);
    for (const photo of Object.values(VENUE_PHOTOS)) expect(files).toContain(photo.src);
    for (const photo of ALL_ILLUSTRATIVE) expect(files).toContain(photo.src);
    expect(PHOTO_CREDITS).toHaveLength(SITE_FILES.length + Object.keys(VENUE_PHOTOS).length + ALL_ILLUSTRATIVE.length);
    expect(Object.keys(VENUE_PHOTOS)).toHaveLength(45);
    expect(ALL_ILLUSTRATIVE).toHaveLength(9);
    for (const c of PHOTO_CREDITS) {
      expect(c.sourceUrl).toMatch(COMMONS_SOURCE);
      expect(c.licenceUrl.startsWith("https://creativecommons.org/")).toBe(true);
      expect(c.author.trim()).not.toBe("");
      expect(c.author).not.toMatch(/[<>]/);
    }
    // The terrace is also the background of /participant (ParticipantStartPage.tsx), so its credit says so.
    expect(PHOTO_CREDITS.find((c) => c.file === "/images/photos/hero-terrace-assisi.jpg")?.usedFor).toMatch(/participant/);
    // ...and of the organiser sign-up (AuthPhoto in Login.tsx, used by OrganiserRegister.tsx).
    expect(PHOTO_CREDITS.find((c) => c.file === "/images/photos/hero-terrace-assisi.jpg")?.usedFor).toMatch(/organiser\/register/);
    // The /directory band photo (DirectoryPage.tsx) names that page in its credit.
    expect(PHOTO_CREDITS.find((c) => c.file === "/images/venues/way-142509065.jpg")?.usedFor).toMatch(/\/directory/);
  });

  it("says what a venue photo and an illustrative photo are", () => {
    renderPage();
    expect(screen.queryByText(/not photos of the venues/i)).toBeNull();
    expect(screen.getByText(/A photo marked "Venue photo" shows that venue/)).toBeTruthy();
    expect(screen.getByText(/Illustrative photos show a kind of room, not the venue/)).toBeTruthy();
  });
});
