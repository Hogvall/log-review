import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WclClient, WclError } from "./client";

type Step = number | "network" | { status: number; body: unknown };

/** A fake fetch that answers token and API requests from two scripted lists, and records every call. */
function fakeFetch(tokenSteps: Step[], apiSteps: Step[]) {
  const calls: string[] = [];
  const answer = (step: Step | undefined, ok: unknown) => {
    if (step === "network") throw new TypeError("fetch failed");
    const { status, body } = typeof step === "object" ? step : { status: step ?? 200, body: ok };
    return new Response(JSON.stringify(body), { status });
  };
  const fn = vi.fn(async (url: string | URL | Request) => {
    const isToken = String(url).includes("oauth/token");
    calls.push(isToken ? "token" : "api");
    return isToken
      ? answer(tokenSteps.shift(), { access_token: "t", expires_in: 3600 })
      : answer(apiSteps.shift(), { data: { ok: true } });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const creds = { clientId: "id", clientSecret: "secret" };
const noSleep = () => Promise.resolve();

describe("WclClient retries", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("retries a token request that hits a short WCL/CDN hiccup", async () => {
    const { fetch, calls } = fakeFetch([503, "network", 200], [200]);
    const client = new WclClient(creds, { fetch, sleep: noSleep });
    await expect(client.query("{ x }")).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["token", "token", "token", "api"]);
  });

  it("gives up after three token attempts with an auth error naming the status", async () => {
    const { fetch, calls } = fakeFetch([503, 503, 403], []);
    const client = new WclClient(creds, { fetch, sleep: noSleep });
    const err = await client.query("{ x }").catch((e) => e);
    expect(err).toBeInstanceOf(WclError);
    expect(err).toMatchObject({ kind: "auth", message: "WCL token request failed (status 403)" });
    expect(calls).toEqual(["token", "token", "token"]);
  });

  it("doesn't retry bad credentials", async () => {
    const { fetch, calls } = fakeFetch([401], []);
    const client = new WclClient(creds, { fetch, sleep: noSleep });
    await expect(client.query("{ x }")).rejects.toMatchObject({ kind: "auth" });
    expect(calls).toEqual(["token"]);
  });

  it("shares one token request between concurrent queries", async () => {
    const { fetch, calls } = fakeFetch([200], [200, 200, 200]);
    const client = new WclClient(creds, { fetch, sleep: noSleep });
    await Promise.all([client.query("{ a }"), client.query("{ b }"), client.query("{ c }")]);
    expect(calls.filter((c) => c === "token")).toHaveLength(1);
  });

  it("gets a fresh token once when the API rejects the current one", async () => {
    const { fetch, calls } = fakeFetch([200, 200], [401, 200]);
    const client = new WclClient(creds, { fetch, sleep: noSleep });
    await expect(client.query("{ x }")).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["token", "api", "token", "api"]);
  });

  it("retries an API call once on network errors and 5xx gateways, then reports an api error", async () => {
    const ok = fakeFetch([200], ["network", 200]);
    await expect(new WclClient(creds, { fetch: ok.fetch, sleep: noSleep }).query("{ x }")).resolves.toEqual({ ok: true });

    const down = fakeFetch([200], [502, "network"]);
    await expect(new WclClient(creds, { fetch: down.fetch, sleep: noSleep }).query("{ x }")).rejects.toMatchObject({ kind: "api" });
    expect(down.calls).toEqual(["token", "api", "api"]);
  });

  it("still maps rate limits and GraphQL errors without retrying", async () => {
    const limited = fakeFetch([200], [429]);
    await expect(new WclClient(creds, { fetch: limited.fetch, sleep: noSleep }).query("{ x }")).rejects.toMatchObject({ kind: "rate_limited" });
    expect(limited.calls).toEqual(["token", "api"]);

    const priv = fakeFetch([200], [{ status: 200, body: { errors: [{ message: "You do not have permission to view this report" }] } }]);
    await expect(new WclClient(creds, { fetch: priv.fetch, sleep: noSleep }).query("{ x }")).rejects.toMatchObject({ kind: "private" });
  });
});
