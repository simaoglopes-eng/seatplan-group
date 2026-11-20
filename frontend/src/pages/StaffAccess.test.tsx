import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StaffAccess from "./StaffAccess";

const mocks = vi.hoisted(() => ({ getMe: vi.fn() }));
vi.mock("../api/client", () => ({
  getMe: mocks.getMe,
  ApiError: class ApiError extends Error { status = 401; },
}));

function renderPage() {
  render(<MemoryRouter initialEntries={["/staff"]}><Routes>
    <Route path="/staff" element={<StaffAccess />} />
    <Route path="/staff/:venueId" element={<p>Workspace opened</p>} />
    <Route path="/login" element={<p>Sign in required</p>} />
  </Routes></MemoryRouter>);
}

describe("staff access", () => {
  beforeEach(() => { mocks.getMe.mockReset(); });
  it("opens the specified venue for a signed-in user", async () => {
    mocks.getMe.mockResolvedValue({ role: "staff" });
    renderPage();
    fireEvent.change(await screen.findByLabelText("Venue ID"), { target: { value: "venue_123" } });
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));
    expect(screen.getByText("Workspace opened")).toBeTruthy();
  });
  it("sends unauthenticated staff to sign in", async () => {
    const { ApiError } = await import("../api/client");
    mocks.getMe.mockRejectedValue(new ApiError(401, "unauthorised", "Please sign in"));
    renderPage();
    expect(await screen.findByText("Sign in required")).toBeTruthy();
  });
});
