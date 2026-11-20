import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import ParticipantStartPage from "./ParticipantStartPage";

function EventOpened() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <section>
      <p data-testid="opened-path">{location.pathname}</p>
      <button onClick={() => navigate("/participant")}>Back to invitation entry</button>
    </section>
  );
}

function renderParticipantStart() {
  render(
    <MemoryRouter initialEntries={["/participant"]}>
      <Routes>
        <Route path="/participant" element={<ParticipantStartPage />} />
        <Route path="/j/:token" element={<EventOpened />} />
        <Route path="/e/:token" element={<EventOpened />} />
        <Route path="/my/register" element={<p>Participant registration</p>} />
        <Route path="/my/sign-in" element={<p>Participant sign in</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => window.sessionStorage.clear());

describe("Participant entry", () => {
  it("opens a shared event from its short invitation code", () => {
    renderParticipantStart();
    fireEvent.change(screen.getByLabelText("Invitation link or code"), { target: { value: "abc_123" } });
    fireEvent.click(screen.getByRole("button", { name: /Open invitation/ }));

    expect(screen.getByTestId("opened-path").textContent).toBe("/j/abc_123");
  });

  it("keeps existing shared and personal invitation routes", () => {
    renderParticipantStart();
    const input = screen.getByLabelText("Invitation link or code");
    fireEvent.change(input, { target: { value: `${window.location.origin}/e/personal-token?source=email` } });
    fireEvent.click(screen.getByRole("button", { name: /Open invitation/ }));

    expect(screen.getByTestId("opened-path").textContent).toBe("/e/personal-token");
  });

  it("rejects an invitation link from a different site", () => {
    renderParticipantStart();
    fireEvent.change(screen.getByLabelText("Invitation link or code"), { target: { value: "https://example.com/j/token" } });
    fireEvent.click(screen.getByRole("button", { name: /Open invitation/ }));

    expect(screen.getByRole("alert").textContent).toMatch(/valid SeatPlan invitation/);
  });

  it("restores the invitation when returning to the entry screen", () => {
    renderParticipantStart();
    const input = screen.getByLabelText("Invitation link or code");
    fireEvent.change(input, { target: { value: "return-to-form" } });
    fireEvent.click(screen.getByRole("button", { name: /Open invitation/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back to invitation entry" }));

    expect((screen.getByLabelText("Invitation link or code") as HTMLInputElement).value).toBe("return-to-form");
  });

  it("offers participant account creation and sign-in", () => {
    renderParticipantStart();

    expect(screen.getByRole("link", { name: "Create a participant account" }).getAttribute("href")).toBe("/my/register");
    expect(screen.getByRole("link", { name: "Participant sign in" }).getAttribute("href")).toBe("/my/sign-in");
    expect(screen.getByRole("link", { name: "SeatPlan, home" })).toBeTruthy();
    expect(screen.queryByText("FLOW")).toBeNull();
    expect(screen.queryByText(/already have an account/i)).toBeNull();
  });
});
