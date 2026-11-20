import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import ParticipantStartPage, { joinCodeOf } from "./ParticipantStartPage";

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

function renderParticipantStart(entry = "/participant") {
  render(
    <MemoryRouter initialEntries={[entry]}>
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
afterEach(() => vi.unstubAllGlobals());

describe("joinCodeOf", () => {
  it("reads a short code typed with or without its hyphen and spaces", () => {
    expect(joinCodeOf("7kq-24m8pq3vzd")).toBe("7KQ-24M8PQ3VZD");
    expect(joinCodeOf(" 7KQ 24M8 PQ3V ZD ")).toBe("7KQ-24M8PQ3VZD");
  });

  it("leaves shared link tokens alone: codes never contain I, L, O or U", () => {
    expect(joinCodeOf("return-to-form")).toBeNull();
    expect(joinCodeOf("TEST")).toBeNull();
    expect(joinCodeOf("abc_123")).toBeNull();
  });
});

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

  it("fills in ?code= from the landing without opening a value that is not a code", () => {
    window.sessionStorage.setItem("seatplan.participant-entry.invitation", "older-value");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderParticipantStart("/participant?code=TEST");

    expect((screen.getByLabelText("Invitation link or code") as HTMLInputElement).value).toBe("TEST");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("opened-path")).toBeNull();
  });

  it("opens a well-formed ?code= straight away", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ path: "/j/shared-token" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderParticipantStart("/participant?code=7KQ-24M8PQ3VZD");

    expect((await screen.findByTestId("opened-path")).textContent).toBe("/j/shared-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/join-code/7KQ-24M8PQ3VZD");
  });

  it("keeps a ?code= the server does not know in the form, with the error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "not_found", message: "Not valid" } }), { status: 404 })));
    renderParticipantStart("/participant?code=7KQ-24M8PQ3VZD");

    expect((await screen.findByRole("alert")).textContent).toMatch(/valid SeatPlan invitation/);
    expect((screen.getByLabelText("Invitation link or code") as HTMLInputElement).value).toBe("7KQ-24M8PQ3VZD");
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
