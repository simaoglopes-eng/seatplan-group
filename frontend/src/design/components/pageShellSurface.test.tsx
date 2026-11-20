// The Restaurants look is switched on by the route, never by a page: events keep their own look.
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { PageShell, isRestaurantRoute } from "./PageShell";

afterEach(() => {
  delete document.documentElement.dataset.surface;
});

describe("isRestaurantRoute", () => {
  it.each(["/restaurants/tagus-terrace", "/r/abc", "/b/token", "/owner", "/owner/sign-in", "/owner/abc/rooms", "/staff/abc", "/pay/demo/abc", "/pay/return/abc", "/owner/abc/payments"])("%s is a Restaurants route", (path) => {
    expect(isRestaurantRoute(path)).toBe(true);
  });
  // The home page is the Events front door since the restaurants were hidden.
  it.each(["/", "/credits", "/directory", "/demo", "/login", "/e/token", "/j/token", "/j/token/register", "/my", "/my/account", "/organiser/abc", "/editor/abc", "/events", "/events/staff", "/venues", "/venues/tagus-forum", "/account", "/restaurantsx", "/ownership", "/payroll"])("%s is not", (path) => {
    expect(isRestaurantRoute(path)).toBe(false);
  });
});

describe("isRestaurantRoute and the sign-in", () => {
  it("treats the sign-in of an owner or staff journey as Restaurants, and every other sign-in as Events", () => {
    expect(isRestaurantRoute("/login", "?next=%2Fowner")).toBe(true);
    expect(isRestaurantRoute("/login", "?next=%2Fowner%2Fabc%2Frooms")).toBe(true);
    expect(isRestaurantRoute("/login", "?next=%2Fstaff%2Fabc")).toBe(true);
    expect(isRestaurantRoute("/login", "?next=%2Fmy")).toBe(false);
    expect(isRestaurantRoute("/login", "?next=%2Fowners-club")).toBe(false);
    expect(isRestaurantRoute("/login", "")).toBe(false);
  });
});

describe("PageShell surface", () => {
  it("sets data-surface on the page only on Restaurants routes, and removes it on the way out", () => {
    const restaurants = render(
      <MemoryRouter initialEntries={["/restaurants/tagus-terrace"]}>
        <PageShell title="Tagus Terrace">x</PageShell>
      </MemoryRouter>,
    );
    expect(document.documentElement.dataset.surface).toBe("restaurants");
    restaurants.unmount();
    expect(document.documentElement.dataset.surface).toBeUndefined();

    render(
      <MemoryRouter initialEntries={["/e/some-token"]}>
        <PageShell title="Your invitation">x</PageShell>
      </MemoryRouter>,
    );
    expect(document.documentElement.dataset.surface).toBeUndefined();
  });
});

describe("PageShell frame", () => {
  it("names the brand, links the data and photo credits, and only overlays the header when asked", () => {
    const plain = render(
      <MemoryRouter initialEntries={["/events"]}>
        <PageShell title="Events">x</PageShell>
      </MemoryRouter>,
    );
    expect(plain.getByRole("link", { name: "SeatPlan, home" }).getAttribute("href")).toBe("/");
    expect(plain.getByRole("link", { name: /OpenStreetMap contributors/ }).getAttribute("href")).toBe("https://www.openstreetmap.org/copyright");
    expect(plain.getByRole("link", { name: "Photo credits" }).getAttribute("href")).toBe("/credits");
    expect(plain.container.querySelector(".shell-overlay")).toBeNull();
    plain.unmount();

    const overlay = render(
      <MemoryRouter initialEntries={["/"]}>
        <PageShell title="Home" variant="overlay">x</PageShell>
      </MemoryRouter>,
    );
    expect(overlay.container.querySelector(".shell.shell-overlay")).not.toBeNull();
    expect(document.documentElement.dataset.surface).toBeUndefined();
  });
});

describe("PageShell logo", () => {
  it("shows Federico's mark (the favicon artwork) beside the name, hidden from screen readers", () => {
    const view = render(
      <MemoryRouter initialEntries={["/events"]}>
        <PageShell title="Events">x</PageShell>
      </MemoryRouter>,
    );
    const brand = view.getByRole("link", { name: "SeatPlan, home" });
    const mark = brand.querySelector("svg.wordmark-mark");
    expect(mark).not.toBeNull();
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.getAttribute("width")).toBe("30");
    // A green rounded square, four cream seats around a cream table, one seat brass.
    expect(mark?.querySelector("rect")?.getAttribute("fill")).toBe("#1F5A48");
    const fills = Array.from(mark?.querySelectorAll("circle") ?? []).map((c) => c.getAttribute("fill"));
    expect(fills).toEqual(["#F4EFE6", "#F4EFE6", "#F4EFE6", "#F4EFE6", "#D9A441"]);
    expect(brand.querySelector(".wordmark-text")?.textContent).toBe("SeatPlan");
    // The Restaurants brand keeps its own logo image and no mark.
    view.unmount();
    const restaurants = render(
      <MemoryRouter initialEntries={["/restaurants/x"]}>
        <PageShell title="R" restaurantBrand>x</PageShell>
      </MemoryRouter>,
    );
    expect(restaurants.container.querySelector("svg.wordmark-mark")).toBeNull();
    expect(restaurants.container.querySelector("img.wordmark-logo")).not.toBeNull();
  });
});
