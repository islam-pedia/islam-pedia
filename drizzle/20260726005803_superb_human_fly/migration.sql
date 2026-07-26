CREATE TYPE "person_name_type" AS ENUM('personal', 'kunyah', 'laqab', 'nisbah', 'nasab', 'alias');--> statement-breakpoint
CREATE TABLE "person_names" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"entity_id" uuid NOT NULL,
	"type" "person_name_type" NOT NULL,
	"name_original" text NOT NULL,
	"name_original_normalized" text NOT NULL,
	"name_latin" text NOT NULL,
	"name_latin_normalized" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"normalization_version" smallint DEFAULT 1 NOT NULL,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_names_original_not_blank" CHECK (btrim("name_original") <> ''),
	CONSTRAINT "person_names_original_normalized_not_blank" CHECK (btrim("name_original_normalized") <> ''),
	CONSTRAINT "person_names_latin_not_blank" CHECK (btrim("name_latin") <> ''),
	CONSTRAINT "person_names_latin_normalized_not_blank" CHECK (btrim("name_latin_normalized") <> ''),
	CONSTRAINT "person_names_normalization_version_positive" CHECK ("normalization_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "person_names_entity_type_names_uidx" ON "person_names" ("entity_id","type","name_original_normalized","name_latin_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "person_names_entity_primary_uidx" ON "person_names" ("entity_id") WHERE "is_primary";--> statement-breakpoint
CREATE INDEX "person_names_entity_type_idx" ON "person_names" ("entity_id","type");--> statement-breakpoint
CREATE INDEX "person_names_created_by_run_idx" ON "person_names" ("created_by_run_id");--> statement-breakpoint
CREATE INDEX "person_names_original_trgm_idx" ON "person_names" USING gin ("name_original_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "person_names_latin_trgm_idx" ON "person_names" USING gin ("name_latin_normalized" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "person_names" ADD CONSTRAINT "person_names_entity_id_people_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "people"("entity_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "person_names" ADD CONSTRAINT "person_names_created_by_run_id_ingestion_runs_id_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
INSERT INTO "person_names" (
	"id",
	"entity_id",
	"type",
	"name_original",
	"name_original_normalized",
	"name_latin",
	"name_latin_normalized",
	"is_primary",
	"normalization_version",
	"created_by_run_id",
	"created_at"
)
SELECT
	uuidv7(),
	"people"."entity_id",
	'personal'::"person_name_type",
	"people"."name_original",
	"people"."name_original_normalized",
	"people"."name_latin",
	"people"."name_latin_normalized",
	true,
	"people"."normalization_version",
	"entities"."created_by_run_id",
	"entities"."created_at"
FROM "people"
INNER JOIN "entities" ON "entities"."id" = "people"."entity_id";
