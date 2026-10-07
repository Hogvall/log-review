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

/** Statuses worth retrying: WCL or its CDN having a moment, not a problem with our request or credentials. */
const RETRYABLE = new Set([403, 429, 500, 502, 503, 504]);
/** Waits before each retry of the token request. */
const TOKEN_BACKOFF_MS = [500, 1500];
/** Wait before the single retry of an API call. */
const QUERY_RETRY_MS = 500;

export interface WclClientOptions {
  /** For tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Minimal WCL v2 GraphQL client using the client-credentials flow (public reports only). */
export class WclClient implements WclQuerier {
  private token?: { value: string; expiresAt: number };
  /** A token request in flight, shared by concurrent queries. */
  private pendingToken?: Promise<string>;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly creds: WclCredentials,
    opts: WclClientOptions = {},
  ) {
    this.fetch = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return Promise.resolve(this.token.value);
    this.pendingToken ??= this.requestToken().finally(() => {
      this.pendingToken = undefined;
    });
    return this.pendingToken;
  }

  /**
   * Gets a token, retrying short WCL/CDN hiccups (network errors, 5xx, 403, 429) with backoff. A 400/401
   * means the credentials are wrong, so that fails at once.
   */
  private async requestToken(): Promise<string> {
    let last = "";
    for (let attempt = 0; attempt <= TOKEN_BACKOFF_MS.length; attempt++) {
      if (attempt > 0) await this.sleep(TOKEN_BACKOFF_MS[attempt - 1]!);
      let res: Response;
      try {
        res = await this.fetch(TOKEN_URL, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        });
      } catch (err) {
        last = `network error: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(`WCL token request failed (${last}), attempt ${attempt + 1}`);
        continue;
      }
      if (res.ok) {
        const body = (await res.json()) as { access_token: string; expires_in: number };
        // Refresh a minute early so in-flight requests never use an expired token.
        this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
        return this.token.value;
      }
      last = `status ${res.status}`;
      console.warn(`WCL token request failed (${last}), attempt ${attempt + 1}`);
      if (!RETRYABLE.has(res.status)) break;
    }
    throw new WclError(`WCL token request failed (${last})`, "auth");
  }

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return this.queryOnce<T>(query, variables, true);
  }

  private async queryOnce<T>(query: string, variables: Record<string, unknown>, mayRetry: boolean): Promise<T> {
    const retry = async () => {
      await this.sleep(QUERY_RETRY_MS);
      return this.queryOnce<T>(query, variables, false);
    };

    let res: Response;
    try {
      res = await this.fetch(API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      if (err instanceof WclError) throw err;
      if (mayRetry) return retry();
      throw new WclError(`WCL API unreachable: ${err instanceof Error ? err.message : String(err)}`, "api");
    }
    if (res.status === 429) throw new WclError("WCL rate limit reached, try again later", "rate_limited");
    if (res.status === 401) {
      // The token may have been revoked or expired early: get a fresh one and try once more.
      this.token = undefined;
      if (mayRetry) return retry();
      throw new WclError("WCL rejected the access token", "auth");
    }
    if (res.status >= 502 && res.status <= 504 && mayRetry) return retry();
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
