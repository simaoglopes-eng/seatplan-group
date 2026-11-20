// One account (docs/api.md, "One account"): one sign-up and one sign-in open both
// halves of a SeatPlan account. The personal half ("guest" session) books tables
// and seats; the work half ("organiser" session) runs restaurants, venues and events.
// The two tokens stay under their own keys (client.ts) and never open each other's routes.
import { api, clearGuestToken, clearSessionToken, setGuestToken, setSessionToken } from "./client";
import type { CodeSent, GuestSession } from "./guest";
import { guestLogout } from "./guest";

export type WorkRole = "owner" | "staff" | "organiser";

export interface WorkSession {
  token: string;
  user: { email: string; name: string; role: "organiser" | "staff" };
}

/** POST /account/login: only the identities this password opens. */
export interface AccountSessions {
  guest?: GuestSession;
  work?: WorkSession;
}

/** POST /guest/verify after POST /account/register: the personal session, and the work one when this sign-up made it. */
export interface AccountVerify extends GuestSession {
  join: { status: string; event_id: string | null };
  work?: WorkSession;
}

export interface AccountRegisterIn {
  name: string;
  email: string;
  password: string;
  consent: true;
}

/**
 * Keeps exactly the sessions in `sessions` and forgets any other, so a session
 * left in this tab by an earlier sign-in (perhaps another person's) never survives.
 */
export function keepAccountSessions(sessions: AccountSessions): void {
  clearGuestToken();
  clearSessionToken();
  if (sessions.guest) setGuestToken(sessions.guest.token);
  if (sessions.work) setSessionToken(sessions.work.token);
}

/** Signs in with one password. A 401 means neither identity opened; the stored sessions are then left as they were. */
export async function accountLogin(email: string, password: string): Promise<AccountSessions> {
  const answer = await api.post<AccountSessions>("/account/login", { email, password }, "none");
  keepAccountSessions(answer);
  return answer;
}

/** Same 202 answer whether or not the address already has an account (demo_code only in the demo). */
export function accountRegister(body: AccountRegisterIn): Promise<CodeSent> {
  return api.post<CodeSent>("/account/register", body, "none");
}

/**
 * Finishes the sign-up with the emailed code. When the address already had a work
 * account, verify does not send it; the same password then asks /account/login for it.
 * If that extra sign-in fails, the person stays signed in for bookings only.
 */
export async function verifyAccount(email: string, code: string, signupId: string, password: string): Promise<AccountSessions> {
  const verified = await api.post<AccountVerify>("/guest/verify", { email, code, signup_id: signupId }, "none");
  const guest: GuestSession = { token: verified.token, account: verified.account };
  keepAccountSessions({ guest, work: verified.work });
  if (verified.work) return { guest, work: verified.work };
  try {
    return await accountLogin(email, password);
  } catch {
    keepAccountSessions({ guest });
    return { guest };
  }
}

/** Ends the personal session on the server and forgets both sessions in this tab, even when offline. */
export async function accountSignOut(): Promise<void> {
  try {
    await guestLogout();
  } catch {
    // guestLogout forgets the guest token either way.
  } finally {
    clearGuestToken();
    clearSessionToken();
  }
}

// ---------- GET /account/work ----------

export interface WorkRestaurant {
  public_id: string;
  name: string;
  slug: string | null;
  status: "draft" | "published";
  role: "owner" | "staff";
}

export interface WorkEventVenue extends WorkRestaurant {
  venue_type: "hall" | "quinta" | null;
}

export interface WorkEvent {
  public_id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  event_type: string | null;
  event_type_label: string | null;
  listed: boolean;
  venue_public_id: string;
  venue_name: string | null;
  role: "organiser" | "staff";
}

export interface AccountWork {
  user: { email: string; name: string; role: "organiser" | "staff" };
  restaurants: WorkRestaurant[];
  event_venues: WorkEventVenue[];
  events: WorkEvent[];
}

export function getAccountWork(): Promise<AccountWork> {
  return api.get<AccountWork>("/account/work");
}

// ---------- Venue team (owner only) ----------

export interface VenueMember {
  id: number;
  email: string;
  role: "staff";
  created_at: string;
}

const membersPath = (venueId: string) => `/owner/venues/${encodeURIComponent(venueId)}/members`;

export function listMembers(venueId: string): Promise<{ items: VenueMember[] }> {
  return api.get(membersPath(venueId));
}

export function addMember(venueId: string, email: string): Promise<VenueMember> {
  return api.post(membersPath(venueId), { email });
}

export function removeMember(venueId: string, memberId: number): Promise<{ removed: true }> {
  return api.delete(`${membersPath(venueId)}/${memberId}`);
}

// ---------- GET /events: the events this work account can run ----------

/** One row of GET /events: the account's own events first, then those at venues where it is a member. */
export interface RunnableEvent {
  public_id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  event_type: string | null;
  event_type_label: string | null;
  listed: boolean;
  venue_name: string | null;
  role: "organiser" | "staff";
}

export function listRunnableEvents(): Promise<RunnableEvent[]> {
  return api.get<RunnableEvent[]>("/events");
}
