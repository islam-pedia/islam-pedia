CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE TYPE "entity_kind" AS ENUM('person');--> statement-breakpoint
CREATE TYPE "entity_status" AS ENUM('provisional', 'active', 'merged');--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"kind" "entity_kind" DEFAULT 'person'::"entity_kind" NOT NULL,
	"status" "entity_status" DEFAULT 'provisional'::"entity_status" NOT NULL,
	"merged_into_entity_id" uuid,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_merge_state_check" CHECK ((
        ("status" = 'merged' AND "merged_into_entity_id" IS NOT NULL)
        OR
        ("status" <> 'merged' AND "merged_into_entity_id" IS NULL)
      )),
	CONSTRAINT "entities_cannot_merge_into_self" CHECK ("merged_into_entity_id" IS NULL OR "merged_into_entity_id" <> "id")
);
--> statement-breakpoint
CREATE TABLE "entity_search_terms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"entity_id" uuid NOT NULL,
	"term" text NOT NULL,
	"normalized_term" text NOT NULL,
	"weight" smallint DEFAULT 50 NOT NULL,
	"normalization_version" smallint DEFAULT 1 NOT NULL,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_search_terms_term_not_blank" CHECK (btrim("term") <> ''),
	CONSTRAINT "entity_search_terms_normalized_not_blank" CHECK (btrim("normalized_term") <> ''),
	CONSTRAINT "entity_search_terms_weight_range" CHECK ("weight" BETWEEN 1 AND 100),
	CONSTRAINT "entity_search_terms_normalization_version_positive" CHECK ("normalization_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"idempotency_key" text NOT NULL,
	"instruction" text,
	"source_label" text,
	"source_uri" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_runs_idempotency_key_not_blank" CHECK (btrim("idempotency_key") <> '')
);
--> statement-breakpoint
CREATE TABLE "people" (
	"entity_id" uuid PRIMARY KEY,
	"name_original" text NOT NULL,
	"name_original_normalized" text NOT NULL,
	"name_latin" text NOT NULL,
	"name_latin_normalized" text NOT NULL,
	"normalization_version" smallint DEFAULT 1 NOT NULL,
	CONSTRAINT "people_name_original_not_blank" CHECK (btrim("name_original") <> ''),
	CONSTRAINT "people_name_original_normalized_not_blank" CHECK (btrim("name_original_normalized") <> ''),
	CONSTRAINT "people_name_latin_not_blank" CHECK (btrim("name_latin") <> ''),
	CONSTRAINT "people_name_latin_normalized_not_blank" CHECK (btrim("name_latin_normalized") <> ''),
	CONSTRAINT "people_normalization_version_positive" CHECK ("normalization_version" > 0)
);
--> statement-breakpoint
CREATE INDEX "entities_kind_status_idx" ON "entities" ("kind","status");--> statement-breakpoint
CREATE INDEX "entities_created_by_run_idx" ON "entities" ("created_by_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_search_terms_entity_normalized_uidx" ON "entity_search_terms" ("entity_id","normalized_term");--> statement-breakpoint
CREATE INDEX "entity_search_terms_entity_idx" ON "entity_search_terms" ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_search_terms_created_by_run_idx" ON "entity_search_terms" ("created_by_run_id");--> statement-breakpoint
CREATE INDEX "entity_search_terms_normalized_trgm_idx" ON "entity_search_terms" USING gin ("normalized_term" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_runs_idempotency_key_uidx" ON "ingestion_runs" ("idempotency_key");--> statement-breakpoint
CREATE INDEX "people_name_original_normalized_idx" ON "people" ("name_original_normalized");--> statement-breakpoint
CREATE INDEX "people_name_latin_normalized_idx" ON "people" ("name_latin_normalized");--> statement-breakpoint
CREATE INDEX "people_name_original_trgm_idx" ON "people" USING gin ("name_original_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "people_name_latin_trgm_idx" ON "people" USING gin ("name_latin_normalized" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_merged_into_entity_id_entities_id_fkey" FOREIGN KEY ("merged_into_entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_created_by_run_id_ingestion_runs_id_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entity_search_terms" ADD CONSTRAINT "entity_search_terms_entity_id_entities_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entity_search_terms" ADD CONSTRAINT "entity_search_terms_created_by_run_id_ingestion_runs_id_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_entity_id_entities_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE;
