ALTER TABLE "fights" ADD COLUMN "has_damage_taken" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Fights downloaded before sampling all have damage taken.
UPDATE "fights" SET "has_damage_taken" = true;
