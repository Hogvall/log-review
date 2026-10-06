const TOKEN_URL = "https://www.warcraftlogs.com/oauth/token";
const API_URL = "https://www.warcraftlogs.com/api/v2/client";

export class WclError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "not_found" | "private" | "rate_limited" | "api",
  ) {
    super(message);
  }
}

export interface WclCredentials {
  clientId: string;
  clientSecret: string;
}

/** Reads WCL_CLIENT_ID / WCL_CLIENT_SECRET, throwing a helpful error if missing. */
export function credentialsFromEnv(env: Record<string, string | undefined> = process.env): WclCredentials {
  const clientId = env.WCL_CLIENT_ID;
  const clientSecret = env.WCL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new WclError(
      "WCL_CLIENT_ID and WCL_CLIENT_SECRET must be set. Create a client at https://www.warcraftlogs.com/api/clients",
      "auth",
    );
  }
  return { clientId, clientSecret };
}

/** Anything that can run a WCL GraphQL query, e.g. a WclClient or a budget-limited wrapper. */
export interface WclQuerier {
  query<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

/** Minimal WCL v2 GraphQL client using the client-credentials flow (public reports only). */
export class WclClient implements WclQuerier {
  private token?: { value: string; expiresAt: number };

  constructor(private readonly creds: WclCredentials) {}

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new WclError(`WCL token request failed (${res.status})`, "auth");

    const body = (await res.json()) as { access_token: string; expires_in: number };
    // Refresh a minute early so in-flight requests never use an expired token.
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
    return this.token.value;
  }

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) throw new WclError("WCL rate limit reached, try again later", "rate_limited");
    if (res.status === 401) {
      this.token = undefined;
      throw new WclError("WCL rejected the access token", "auth");
    }
    if (!res.ok) throw new WclError(`WCL API error (${res.status})`, "api");

    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) {
      const message = body.errors.map((e) => e.message).join("; ");
      if (/permission|private/i.test(message)) throw new WclError("This log is private", "private");
      if (/does not exist|not found/i.test(message)) throw new WclError("Report not found", "not_found");
      throw new WclError(message, "api");
    }
    return body.data as T;
  }
}
