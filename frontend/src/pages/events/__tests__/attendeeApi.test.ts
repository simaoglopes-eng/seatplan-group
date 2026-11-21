// linkApi and accountApi must call the right paths: the attendee screens use
// either one without knowing which (docs/guest-accounts.md section 10.2).
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountApi, linkApi } from "../attendeeApi";
import type { AttendeeApi } from "../attendeeApi";
import { startFakeServer } from "./mockServer";

/** Calls every method once and returns "METHOD path" for each request. */
async function callEverything(attendeeApi: AttendeeApi): Promise<string[]> {
  const server = startFakeServer();
  const answer = () => ({ body: {} });
  // Every path answers 200, so no call throws.
  const paths = ["", "/people", "/rsvp", "/knows", "/privacy", "/recommendations", "/hold", "/confirm", "/seat"];
  for (const prefix of ["/a/tok", "/guest/events/ev1"]) {
    for (const method of ["GET", "POST", "DELETE"]) for (const rest of paths) server.routes.set(`${method} ${prefix}${rest}`, answer);
  }
  await attendeeApi.view();
  await attendeeApi.recommendations();
  await attendeeApi.people("ana");
  await attendeeApi.rsvp("yes");
  await attendeeApi.knows([2]);
  await attendeeApi.privacy(true);
  await attendeeApi.hold(11);
  await attendeeApi.confirm(11);
  await attendeeApi.release();
  return server.calls.map((c) => `${c.method} ${c.path}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("attendee adapters", () => {
  it("linkApi uses the personal link paths", async () => {
    expect(await callEverything(linkApi("tok"))).toEqual([
      "GET /a/tok",
      "GET /a/tok/recommendations",
      "GET /a/tok/people",
      "POST /a/tok/rsvp",
      "POST /a/tok/knows",
      "POST /a/tok/privacy",
      "POST /a/tok/hold",
      "POST /a/tok/confirm",
      "DELETE /a/tok/seat",
    ]);
  });

  it("accountApi uses the guest account paths, with the same bodies", async () => {
    const calls = await callEverything(accountApi("ev1"));
    expect(calls).toEqual([
      "GET /guest/events/ev1",
      "GET /guest/events/ev1/recommendations",
      "GET /guest/events/ev1/people",
      "POST /guest/events/ev1/rsvp",
      "POST /guest/events/ev1/knows",
      "POST /guest/events/ev1/privacy",
      "POST /guest/events/ev1/hold",
      "POST /guest/events/ev1/confirm",
      "DELETE /guest/events/ev1/seat",
    ]);
  });

  it("both adapters reach the same party routes, with the same bodies", async () => {
    const body = { me: { seat_id: 1, first_name: "Ana", last_name: "Silva", age: 40 }, members: [{ seat_id: 2, first_name: "Bea", last_name: "Silva", age: 9 }] };
    const seen: Record<string, string[]> = {};
    for (const [prefix, adapter] of [
      ["/a/tok", linkApi("tok")],
      ["/guest/events/ev1", accountApi("ev1")],
    ] as const) {
      const server = startFakeServer();
      for (const route of ["GET /party", "POST /party/confirm", "POST /party/me", "PATCH /party/4", "PUT /party/4/seat", "DELETE /party/4"]) {
        const [method, rest] = route.split(" ");
        server.routes.set(`${method} ${prefix}${rest}`, () => ({ body: {} }));
      }
      await adapter.party();
      await adapter.partyConfirm(body);
      await adapter.partyMe({ first_name: "Ana", last_name: "Silva" });
      await adapter.partyEdit(4, { age: 10 });
      await adapter.partyMove(4, 7);
      await adapter.partyRemove(4);
      seen[prefix] = server.calls.map((c) => `${c.method} ${c.path} ${JSON.stringify(c.body ?? null)}`);
      vi.unstubAllGlobals();
    }
    expect(seen["/a/tok"]).toEqual([
      "GET /a/tok/party null",
      `POST /a/tok/party/confirm ${JSON.stringify(body)}`,
      'POST /a/tok/party/me {"first_name":"Ana","last_name":"Silva"}',
      'PATCH /a/tok/party/4 {"age":10}',
      'PUT /a/tok/party/4/seat {"seat_id":7}',
      "DELETE /a/tok/party/4 null",
    ]);
    expect(seen["/guest/events/ev1"]).toEqual(seen["/a/tok"].map((line) => line.replace("/a/tok", "/guest/events/ev1")));
  });
});
