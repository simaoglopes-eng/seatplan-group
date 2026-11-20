import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PHOTO_CREDITS } from "../../data/photoCredits";
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

  it("credits the five photos the site ships with", () => {
    expect(PHOTO_CREDITS.map((c) => c.file)).toEqual([
      "/images/photos/hero-auditorium.jpg",
      "/images/photos/palazzo-hall.jpg",
      "/images/photos/douro-quinta-2.jpg",
      "/images/photos/ballroom.jpg",
      "/images/photos/conference-room.jpg",
    ]);
    for (const c of PHOTO_CREDITS) expect(c.sourceUrl.startsWith("https://commons.wikimedia.org/wiki/File:")).toBe(true);
  });
});
