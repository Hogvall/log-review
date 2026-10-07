import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** One weekly benchmark crawl. The newest `complete` snapshot is what the site compares against. */
export const snapshots = pgTable("snapshots", {
  id: serial("id").primaryKey(),
  /** ISO week, e.g. "2026-W41". Test runs get a suffix. */
  week: text("week").notNull().unique(),
  zoneId: integer("zone_id").notNull(),
  partition: integer("partition").notNull(),
  status: text("status", { enum: ["running", "complete"] }).notNull().default("running"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/** Postgres-backed job queue for the crawler. `key` dedupes jobs (e.g. one fetch per fight per snapshot). */
export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    snapshotId: integer("snapshot_id").references(() => snapshots.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["rankings", "fight"] }).notNull(),
    key: text("key").notNull().unique(),
    payload: jsonb("payload").notNull(),
    /** Lower runs first. */
    priority: integer("priority").notNull().default(0),
    status: text("status", { enum: ["pending", "running", "done", "failed"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("jobs_claim_idx").on(t.priority, t.id).where(sql`${t.status} = 'pending'`),
    index("jobs_snapshot_status_idx").on(t.snapshotId, t.status),
  ],
);

/** The top N players per spec, boss and difficulty in a snapshot. */
export const rankingEntries = pgTable(
  "ranking_entries",
  {
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    encounterId: integer("encounter_id").notNull(),
    difficulty: integer("difficulty").notNull(),
    specKey: text("spec_key").notNull(),
    rank: integer("rank").notNull(),
    name: text("name").notNull(),
    serverName: text("server_name"),
    region: text("region"),
    /** DPS or HPS, depending on role. */
    amount: real("amount").notNull(),
    durationMs: integer("duration_ms").notNull(),
    itemLevel: real("item_level"),
    reportCode: text("report_code").notNull(),
    fightId: integer("fight_id").notNull(),
    talents: jsonb("talents"),
    gear: jsonb("gear"),
  },
  (t) => [
    primaryKey({ name: "ranking_entries_pk", columns: [t.snapshotId, t.encounterId, t.difficulty, t.specKey, t.rank] }),
    index("ranking_entries_fight_idx").on(t.reportCode, t.fightId),
  ],
);

/** Fights we've downloaded. Logs don't change, so a fight is fetched once and reused by later snapshots. */
export const fights = pgTable(
  "fights",
  {
    reportCode: text("report_code").notNull(),
    fightId: integer("fight_id").notNull(),
    encounterId: integer("encounter_id").notNull(),
    difficulty: integer("difficulty").notNull(),
    durationMs: integer("duration_ms").notNull(),
    /** Damage taken was downloaded for this fight (a sample per boss feeds avoidability). */
    hasDamageTaken: boolean("has_damage_taken").notNull().default(false),
    /** Boss phases as fight-relative PhaseSpan[] ([] if the boss has none); null until fetched. */
    phases: jsonb("phases"),
    /**
     * ExecuteStarts: when a boss first reached each execute threshold. null = not checked yet; {} = checked,
     * no ranked player cast an execute so the health graph wasn't fetched.
     */
    executeStarts: jsonb("execute_starts"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.reportCode, t.fightId] })],
);

/** Spec-agnostic metrics for every player in a downloaded fight (not just the ranked ones). */
export const playerMetrics = pgTable(
  "player_metrics",
  {
    reportCode: text("report_code").notNull(),
    fightId: integer("fight_id").notNull(),
    actorId: integer("actor_id").notNull(),
    name: text("name").notNull(),
    specKey: text("spec_key").notNull(),
    /** PlayerMetrics from @log-review/analysis. */
    metrics: jsonb("metrics").notNull(),
    /** Aura ID → uptime share. Fetched only for ranked players (costs one query each). */
    buffUptime: jsonb("buff_uptime"),
    /** [fightTimeMs, abilityId][] casts. Fetched for ranked players (only #1s before timelines were stored for everyone). */
    timeline: jsonb("timeline"),
    /** Ability IDs hardcast before the pull; fetched along with the timeline. */
    precasts: jsonb("precasts"),
  },
  (t) => [
    primaryKey({ columns: [t.reportCode, t.fightId, t.actorId] }),
    index("player_metrics_lookup_idx").on(t.reportCode, t.fightId, t.name, t.specKey),
  ],
);

/** Ability names and icons seen in downloaded fights, for display. */
export const abilities = pgTable("abilities", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon"),
});

/** Median-based benchmark per spec, boss and difficulty. `data` is a SpecBenchmark. */
export const benchmarks = pgTable(
  "benchmarks",
  {
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    encounterId: integer("encounter_id").notNull(),
    difficulty: integer("difficulty").notNull(),
    specKey: text("spec_key").notNull(),
    sampleSize: integer("sample_size").notNull(),
    insufficient: boolean("insufficient").notNull(),
    data: jsonb("data").notNull(),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.encounterId, t.difficulty, t.specKey] })],
);

/**
 * When (and with which code version) each boss and difficulty of a snapshot was last aggregated, so new data
 * (e.g. a backfill) or new aggregation code triggers a re-run.
 */
export const aggregations = pgTable(
  "aggregations",
  {
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    encounterId: integer("encounter_id").notNull(),
    difficulty: integer("difficulty").notNull(),
    aggregatedAt: timestamp("aggregated_at", { withTimezone: true }).notNull().defaultNow(),
    /** BENCHMARK_VERSION it was aggregated with; older ones are re-aggregated after a code change. */
    version: integer("version").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.encounterId, t.difficulty] })],
);

/**
 * Data-driven avoidability of each boss ability, from all non-tank players in the snapshot's fights, plus a
 * separate tank view from the tanks in the same fights.
 */
export const encounterAbilities = pgTable(
  "encounter_abilities",
  {
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    encounterId: integer("encounter_id").notNull(),
    difficulty: integer("difficulty").notNull(),
    abilityId: integer("ability_id").notNull(),
    zeroShare: real("zero_share").notNull(),
    medianDtpsWhenHit: real("median_dtps_when_hit").notNull(),
    sampleSize: integer("sample_size").notNull(),
    classification: text("classification", { enum: ["avoidable", "situational", "unavoidable"] }).notNull(),
    /** From tanks' point of view (tanks take boss melee and tank busters on purpose); null without enough tanks. */
    tankZeroShare: real("tank_zero_share"),
    tankClassification: text("tank_classification", { enum: ["avoidable", "situational", "unavoidable", "tank-mechanic"] }),
  },
  (t) => [primaryKey({ name: "encounter_abilities_pk", columns: [t.snapshotId, t.encounterId, t.difficulty, t.abilityId] })],
);

/**
 * WCL data fetched to analyze one player in one fight. Logs don't change, so shared links
 * cost no API points. The analysis itself is recomputed per view so it picks up newer benchmarks.
 */
export const playerFightCache = pgTable(
  "player_fight_cache",
  {
    reportCode: text("report_code").notNull(),
    fightId: integer("fight_id").notNull(),
    actorId: integer("actor_id").notNull(),
    data: jsonb("data").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.reportCode, t.fightId, t.actorId] })],
);

/**
 * WCL data fetched for a whole report view (e.g. a raid night on one boss), keyed by what was fetched.
 * Logs don't change, but live logs gain pulls, so keys include the last pull covered.
 */
export const reportCache = pgTable(
  "report_cache",
  {
    reportCode: text("report_code").notNull(),
    key: text("key").notNull(),
    data: jsonb("data").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.reportCode, t.key] })],
);
