CREATE TYPE "person_encounter_outcome" AS ENUM('met', 'did_not_meet');--> statement-breakpoint
CREATE TYPE "person_religion_at_death" AS ENUM('muslim', 'non_muslim');--> statement-breakpoint
CREATE TABLE "person_encounter_assertions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"first_person_id" uuid NOT NULL,
	"second_person_id" uuid NOT NULL,
	"outcome" "person_encounter_outcome" NOT NULL,
	"status" "assertion_status" NOT NULL,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_encounters_canonical_pair_check" CHECK ("first_person_id" < "second_person_id")
);
--> statement-breakpoint
CREATE TABLE "person_encounter_evidence" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"assertion_id" uuid NOT NULL,
	"passage_id" uuid NOT NULL,
	"assertion" text NOT NULL,
	"interpretation" "evidence_interpretation" NOT NULL,
	"status" "assertion_status" NOT NULL,
	"notes" text,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_encounter_evidence_assertion_not_blank" CHECK (btrim("assertion") <> ''),
	CONSTRAINT "person_encounter_evidence_notes_not_blank" CHECK ("notes" IS NULL OR btrim("notes") <> '')
);
--> statement-breakpoint
CREATE TABLE "person_encounter_status_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"assertion_id" uuid NOT NULL,
	"from_status" "assertion_status",
	"to_status" "assertion_status" NOT NULL,
	"reason" text NOT NULL,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_encounter_status_transition_check" CHECK ("from_status" IS NULL OR "from_status" <> "to_status"),
	CONSTRAINT "person_encounter_status_reason_not_blank" CHECK (btrim("reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "person_religion_at_death_assertions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"person_id" uuid NOT NULL,
	"value" "person_religion_at_death" NOT NULL,
	"status" "assertion_status" NOT NULL,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_religion_at_death_evidence" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"assertion_id" uuid NOT NULL,
	"passage_id" uuid NOT NULL,
	"assertion" text NOT NULL,
	"interpretation" "evidence_interpretation" NOT NULL,
	"status" "assertion_status" NOT NULL,
	"notes" text,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_religion_at_death_evidence_assertion_not_blank" CHECK (btrim("assertion") <> ''),
	CONSTRAINT "person_religion_at_death_evidence_notes_not_blank" CHECK ("notes" IS NULL OR btrim("notes") <> '')
);
--> statement-breakpoint
CREATE TABLE "person_religion_at_death_status_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"assertion_id" uuid NOT NULL,
	"from_status" "assertion_status",
	"to_status" "assertion_status" NOT NULL,
	"reason" text NOT NULL,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_religion_at_death_status_transition_check" CHECK ("from_status" IS NULL OR "from_status" <> "to_status"),
	CONSTRAINT "person_religion_at_death_status_reason_not_blank" CHECK (btrim("reason") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "person_encounters_unique_fact_uidx" ON "person_encounter_assertions" ("first_person_id","second_person_id","outcome");--> statement-breakpoint
CREATE UNIQUE INDEX "person_encounters_one_accepted_uidx" ON "person_encounter_assertions" ("first_person_id","second_person_id") WHERE "status" = 'accepted';--> statement-breakpoint
CREATE INDEX "person_encounters_first_person_idx" ON "person_encounter_assertions" ("first_person_id");--> statement-breakpoint
CREATE INDEX "person_encounters_second_person_idx" ON "person_encounter_assertions" ("second_person_id");--> statement-breakpoint
CREATE INDEX "person_encounters_status_idx" ON "person_encounter_assertions" ("status");--> statement-breakpoint
CREATE INDEX "person_encounters_created_by_run_idx" ON "person_encounter_assertions" ("created_by_run_id");--> statement-breakpoint
CREATE INDEX "person_encounter_evidence_assertion_idx" ON "person_encounter_evidence" ("assertion_id");--> statement-breakpoint
CREATE INDEX "person_encounter_evidence_passage_idx" ON "person_encounter_evidence" ("passage_id");--> statement-breakpoint
CREATE INDEX "person_encounter_evidence_run_idx" ON "person_encounter_evidence" ("created_by_run_id");--> statement-breakpoint
CREATE INDEX "person_encounter_status_assertion_idx" ON "person_encounter_status_changes" ("assertion_id");--> statement-breakpoint
CREATE INDEX "person_encounter_status_run_idx" ON "person_encounter_status_changes" ("created_by_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_religion_at_death_unique_fact_uidx" ON "person_religion_at_death_assertions" ("person_id","value");--> statement-breakpoint
CREATE UNIQUE INDEX "person_religion_at_death_one_accepted_uidx" ON "person_religion_at_death_assertions" ("person_id") WHERE "status" = 'accepted';--> statement-breakpoint
CREATE INDEX "person_religion_at_death_person_idx" ON "person_religion_at_death_assertions" ("person_id");--> statement-breakpoint
CREATE INDEX "person_religion_at_death_status_idx" ON "person_religion_at_death_assertions" ("status");--> statement-breakpoint
CREATE INDEX "person_religion_at_death_created_by_run_idx" ON "person_religion_at_death_assertions" ("created_by_run_id");--> statement-breakpoint
CREATE INDEX "person_religion_at_death_evidence_assertion_idx" ON "person_religion_at_death_evidence" ("assertion_id");--> statement-breakpoint
CREATE INDEX "person_religion_at_death_evidence_passage_idx" ON "person_religion_at_death_evidence" ("passage_id");--> statement-breakpoint
CREATE INDEX "person_religion_at_death_evidence_run_idx" ON "person_religion_at_death_evidence" ("created_by_run_id");--> statement-breakpoint
CREATE INDEX "person_religion_at_death_status_assertion_idx" ON "person_religion_at_death_status_changes" ("assertion_id");--> statement-breakpoint
CREATE INDEX "person_religion_at_death_status_run_idx" ON "person_religion_at_death_status_changes" ("created_by_run_id");--> statement-breakpoint
ALTER TABLE "person_encounter_assertions" ADD CONSTRAINT "person_encounter_assertions_hecRgxTwia0W_fkey" FOREIGN KEY ("first_person_id") REFERENCES "people"("entity_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_encounter_assertions" ADD CONSTRAINT "person_encounter_assertions_olDn9vdKHRnM_fkey" FOREIGN KEY ("second_person_id") REFERENCES "people"("entity_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_encounter_assertions" ADD CONSTRAINT "person_encounter_assertions_0pOYJAnKArnu_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_encounter_evidence" ADD CONSTRAINT "person_encounter_evidence_bcKQRyMQVShM_fkey" FOREIGN KEY ("assertion_id") REFERENCES "person_encounter_assertions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_encounter_evidence" ADD CONSTRAINT "person_encounter_evidence_passage_id_source_passages_id_fkey" FOREIGN KEY ("passage_id") REFERENCES "source_passages"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_encounter_evidence" ADD CONSTRAINT "person_encounter_evidence_CTPQbvnqLF0k_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_encounter_status_changes" ADD CONSTRAINT "person_encounter_status_changes_UROjuIn6uUXN_fkey" FOREIGN KEY ("assertion_id") REFERENCES "person_encounter_assertions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_encounter_status_changes" ADD CONSTRAINT "person_encounter_status_changes_fZ7mHmTXQmXb_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_religion_at_death_assertions" ADD CONSTRAINT "person_religion_at_death_assertions_1nIJwzoTisrE_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("entity_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_religion_at_death_assertions" ADD CONSTRAINT "person_religion_at_death_assertions_gsxj78XYo2xF_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_religion_at_death_evidence" ADD CONSTRAINT "person_religion_at_death_evidence_AnjVeQiM06Vi_fkey" FOREIGN KEY ("assertion_id") REFERENCES "person_religion_at_death_assertions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_religion_at_death_evidence" ADD CONSTRAINT "person_religion_at_death_evidence_rnC3GiPh2P9H_fkey" FOREIGN KEY ("passage_id") REFERENCES "source_passages"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_religion_at_death_evidence" ADD CONSTRAINT "person_religion_at_death_evidence_gktk6QoNlAn9_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_religion_at_death_status_changes" ADD CONSTRAINT "person_religion_at_death_status_changes_j5DNlRXXknff_fkey" FOREIGN KEY ("assertion_id") REFERENCES "person_religion_at_death_assertions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_religion_at_death_status_changes" ADD CONSTRAINT "person_religion_at_death_status_changes_58BngxBFZkmA_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;