CREATE TABLE "abilities" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text
);
--> statement-breakpoint
CREATE TABLE "benchmarks" (
	"snapshot_id" integer NOT NULL,
	"encounter_id" integer NOT NULL,
	"difficulty" integer NOT NULL,
	"spec_key" text NOT NULL,
	"sample_size" integer NOT NULL,
	"insufficient" boolean NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "benchmarks_snapshot_id_encounter_id_difficulty_spec_key_pk" PRIMARY KEY("snapshot_id","encounter_id","difficulty","spec_key")
);
--> statement-breakpoint
CREATE TABLE "encounter_abilities" (
	"snapshot_id" integer NOT NULL,
	"encounter_id" integer NOT NULL,
	"difficulty" integer NOT NULL,
	"ability_id" integer NOT NULL,
	"zero_share" real NOT NULL,
	"median_dtps_when_hit" real NOT NULL,
	"sample_size" integer NOT NULL,
	"classification" text NOT NULL,
	CONSTRAINT "encounter_abilities_pk" PRIMARY KEY("snapshot_id","encounter_id","difficulty","ability_id")
);
--> statement-breakpoint
CREATE TABLE "fights" (
	"report_code" text NOT NULL,
	"fight_id" integer NOT NULL,
	"encounter_id" integer NOT NULL,
	"difficulty" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fights_report_code_fight_id_pk" PRIMARY KEY("report_code","fight_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"snapshot_id" integer,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "player_metrics" (
	"report_code" text NOT NULL,
	"fight_id" integer NOT NULL,
	"actor_id" integer NOT NULL,
	"name" text NOT NULL,
	"spec_key" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"buff_uptime" jsonb,
	"timeline" jsonb,
	CONSTRAINT "player_metrics_report_code_fight_id_actor_id_pk" PRIMARY KEY("report_code","fight_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "ranking_entries" (
	"snapshot_id" integer NOT NULL,
	"encounter_id" integer NOT NULL,
	"difficulty" integer NOT NULL,
	"spec_key" text NOT NULL,
	"rank" integer NOT NULL,
	"name" text NOT NULL,
	"server_name" text,
	"region" text,
	"amount" real NOT NULL,
	"duration_ms" integer NOT NULL,
	"item_level" real,
	"report_code" text NOT NULL,
	"fight_id" integer NOT NULL,
	"talents" jsonb,
	"gear" jsonb,
	CONSTRAINT "ranking_entries_pk" PRIMARY KEY("snapshot_id","encounter_id","difficulty","spec_key","rank")
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"week" text NOT NULL,
	"zone_id" integer NOT NULL,
	"partition" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "snapshots_week_unique" UNIQUE("week")
);
--> statement-breakpoint
ALTER TABLE "benchmarks" ADD CONSTRAINT "benchmarks_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounter_abilities" ADD CONSTRAINT "encounter_abilities_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ranking_entries" ADD CONSTRAINT "ranking_entries_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("priority","id") WHERE "jobs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "jobs_snapshot_status_idx" ON "jobs" USING btree ("snapshot_id","status");--> statement-breakpoint
CREATE INDEX "player_metrics_lookup_idx" ON "player_metrics" USING btree ("report_code","fight_id","name","spec_key");--> statement-breakpoint
CREATE INDEX "ranking_entries_fight_idx" ON "ranking_entries" USING btree ("report_code","fight_id");