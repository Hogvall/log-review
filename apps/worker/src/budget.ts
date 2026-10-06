import { type WclClient, type WclQuerier, getRateLimit } from "@log-review/wcl";

/** Re-read the real spend this often, since the website spends from the same budget. */
const SYNC_EVERY = 25;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps a WclClient so every query waits until the client has budget left under `limit`.
 * Each WCL query costs about one point regardless of size, so we count one per query and
 * periodically resync with WCL's own numbers.
 */
export class BudgetedClient implements WclQuerier {
  private spent = 0;
  private resetAt = 0;
  private sinceSync = Number.POSITIVE_INFINITY;

  constructor(
    private readonly client: WclClient,
    private readonly limit: number,
  ) {}

  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    await this.take(1);
    return this.client.query<T>(query, variables);
  }

  private async sync() {
    const rl = await getRateLimit(this.client);
    this.spent = rl.pointsSpentThisHour + 1; // the rate-limit query itself costs a point
    this.resetAt = Date.now() + rl.pointsResetIn * 1000;
    this.sinceSync = 0;
  }

  private async take(points: number) {
    if (Date.now() >= this.resetAt || this.sinceSync >= SYNC_EVERY) await this.sync();
    while (this.spent + points > this.limit) {
      const waitMs = Math.max(0, this.resetAt - Date.now()) + 5_000;
      console.log(`budget: ${this.spent.toFixed(0)}/${this.limit} points used this hour, pausing ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      await this.sync();
    }
    this.spent += points;
    this.sinceSync++;
  }
}
