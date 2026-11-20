// The sign-in page is for organisers; coming from /staff it speaks to event staff.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../design/components";
import Login, { safeNextPath } from "./Login";

describe("safeNextPath, the guard on ?next= after sign-in", () => {
  it("keeps same-site relative paths, with their query", () => {
    expect(safeNextPath("/organiser?new=1")).toBe("/organiser?new=1");
  });

  it("falls back to the home page for anything else, backslash variants included", () => {
    for (const bad of [null, "", "organiser", "//evil.example", "/\\evil.example", "/\\/evil.example", "/\\\\evil.example", "https://evil.example", "javascript:alert(1)"]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });

  it("passes a safe ?next= on to the sign-up link, and drops one it refuses", () => {
    open("/login?next=%2Forganiser%3Fnew%3D1");
    expect(screen.getByRole("link", { name: "Create an organiser account" }).getAttribute("href")).toBe("/organiser/register?next=%2Forganiser%3Fnew%3D1");
  });

  it("drops a backslash ?next= from the sign-up link", () => {
    open("/login?next=%2F%5Cevil.example");
    expect(screen.getByRole("link", { name: "Create an organiser account" }).getAttribute("href")).toBe("/organiser/register");
  });
});

function open(path: string): void {
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("Sign in", () => {
  it("speaks to organisers and links to creating an organiser account", () => {
    open("/login");
    expect(screen.getByRole("heading", { name: "Organiser sign in" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create an organiser account" }).getAttribute("href")).toBe("/organiser/register");
  });

  it("speaks to staff when they come from the staff area, with no sign-up link", () => {
    open("/login?next=/staff");
    expect(screen.getByRole("heading", { name: "Staff sign in" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Create an organiser account" })).toBeNull();
  });

  it("asks for both fields before sending anything", () => {
    open("/login");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your email and your password.")).toBeTruthy();
  });
});
