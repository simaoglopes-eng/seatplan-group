// A table booked while signed in belongs to that account (POST /r/{vid}/bookings reads the guest
// session, never the work one): the booking then shows under Booking on /account at once.
import { afterEach, describe, expect, it, vi } from "vitest";
import { setGuestToken, setSessionToken } from "./client";
import { createBooking } from "./restaurant";

const CONFIRMATION = {
  booking: { id: "b1", date: "2026-12-01", time: "19:00", end_time: "20:30", party_size: 2, status: "confirmed", tables: ["T1"], restaurant: { name: "Casa Lumen" } },
  manage_token: "t",
  manage_path: "/b/t",
  manage_link: "http://x/b/t",
};

function fakeFetch(): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(async () => new Response(JSON.stringify(CONFIRMATION), { status: 201 }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function sentAuthorization(fetch: ReturnType<typeof vi.fn>): string | null {
  const init = fetch.mock.calls[0][1] as RequestInit;
  return new Headers(init.headers).get("Authorization");
}

const CONTACT = { name: "Gina", email: "gina@example.com", phone: "", notes: "", occasion: "", dietary_requirements: "", allergies: "" };
const NEEDS = { party: 2, needs_accessible: false, high_chairs: 0 };

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("createBooking", () => {
  it("sends the personal session, never the work one", async () => {
    setGuestToken("g.1.0.9.sig");
    setSessionToken("3.9.sig");
    const fetch = fakeFetch();
    await createBooking("casa", "h1", CONTACT as never, NEEDS as never);
    expect(sentAuthorization(fetch)).toBe("Bearer g.1.0.9.sig");
  });

  it("sends no token at all when nobody is signed in to the personal side", async () => {
    setSessionToken("3.9.sig");
    const fetch = fakeFetch();
    await createBooking("casa", "h1", CONTACT as never, NEEDS as never);
    expect(sentAuthorization(fetch)).toBeNull();
  });
});
