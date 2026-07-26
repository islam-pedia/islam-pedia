CREATE TYPE "assertion_status" AS ENUM('accepted', 'uncertain', 'disputed', 'retracted');--> statement-breakpoint
CREATE TYPE "evidence_interpretation" AS ENUM('explicit', 'inferred');--> statement-breakpoint
CREATE TABLE "entity_evidence" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"entity_id" uuid NOT NULL,
	"passage_id" uuid NOT NULL,
	"assertion" text NOT NULL,
	"interpretation" "evidence_interpretation" NOT NULL,
	"status" "assertion_status" DEFAULT 'accepted'::"assertion_status" NOT NULL,
	"notes" text,
	"qualifiers" jsonb DEFAULT '{}' NOT NULL,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_evidence_assertion_not_blank" CHECK (btrim("assertion") <> ''),
	CONSTRAINT "entity_evidence_notes_not_blank" CHECK ("notes" IS NULL OR btrim("notes") <> '')
);
--> statement-breakpoint
CREATE TABLE "entity_status_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"entity_id" uuid NOT NULL,
	"from_status" "entity_status",
	"to_status" "entity_status" NOT NULL,
	"reason" text NOT NULL,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_status_changes_transition_check" CHECK ("from_status" IS NULL OR "from_status" <> "to_status"),
	CONSTRAINT "entity_status_changes_reason_not_blank" CHECK (btrim("reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "source_passages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"source_id" uuid NOT NULL,
	"passage" text NOT NULL,
	"language" text,
	"locator" jsonb DEFAULT '{}' NOT NULL,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_passages_passage_not_blank" CHECK (btrim("passage") <> ''),
	CONSTRAINT "source_passages_language_not_blank" CHECK ("language" IS NULL OR btrim("language") <> '')
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"label" text NOT NULL,
	"uri" text,
	"author" text,
	"work_title" text,
	"edition" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_label_not_blank" CHECK (btrim("label") <> ''),
	CONSTRAINT "sources_uri_not_blank" CHECK ("uri" IS NULL OR btrim("uri") <> ''),
	CONSTRAINT "sources_author_not_blank" CHECK ("author" IS NULL OR btrim("author") <> ''),
	CONSTRAINT "sources_work_title_not_blank" CHECK ("work_title" IS NULL OR btrim("work_title") <> ''),
	CONSTRAINT "sources_edition_not_blank" CHECK ("edition" IS NULL OR btrim("edition") <> '')
);
--> statement-breakpoint
CREATE INDEX "entity_evidence_entity_idx" ON "entity_evidence" ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_evidence_passage_idx" ON "entity_evidence" ("passage_id");--> statement-breakpoint
CREATE INDEX "entity_evidence_status_idx" ON "entity_evidence" ("status");--> statement-breakpoint
CREATE INDEX "entity_evidence_created_by_run_idx" ON "entity_evidence" ("created_by_run_id");--> statement-breakpoint
CREATE INDEX "entity_status_changes_entity_idx" ON "entity_status_changes" ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_status_changes_created_by_run_idx" ON "entity_status_changes" ("created_by_run_id");--> statement-breakpoint
CREATE INDEX "source_passages_source_idx" ON "source_passages" ("source_id");--> statement-breakpoint
CREATE INDEX "source_passages_created_by_run_idx" ON "source_passages" ("created_by_run_id");--> statement-breakpoint
CREATE INDEX "sources_created_by_run_idx" ON "sources" ("created_by_run_id");--> statement-breakpoint
CREATE INDEX "sources_label_idx" ON "sources" ("label");--> statement-breakpoint
ALTER TABLE "entity_evidence" ADD CONSTRAINT "entity_evidence_entity_id_entities_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entity_evidence" ADD CONSTRAINT "entity_evidence_passage_id_source_passages_id_fkey" FOREIGN KEY ("passage_id") REFERENCES "source_passages"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entity_evidence" ADD CONSTRAINT "entity_evidence_created_by_run_id_ingestion_runs_id_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entity_status_changes" ADD CONSTRAINT "entity_status_changes_entity_id_entities_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entity_status_changes" ADD CONSTRAINT "entity_status_changes_created_by_run_id_ingestion_runs_id_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "source_passages" ADD CONSTRAINT "source_passages_source_id_sources_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "source_passages" ADD CONSTRAINT "source_passages_created_by_run_id_ingestion_runs_id_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_created_by_run_id_ingestion_runs_id_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
INSERT INTO "entity_status_changes" (
	"entity_id",
	"from_status",
	"to_status",
	"reason",
	"created_by_run_id",
	"created_at"
)
SELECT
	"id",
	NULL,
	"status",
	'Entity status before status history was introduced.',
	"created_by_run_id",
	"created_at"
FROM "entities";
