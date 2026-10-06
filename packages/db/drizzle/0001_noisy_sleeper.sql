CREATE TABLE "player_fight_cache" (
	"report_code" text NOT NULL,
	"fight_id" integer NOT NULL,
	"actor_id" integer NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_fight_cache_report_code_fight_id_actor_id_pk" PRIMARY KEY("report_code","fight_id","actor_id")
);
