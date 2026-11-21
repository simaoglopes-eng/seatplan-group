import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGuestToken, getSessionToken, setGuestToken, setSessionToken } from "../../api/client";
import { ToastProvider } from "../../design/components";
import { callsTo, errorReply, startFakeServer } from "../events/__tests__/mockServer";
import YourAccountPage from "./YourAccountPage";
import TeamPage from "../owner/TeamPage";

const ACCOUNT = { name: "Rita Rossi", email: "rita@example.com", created_at: "2026-11-18T10:00:00Z" };
const WORK = {
  user: { email: "rita@example.com", name: "Rita Rossi", role: "organiser" },
  restaurants: [
    { public_id: "casa", name: "Casa Lumen", slug: "casa-lumen", status: "published", role: "staff" },
    { public_id: "mine", name: "My Bistro", slug: null, status: "draft", role: "owner" },
  ],
  event_venues: [{ public_id: "q1", name: "Quinta da Serra Azul", slug: "quinta-da-serra-azul", status: "published", role: "staff", venue_type: "quinta" }],
  events: [
    { public_id: "ev1", name: "Sofia and Tiago's wedding", starts_at: "2026-12-11T15:00:00Z", ends_at: "2026-12-12T01:00:00Z", event_type: "wedding", event_type_label: "Wedding", listed: true, venue_public_id: "q1", venue_name: "Quinta da Serra Azul", role: "staff" },
  ],
};

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/account" element={<YourAccountPage />} />
          <Route path="/owner/:venueId/team" element={<TeamPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

function bookingRoutes(server: ReturnType<typeof startFakeServer>): void {
  server.routes.set("GET /guest/me", () => ({ body: { account: ACCOUNT, events: [] } }));
  server.routes.set("GET /diner/bookings", () => ({ body: { items: [], total: 0 } }));
  server.routes.set("GET /diner/favorites", () => ({ body: { items: [] } }));
}

describe("/account signed out", () => {
  it("has the eye inside the sign-in password field", () => {
    startFakeServer();
    renderAt("/account");
    const form = screen.getByRole("form", { name: "Sign in" });
    const input = within(form).getByLabelText("Password") as HTMLInputElement;
    const eye = within(form).getByRole("button", { name: "Show password" });
    expect(input.parentElement?.contains(eye)).toBe(true);
    fireEvent.click(eye);
    expect(input.type).toBe("text");
    expect(within(form).getByRole("button", { name: "Hide password" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("signs in with one password and keeps both sessions", async () => {
    const server = startFakeServer();
    bookingRoutes(server);
    server.routes.set("POST /account/login", () => ({ body: { guest: { token: "g.1.0.9.sig", account: ACCOUNT }, work: { token: "3.9.sig", user: WORK.user } } }));
    renderAt("/account");
    const form = screen.getByRole("form", { name: "Sign in" });
    fireEvent.change(within(form).getByLabelText("Email"), { target: { value: "rita@example.com" } });
    fireEvent.change(within(form).getByLabelText("Password"), { target: { value: "demo-member-2026" } });
    fireEvent.click(within(form).getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("button", { name: "Booking", pressed: true })).toBeTruthy();
    expect(getGuestToken()).toBe("g.1.0.9.sig");
    expect(getSessionToken()).toBe("3.9.sig");
    expect(await screen.findByRole("heading", { level: 1, name: "Rita Rossi" })).toBeTruthy();
  });

  it("creates an account with the code step and shows the demo code", async () => {
    const server = startFakeServer();
    bookingRoutes(server);
    server.routes.set("POST /account/register", () => ({ status: 202, body: { status: "code_sent", sent_to: "ri***@example.com", expires_in_seconds: 900, signup_id: "s1", demo_code: "123456" } }));
    server.routes.set("POST /guest/verify", () => ({ status: 201, body: { token: "g.1.0.9.sig", account: ACCOUNT, join: { status: "account_only", event_id: null }, work: { token: "3.9.sig", user: WORK.user } } }));
    renderAt("/account?mode=create");
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Rita" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Rossi" } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "rita@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "a long password" } });
    fireEvent.click(screen.getByLabelText(/I agree/));
    fireEvent.click(screen.getByRole("button", { name: "Send my code" }));
    expect(await screen.findByText("Demo only: your code is 123456")).toBeTruthy();
    // Only the four fields the server accepts: anything more is a 422.
    expect(callsTo(server, "POST", "/account/register")).toEqual([{ name: "Rita Rossi", email: "rita@example.com", password: "a long password", consent: true }]);
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Create my account" }));
    expect(await screen.findByRole("button", { name: "Staff", pressed: false })).toBeTruthy();
    expect(getSessionToken()).toBe("3.9.sig");
  });
});

describe("/account signed in", () => {
  it("Staff lists restaurants, venues and events with their roles, and owner links for an owner", async () => {
    setGuestToken("g.1.0.9.sig");
    setSessionToken("3.9.sig");
    const server = startFakeServer();
    bookingRoutes(server);
    server.routes.set("GET /account/work", () => ({ body: WORK }));
    renderAt("/account?tab=staff");
    const floor = await screen.findByRole("link", { name: /Open service floor\s*of Casa Lumen/ });
    expect(floor.getAttribute("href")).toBe("/staff/casa");
    expect(screen.queryByRole("link", { name: "Team" })).not.toBeNull();
    expect(screen.getAllByRole("link", { name: "Team" }).map((a) => a.getAttribute("href"))).toEqual(["/owner/mine/team"]);
    expect(screen.getByRole("link", { name: /Open organiser workspace\s*for Sofia and Tiago's wedding/ }).getAttribute("href")).toBe("/organiser/ev1");
    expect(screen.getAllByText("Staff", { selector: ".badge" }).length).toBe(3);
    expect(screen.getByText("Owner", { selector: ".badge" })).toBeTruthy();
  });

  it("says when the staff tools belong to another sign-in than the header", async () => {
    // /login sets only the work session, /my/sign-in only the personal one: two people can meet here.
    setGuestToken("g.1.0.9.sig");
    setSessionToken("1.9.sig");
    const server = startFakeServer();
    bookingRoutes(server);
    server.routes.set("GET /account/work", () => ({ body: { ...WORK, user: { email: "organiser@example.com", name: "Olivia Organiser", role: "organiser" } } }));
    renderAt("/account?tab=staff");
    expect(await screen.findByText(/signed in as Olivia Organiser \(organiser@example.com\), not as rita@example.com/)).toBeTruthy();
  });

  it("says nothing extra when both sides are the same person", async () => {
    setGuestToken("g.1.0.9.sig");
    setSessionToken("3.9.sig");
    const server = startFakeServer();
    bookingRoutes(server);
    server.routes.set("GET /account/work", () => ({ body: WORK }));
    renderAt("/account?tab=staff");
    await screen.findByRole("heading", { name: "Restaurants" });
    await screen.findByRole("heading", { level: 1, name: "Rita Rossi" });
    expect(screen.queryByText(/not as rita@example.com/)).toBeNull();
  });

  it("gives an event venue's owner its Team page, and staff no owner links", async () => {
    setGuestToken("g.1.0.9.sig");
    setSessionToken("3.9.sig");
    const server = startFakeServer();
    bookingRoutes(server);
    const hall = { public_id: "h1", name: "Tagus Hall", slug: null, status: "draft", role: "owner", venue_type: "hall" };
    server.routes.set("GET /account/work", () => ({ body: { ...WORK, event_venues: [...WORK.event_venues, hall] } }));
    renderAt("/account?tab=staff");
    const teams = (await screen.findAllByRole("link", { name: "Team" })).map((link) => link.getAttribute("href"));
    expect(teams).toEqual(["/owner/mine/team", "/owner/h1/team"]);
  });

  it("offers a staff-only person their own restaurant, not an owner area", async () => {
    setGuestToken("g.1.0.9.sig");
    setSessionToken("3.9.sig");
    const server = startFakeServer();
    bookingRoutes(server);
    server.routes.set("GET /account/work", () => ({ body: { ...WORK, restaurants: [WORK.restaurants[0]] } }));
    renderAt("/account?tab=staff");
    expect((await screen.findByRole("link", { name: "Open your own restaurant" })).getAttribute("href")).toBe("/owner");
    expect(screen.queryByRole("link", { name: "Restaurant owner area" })).toBeNull();
  });

  it("keeps the owner area link for an owner", async () => {
    setGuestToken("g.1.0.9.sig");
    setSessionToken("3.9.sig");
    const server = startFakeServer();
    bookingRoutes(server);
    server.routes.set("GET /account/work", () => ({ body: WORK }));
    renderAt("/account?tab=staff");
    expect(await screen.findByRole("link", { name: "Restaurant owner area" })).toBeTruthy();
  });

  it("explains a missing work side instead of sending the person away", async () => {
    setGuestToken("g.1.0.9.sig");
    const server = startFakeServer();
    bookingRoutes(server);
    renderAt("/account?tab=staff");
    expect(await screen.findByRole("heading", { name: "Sign in again to open your staff tools" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeTruthy();
    // Signing in again cannot help an account whose code was shown on screen: say so, no endless loop.
    expect(screen.getByText(/a code shown on screen in the demo confirms nothing/)).toBeTruthy();
    expect(callsTo(server, "GET", "/account/work")).toEqual([]);
  });

  it("explains a missing booking side for a work-only sign-in", async () => {
    setSessionToken("1.9.sig");
    const server = startFakeServer();
    server.routes.set("GET /account/work", () => ({ body: { ...WORK, user: { ...WORK.user, name: "Olivia" } } }));
    renderAt("/account");
    expect(await screen.findByRole("heading", { name: "Your bookings are on the personal side of your account" })).toBeTruthy();
    expect(callsTo(server, "GET", "/diner/bookings")).toEqual([]);
  });

  it("forgets an ended work session (401) and offers to sign in again", async () => {
    setGuestToken("g.1.0.9.sig");
    setSessionToken("3.9.old");
    const server = startFakeServer();
    bookingRoutes(server);
    server.routes.set("GET /account/work", () => errorReply(401, "unauthorised", "Please sign in."));
    renderAt("/account?tab=staff");
    expect(await screen.findByRole("heading", { name: "Sign in again to open your staff tools" })).toBeTruthy();
    expect(getSessionToken()).toBeNull();
    expect(getGuestToken()).toBe("g.1.0.9.sig");
  });

  it("signs out of both sides", async () => {
    setGuestToken("g.1.0.9.sig");
    setSessionToken("3.9.sig");
    const server = startFakeServer();
    bookingRoutes(server);
    server.routes.set("POST /guest/logout", () => ({ body: {} }));
    renderAt("/account");
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in to SeatPlan" })).toBeTruthy();
    expect(getGuestToken()).toBeNull();
    expect(getSessionToken()).toBeNull();
  });
});

describe("/owner/:venueId/team", () => {
  it("adds a member by email and removes one after asking", async () => {
    setSessionToken("1.9.sig");
    const server = startFakeServer();
    let items = [{ id: 1, email: "rita@example.com", role: "staff", created_at: "2026-11-18T10:00:00Z" }];
    server.routes.set("GET /owner/venues/casa/members", () => ({ body: { items } }));
    server.routes.set("GET /owner/restaurants/casa", () => ({ body: { name: "Casa Lumen" } }));
    server.routes.set("POST /owner/venues/casa/members", (body) => {
      const member = { id: 2, email: (body as { email: string }).email, role: "staff", created_at: "2026-11-18T11:00:00Z" };
      items = [...items, member];
      return { status: 201, body: member };
    });
    server.routes.set("DELETE /owner/venues/casa/members/1", () => ({ body: { removed: true } }));
    renderAt("/owner/casa/team");
    expect(await screen.findByText("rita@example.com", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText(/needs a SeatPlan account with this email/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "new.member@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to team" }));
    expect(await screen.findByText("new.member@example.com", { selector: "strong" })).toBeTruthy();
    expect(callsTo(server, "POST", "/owner/venues/casa/members")).toEqual([{ email: "new.member@example.com" }]);
    fireEvent.click(screen.getByRole("button", { name: /Remove\s*rita@example.com/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove member" }));
    await waitFor(() => expect(screen.queryByText("rita@example.com", { selector: "strong" })).toBeNull());
    expect(callsTo(server, "DELETE", "/owner/venues/casa/members/1")).toHaveLength(1);
  });

  it("runs the team of an event venue in words for a venue, without the restaurant steps", async () => {
    setSessionToken("1.9.sig");
    const server = startFakeServer();
    server.routes.set("GET /owner/venues/q1/members", () => ({ body: { items: [] } }));
    server.routes.set("GET /owner/restaurants/q1", () => errorReply(404, "not_found", "Restaurant not found."));
    server.routes.set("GET /account/work", () => ({ body: { ...WORK, event_venues: [{ ...WORK.event_venues[0], role: "owner" }] } }));
    renderAt("/owner/q1/team");
    expect(await screen.findByText("Quinta da Serra Azul")).toBeTruthy();
    expect(await screen.findByText(/the venue then appears under Staff/)).toBeTruthy();
    expect(screen.getByText(/run the events held here with you/)).toBeTruthy();
    expect(screen.queryByText(/restaurant/i)).toBeNull();
    expect(screen.queryByRole("link", { name: "Floor plan" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to your account" }).getAttribute("href")).toBe("/account?tab=staff");
  });

  it("refuses a malformed email before calling the server", async () => {
    setSessionToken("1.9.sig");
    const server = startFakeServer();
    server.routes.set("GET /owner/venues/casa/members", () => ({ body: { items: [] } }));
    renderAt("/owner/casa/team");
    fireEvent.change(await screen.findByLabelText(/^Email/), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to team" }));
    expect(await screen.findByText("Enter an email address like name@example.com.")).toBeTruthy();
    expect(callsTo(server, "POST", "/owner/venues/casa/members")).toEqual([]);
  });
});
