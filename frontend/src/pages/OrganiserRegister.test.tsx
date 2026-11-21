import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrganiserRegister, { registerNext } from "./OrganiserRegister";

const mocks = vi.hoisted(() => ({ request: vi.fn(), setSessionToken: vi.fn() }));
// Keep the real module (ApiError and friends are used by the shared sign-up form); replace only the calls.
vi.mock("../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/client")>()),
  request: mocks.request,
  setSessionToken: mocks.setSessionToken,
  getGuestToken: () => null,
  getSessionToken: () => null,
}));

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/organiser/register" element={<OrganiserRegister />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillForm() {
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Alex" } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Smith" } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "alex@example.org" } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "a-long-password" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /I agree that SeatPlan/ }));
}

async function signUp() {
  fillForm();
  fireEvent.click(screen.getByRole("button", { name: "Send my code" }));
  fireEvent.change(await screen.findByLabelText(/^Code/), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Create my account" }));
  return screen.findByTestId("where");
}

describe("registerNext, the guard on ?next=", () => {
  it("keeps same-site relative paths, with their query", () => {
    expect(registerNext("/organiser?new=1")).toBe("/organiser?new=1");
    expect(registerNext("/organiser?at=w43664624")).toBe("/organiser?at=w43664624");
  });

  it("falls back to the organiser space for anything else", () => {
    for (const bad of [null, "", "organiser", "//evil.example", "/\\evil.example", "https://evil.example/organiser", "javascript:alert(1)"]) {
      expect(registerNext(bad)).toBe("/organiser");
    }
  });
});

describe("organiser register", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.request.mockImplementation(async (_method: string, path: string) =>
      path === "/auth/register" ? { signup_id: "s1", sent_to: "a***@example.org" } : { token: "t1" },
    );
  });

  it("after verifying, goes to ?next= (here the new-event form)", async () => {
    renderAt("/organiser/register?next=%2Forganiser%3Fnew%3D1");
    const where = await signUp();
    expect(mocks.setSessionToken).toHaveBeenCalledWith("t1");
    expect(where.textContent).toBe("/organiser?new=1");
  });

  it("ignores a next that leaves the site", async () => {
    renderAt("/organiser/register?next=%2F%2Fevil.example");
    await waitFor(() => expect(screen.getByRole("button", { name: "Send my code" })).toBeTruthy());
    expect((await signUp()).textContent).toBe("/organiser");
  });

  it("keeps next on the way to sign in", () => {
    renderAt("/organiser/register?next=%2Forganiser%3Fnew%3D1");
    expect(screen.getByRole("link", { name: "Already have an account? Sign in" }).getAttribute("href")).toBe("/login?next=%2Forganiser%3Fnew%3D1");
  });
  it("sends a new code after the wait, and verifies with the newest sign-up", async () => {
    let n = 0;
    mocks.request.mockImplementation(async (_method: string, path: string) =>
      path === "/auth/register" ? { signup_id: `s${++n}`, sent_to: "a***@example.org" } : { token: "t1" },
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderAt("/organiser/register");
      fillForm();
      fireEvent.click(screen.getByRole("button", { name: "Send my code" }));
      const wait = await screen.findByRole("button", { name: /Send a new code in 30 s/ });
      expect((wait as HTMLButtonElement).disabled).toBe(true);
      await vi.advanceTimersByTimeAsync(31_000);
      const again = await screen.findByRole("button", { name: "Send a new code" });
      expect((again as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(again);
      await screen.findByText("We sent a new code. Only the newest one works.");
      expect(mocks.request).toHaveBeenCalledTimes(2);
      expect(mocks.request.mock.calls[1][2]).toEqual({ name: "Alex Smith", email: "alex@example.org", password: "a-long-password" });
      fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "654321" } });
      fireEvent.click(screen.getByRole("button", { name: "Create my account" }));
      await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(3));
      expect(mocks.request.mock.calls[2][2]).toEqual({ email: "alex@example.org", code: "654321", signup_id: "s2" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes back to the form to use a different email, with the password cleared", async () => {
    renderAt("/organiser/register");
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Send my code" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use a different email" }));
    expect((screen.getByLabelText(/^Email/) as HTMLInputElement).value).toBe("alex@example.org");
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Alex");
    expect(screen.getByRole("button", { name: "Send my code" })).toBeTruthy();
  });
});
