// One account, two sessions (plan 2026-11-18): /account keeps a personal and a work session in the
// tab. Every older Sign out must forget both, or the next person at a shared computer opens the
// first person's staff tools from /account.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGuestToken, getSessionToken, setGuestToken, setSessionToken } from "../../api/client";
import { ToastProvider } from "../../design/components";
import { callsTo, startFakeServer } from "../events/__tests__/mockServer";
import DinerAccountPage from "../discover/DinerAccountPage";
import { OwnerShell } from "../owner/OwnerShell";
import { AccountBar } from "./AccountBar";

function renderAt(path: string, element: React.ReactNode): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path={path} element={element} />
          <Route path="*" element={<p>Elsewhere</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

function bothSessions(): ReturnType<typeof startFakeServer> {
  setGuestToken("g.1.0.9.sig");
  setSessionToken("3.9.sig");
  const server = startFakeServer();
  server.routes.set("POST /guest/logout", () => ({ body: {} }));
  server.routes.set("GET /diner/bookings", () => ({ body: { items: [], total: 0 } }));
  server.routes.set("GET /diner/favorites", () => ({ body: { items: [] } }));
  return server;
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("every Sign out forgets both sessions", () => {
  it("the bar of the guest pages (/my)", async () => {
    const server = bothSessions();
    renderAt("/my", <AccountBar email="rita@example.com" current="events" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(getSessionToken()).toBeNull());
    expect(getGuestToken()).toBeNull();
    expect(callsTo(server, "POST", "/guest/logout")).toHaveLength(1);
  });

  it("the restaurant account page", async () => {
    const server = bothSessions();
    renderAt("/restaurants/account", <DinerAccountPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(getSessionToken()).toBeNull());
    expect(getGuestToken()).toBeNull();
    expect(callsTo(server, "POST", "/guest/logout")).toHaveLength(1);
  });

  it("the owner menu", async () => {
    const server = bothSessions();
    renderAt("/owner/casa/team", <OwnerShell title="Team" venueId="casa" current="team"><p>Team</p></OwnerShell>);
    fireEvent.click(screen.getByRole("link", { name: "Sign out" }));
    expect(getSessionToken()).toBeNull();
    await waitFor(() => expect(getGuestToken()).toBeNull());
    expect(callsTo(server, "POST", "/guest/logout")).toHaveLength(1);
  });
});
