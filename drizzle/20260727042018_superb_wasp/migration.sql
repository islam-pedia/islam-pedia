CREATE TABLE "person_primary_name_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"entity_id" uuid NOT NULL,
	"from_name_id" uuid NOT NULL,
	"to_name_id" uuid NOT NULL,
	"from_type" "person_name_type" NOT NULL,
	"from_name_original" text NOT NULL,
	"from_name_latin" text NOT NULL,
	"to_type" "person_name_type" NOT NULL,
	"to_name_original" text NOT NULL,
	"to_name_latin" text NOT NULL,
	"reason" text NOT NULL,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_primary_name_changes_reason_not_blank" CHECK (btrim("reason") <> ''),
	CONSTRAINT "person_primary_name_changes_names_not_blank" CHECK (
        btrim("from_name_original") <> ''
        AND btrim("from_name_latin") <> ''
        AND btrim("to_name_original") <> ''
        AND btrim("to_name_latin") <> ''
      )
);
--> statement-breakpoint
CREATE INDEX "person_primary_name_changes_entity_idx" ON "person_primary_name_changes" ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_primary_name_changes_run_uidx" ON "person_primary_name_changes" ("created_by_run_id");--> statement-breakpoint
ALTER TABLE "person_primary_name_changes" ADD CONSTRAINT "person_primary_name_changes_entity_id_people_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "people"("entity_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_primary_name_changes" ADD CONSTRAINT "person_primary_name_changes_from_name_id_person_names_id_fkey" FOREIGN KEY ("from_name_id") REFERENCES "person_names"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_primary_name_changes" ADD CONSTRAINT "person_primary_name_changes_to_name_id_person_names_id_fkey" FOREIGN KEY ("to_name_id") REFERENCES "person_names"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_primary_name_changes" ADD CONSTRAINT "person_primary_name_changes_7Z5FYFzKsJQn_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;