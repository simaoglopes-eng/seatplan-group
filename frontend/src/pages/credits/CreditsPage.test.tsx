import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PHOTO_CREDITS } from "../../data/photoCredits";
import { VENUE_PHOTOS } from "../../data/venuePhotos";
import CreditsPage from "./CreditsPage";

describe("CreditsPage", () => {
  it("lists every photo with its author, licence and a link to the source, and the OpenStreetMap line", () => {
    render(
      <MemoryRouter initialEntries={["/credits"]}>
        <CreditsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Photographs and data" })).toBeTruthy();
    const main = screen.getByRole("main");
    const items = within(main).getAllByRole("listitem");
    expect(items).toHaveLength(PHOTO_CREDITS.length);
    expect(PHOTO_CREDITS.length).toBeGreaterThanOrEqual(5);
    PHOTO_CREDITS.forEach((credit, i) => {
      const item = items[i];
      expect(within(item).getByText(credit.title)).toBeTruthy();
      expect(within(item).getByText(new RegExp(credit.author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeTruthy();
      expect(within(item).getByRole("link", { name: new RegExp(credit.licence.replace(/[.]/g, "\\.")) }).getAttribute("href")).toBe(credit.licenceUrl);
      expect(within(item).getByRole("link", { name: /Source on Wikimedia Commons/ }).getAttribute("href")).toBe(credit.sourceUrl);
    });
    expect(within(main).getByText(/Open Database Licence \(ODbL\)/)).toBeTruthy();
    expect(within(main).getByRole("link", { name: /OpenStreetMap contributors/ }).getAttribute("href")).toBe("https://www.openstreetmap.org/copyright");
  });

  it("credits the seven illustrations and every venue photo the site ships with", () => {
    expect(PHOTO_CREDITS.map((c) => c.file)).toEqual([
      "/images/photos/hero-auditorium.jpg",
      "/images/photos/palazzo-hall.jpg",
      "/images/photos/douro-quinta-2.jpg",
      "/images/photos/ballroom.jpg",
      "/images/photos/conference-room.jpg",
      "/images/photos/hero-ballroom.jpg",
      "/images/photos/hero-square-brussels.jpg",
      ...Object.values(VENUE_PHOTOS).map((p) => p.src),
    ]);
    for (const c of PHOTO_CREDITS) expect(c.sourceUrl.startsWith("https://commons.wikimedia.org/wiki/File:")).toBe(true);
    // The auditorium is also the background of /participant, so its credit says so.
    expect(PHOTO_CREDITS[0].usedFor).toMatch(/participant/);
  });

  it("does not claim that no photo shows a listed venue, now that venue photos are on the list", () => {
    render(
      <MemoryRouter initialEntries={["/credits"]}>
        <CreditsPage />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/not photos of the venues/i)).toBeNull();
    expect(screen.getByText(/A photo marked "Venue photo" shows that venue/)).toBeTruthy();
  });
});
