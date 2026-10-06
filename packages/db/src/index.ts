import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: 5 });
  return Object.assign(drizzle(client, { schema }), { close: () => client.end() });
}

export type Db = ReturnType<typeof createDb>;
