// One account (docs/api.md, "One account"): which sessions the browser keeps after a sign-in or a sign-up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGuestToken, getSessionToken, setGuestToken, setSessionToken } from "./client";
import { accountLogin, accountSignOut, keepAccountSessions, verifyAccount } from "./account";
import { callsTo, errorReply, startFakeServer } from "../pages/events/__tests__/mockServer";

const GUEST = { token: "g.9.0.9999999999.sig", account: { name: "Nina", email: "nina@example.com", created_at: "2026-11-18T10:00:00Z" } };
const WORK = { token: "9.9999999999.sig", user: { email: "nina@example.com", name: "Nina", role: "organiser" as const } };

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("keepAccountSessions", () => {
  it("stores both tokens when both identities open", () => {
    keepAccountSessions({ guest: GUEST, work: WORK });
    expect(getGuestToken()).toBe(GUEST.token);
    expect(getSessionToken()).toBe(WORK.token);
  });

  it("forgets an older work session when only the personal identity opens", () => {
    // Someone else's staff session left in this tab must never survive a new sign-in.
    setSessionToken("1.111.someone-else");
    keepAccountSessions({ guest: GUEST });
    expect(getGuestToken()).toBe(GUEST.token);
    expect(getSessionToken()).toBeNull();
  });

  it("forgets an older guest session when only the work identity opens", () => {
    setGuestToken("g.1.0.111.someone-else");
    keepAccountSessions({ work: WORK });
    expect(getGuestToken()).toBeNull();
    expect(getSessionToken()).toBe(WORK.token);
  });
});

describe("accountLogin", () => {
  it("posts only email and password, without a session, and keeps what comes back", async () => {
    setSessionToken("1.111.old");
    const server = startFakeServer();
    server.routes.set("POST /account/login", () => ({ body: { guest: GUEST, work: WORK } }));
    const answer = await accountLogin("nina@example.com", "a long password");
    expect(callsTo(server, "POST", "/account/login")).toEqual([{ email: "nina@example.com", password: "a long password" }]);
    const sent = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1];
    expect(new Headers(sent.headers).get("Authorization")).toBeNull();
    expect(answer.work?.user.name).toBe("Nina");
    expect(getSessionToken()).toBe(WORK.token);
    expect(getGuestToken()).toBe(GUEST.token);
  });

  it("keeps the current sessions when the password is wrong", async () => {
    setGuestToken("g.1.0.111.mine");
    const server = startFakeServer();
    server.routes.set("POST /account/login", () => errorReply(401, "unauthorised", "Email or password is not correct."));
    await expect(accountLogin("nina@example.com", "wrong")).rejects.toMatchObject({ code: "unauthorised" });
    expect(getGuestToken()).toBe("g.1.0.111.mine");
  });
});

describe("verifyAccount", () => {
  it("keeps the work session that the sign-up created", async () => {
    const server = startFakeServer();
    server.routes.set("POST /guest/verify", () => ({ status: 201, body: { ...GUEST, join: { status: "account_only", event_id: null }, work: WORK } }));
    await verifyAccount("nina@example.com", "123456", "signup", "a long password");
    expect(getGuestToken()).toBe(GUEST.token);
    expect(getSessionToken()).toBe(WORK.token);
    expect(callsTo(server, "POST", "/account/login")).toEqual([]);
  });

  it("asks /account/login for the work session when the address already had one", async () => {
    setSessionToken("1.111.someone-else");
    const server = startFakeServer();
    server.routes.set("POST /guest/verify", () => ({ status: 201, body: { ...GUEST, join: { status: "account_only", event_id: null } } }));
    server.routes.set("POST /account/login", () => ({ body: { guest: GUEST, work: WORK } }));
    await verifyAccount("nina@example.com", "123456", "signup", "a long password");
    expect(callsTo(server, "POST", "/account/login")).toEqual([{ email: "nina@example.com", password: "a long password" }]);
    expect(getSessionToken()).toBe(WORK.token);
  });

  it("stays signed in for bookings when that extra sign-in fails", async () => {
    setSessionToken("1.111.someone-else");
    const server = startFakeServer();
    server.routes.set("POST /guest/verify", () => ({ status: 201, body: { ...GUEST, join: { status: "account_only", event_id: null } } }));
    server.routes.set("POST /account/login", () => errorReply(429, "rate_limited", "Too many attempts."));
    await verifyAccount("nina@example.com", "123456", "signup", "a long password");
    expect(getGuestToken()).toBe(GUEST.token);
    expect(getSessionToken()).toBeNull();
  });
});

describe("accountSignOut", () => {
  it("forgets both sessions even when the server cannot be reached", async () => {
    setGuestToken(GUEST.token);
    setSessionToken(WORK.token);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await accountSignOut();
    expect(getGuestToken()).toBeNull();
    expect(getSessionToken()).toBeNull();
  });
});
