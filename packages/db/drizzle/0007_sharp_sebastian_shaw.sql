CREATE TABLE "report_cache" (
	"report_code" text NOT NULL,
	"key" text NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_cache_report_code_key_pk" PRIMARY KEY("report_code","key")
);
