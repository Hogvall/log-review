import { type Db, createDb } from "@log-review/db";
import { WclClient, credentialsFromEnv } from "@log-review/wcl";

// Created lazily so `next build` never needs runtime secrets.
let db: Db | undefined;
let wcl: WclClient | undefined;

export const getDb = () => (db ??= createDb());
export const getWcl = () => (wcl ??= new WclClient(credentialsFromEnv()));
