CREATE TABLE "aggregations" (
	"snapshot_id" integer NOT NULL,
	"encounter_id" integer NOT NULL,
	"difficulty" integer NOT NULL,
	"aggregated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aggregations_snapshot_id_encounter_id_difficulty_pk" PRIMARY KEY("snapshot_id","encounter_id","difficulty")
);
--> statement-breakpoint
ALTER TABLE "fights" ADD COLUMN "phases" jsonb;--> statement-breakpoint
ALTER TABLE "player_metrics" ADD COLUMN "precasts" jsonb;--> statement-breakpoint
ALTER TABLE "aggregations" ADD CONSTRAINT "aggregations_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;