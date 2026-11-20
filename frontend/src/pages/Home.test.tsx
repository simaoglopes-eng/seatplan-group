import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Home from "./Home";
import ParticipantStartPage from "./ParticipantStartPage";

function renderHome() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/participant" element={<ParticipantStartPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Home entry points", () => {
  it("offers clear role paths with SeatPlan branding and a clean welcome", () => {
    renderHome();
    expect(screen.getByRole("heading", { name: "Welcome to SeatPlan" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "SeatPlan, home" })).toBeTruthy();
    expect(screen.queryByText("FLOW")).toBeNull();
    expect(screen.queryByText(/thoughtful gatherings/i)).toBeNull();
    expect(screen.queryByText(/thoughtful seating for good gatherings/i)).toBeNull();
    expect(screen.queryByText(/already have an account/i)).toBeNull();
    expect(screen.getByRole("link", { name: /I’m an organiser/ }).getAttribute("href")).toBe("/organiser/register");
    expect(screen.getByRole("link", { name: /I’m a participant/ }).getAttribute("href")).toBe("/participant");
    expect(screen.getAllByRole("link", { name: "Organiser sign in" }).some((link) => link.getAttribute("href") === "/login")).toBe(true);
    expect(screen.getByRole("link", { name: "Staff area" }).getAttribute("href")).toBe("/staff");
  });

  it("moves the glass highlight with a pointer and resets when it leaves", () => {
    renderHome();
    const panel = screen.getByRole("region", { name: "Welcome to SeatPlan" });
    Object.defineProperty(panel, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) }),
    });

    fireEvent.pointerMove(panel, { clientX: 80, clientY: 25, pointerType: "mouse" });
    expect(panel.getAttribute("data-glass-active")).toBe("true");
    expect((panel as HTMLElement).style.getPropertyValue("--glass-pointer-x")).toBe("80.00%");

    fireEvent.pointerLeave(panel, { pointerType: "mouse" });
    expect(panel.getAttribute("data-glass-active")).toBe("false");
  });
});
