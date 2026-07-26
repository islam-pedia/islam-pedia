CREATE TYPE "person_gender" AS ENUM('male', 'female', 'unknown');--> statement-breakpoint
CREATE TYPE "person_relationship_type" AS ENUM('biological_parent_of', 'milk_parent_of', 'adoptive_parent_of', 'guardian_of', 'husband_of', 'teacher_of');--> statement-breakpoint
CREATE TABLE "person_gender_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"entity_id" uuid NOT NULL,
	"from_gender" "person_gender",
	"to_gender" "person_gender" NOT NULL,
	"reason" text NOT NULL,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_gender_changes_transition_check" CHECK ("from_gender" IS NULL OR "from_gender" <> "to_gender"),
	CONSTRAINT "person_gender_changes_reason_not_blank" CHECK (btrim("reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "person_relationship_evidence" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"relationship_id" uuid NOT NULL,
	"passage_id" uuid NOT NULL,
	"assertion" text NOT NULL,
	"interpretation" "evidence_interpretation" NOT NULL,
	"status" "assertion_status" NOT NULL,
	"notes" text,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_relationship_evidence_assertion_not_blank" CHECK (btrim("assertion") <> ''),
	CONSTRAINT "person_relationship_evidence_notes_not_blank" CHECK ("notes" IS NULL OR btrim("notes") <> '')
);
--> statement-breakpoint
CREATE TABLE "person_relationship_status_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"relationship_id" uuid NOT NULL,
	"from_status" "assertion_status",
	"to_status" "assertion_status" NOT NULL,
	"reason" text NOT NULL,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_relationship_status_changes_transition_check" CHECK ("from_status" IS NULL OR "from_status" <> "to_status"),
	CONSTRAINT "person_relationship_status_changes_reason_not_blank" CHECK (btrim("reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "person_relationships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"from_person_id" uuid NOT NULL,
	"to_person_id" uuid NOT NULL,
	"type" "person_relationship_type" NOT NULL,
	"status" "assertion_status" DEFAULT 'accepted'::"assertion_status" NOT NULL,
	"created_by_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_relationships_not_self" CHECK ("from_person_id" <> "to_person_id")
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "gender" "person_gender" DEFAULT 'unknown'::"person_gender" NOT NULL;--> statement-breakpoint
CREATE INDEX "person_gender_changes_entity_idx" ON "person_gender_changes" ("entity_id");--> statement-breakpoint
CREATE INDEX "person_gender_changes_created_by_run_idx" ON "person_gender_changes" ("created_by_run_id");--> statement-breakpoint
CREATE INDEX "person_relationship_evidence_relationship_idx" ON "person_relationship_evidence" ("relationship_id");--> statement-breakpoint
CREATE INDEX "person_relationship_evidence_passage_idx" ON "person_relationship_evidence" ("passage_id");--> statement-breakpoint
CREATE INDEX "person_relationship_evidence_status_idx" ON "person_relationship_evidence" ("status");--> statement-breakpoint
CREATE INDEX "person_relationship_evidence_created_by_run_idx" ON "person_relationship_evidence" ("created_by_run_id");--> statement-breakpoint
CREATE INDEX "person_relationship_status_changes_relationship_idx" ON "person_relationship_status_changes" ("relationship_id");--> statement-breakpoint
CREATE INDEX "person_relationship_status_changes_run_idx" ON "person_relationship_status_changes" ("created_by_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_relationships_unique_fact_uidx" ON "person_relationships" ("from_person_id","to_person_id","type");--> statement-breakpoint
CREATE INDEX "person_relationships_from_idx" ON "person_relationships" ("from_person_id","type");--> statement-breakpoint
CREATE INDEX "person_relationships_to_idx" ON "person_relationships" ("to_person_id","type");--> statement-breakpoint
CREATE INDEX "person_relationships_status_idx" ON "person_relationships" ("status");--> statement-breakpoint
CREATE INDEX "person_relationships_created_by_run_idx" ON "person_relationships" ("created_by_run_id");--> statement-breakpoint
ALTER TABLE "person_gender_changes" ADD CONSTRAINT "person_gender_changes_entity_id_people_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "people"("entity_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_gender_changes" ADD CONSTRAINT "person_gender_changes_created_by_run_id_ingestion_runs_id_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_relationship_evidence" ADD CONSTRAINT "person_relationship_evidence_DMvtBqt23HqH_fkey" FOREIGN KEY ("relationship_id") REFERENCES "person_relationships"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_relationship_evidence" ADD CONSTRAINT "person_relationship_evidence_passage_id_source_passages_id_fkey" FOREIGN KEY ("passage_id") REFERENCES "source_passages"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_relationship_evidence" ADD CONSTRAINT "person_relationship_evidence_mjfxnnQ9U5Gb_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_relationship_status_changes" ADD CONSTRAINT "person_relationship_status_changes_pCq6vY6xBjY8_fkey" FOREIGN KEY ("relationship_id") REFERENCES "person_relationships"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_relationship_status_changes" ADD CONSTRAINT "person_relationship_status_changes_oeCkSdBw0Vo0_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_relationships" ADD CONSTRAINT "person_relationships_from_person_id_people_entity_id_fkey" FOREIGN KEY ("from_person_id") REFERENCES "people"("entity_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_relationships" ADD CONSTRAINT "person_relationships_to_person_id_people_entity_id_fkey" FOREIGN KEY ("to_person_id") REFERENCES "people"("entity_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person_relationships" ADD CONSTRAINT "person_relationships_created_by_run_id_ingestion_runs_id_fkey" FOREIGN KEY ("created_by_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT;--> statement-breakpoint
INSERT INTO "person_gender_changes" (
	"id",
	"entity_id",
	"from_gender",
	"to_gender",
	"reason",
	"created_by_run_id",
	"created_at"
)
SELECT
	uuidv7(),
	"people"."entity_id",
	NULL,
	'unknown'::"person_gender",
	'Gender unknown before gender history was introduced.',
	"entities"."created_by_run_id",
	"entities"."created_at"
FROM "people"
INNER JOIN "entities" ON "entities"."id" = "people"."entity_id";--> statement-breakpoint
CREATE FUNCTION "validate_husband_relationship_direction"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	from_gender "person_gender";
	to_gender "person_gender";
BEGIN
	IF NEW."type" = 'husband_of'::"person_relationship_type" THEN
		SELECT "gender" INTO from_gender
		FROM "people"
		WHERE "entity_id" = NEW."from_person_id";

		SELECT "gender" INTO to_gender
		FROM "people"
		WHERE "entity_id" = NEW."to_person_id";

		IF from_gender <> 'male'::"person_gender"
			OR to_gender <> 'female'::"person_gender"
		THEN
			RAISE EXCEPTION 'husband_of requires a male from_person and female to_person'
				USING ERRCODE = '23514';
		END IF;
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "person_relationships_husband_direction_trigger"
BEFORE INSERT OR UPDATE OF "from_person_id", "to_person_id", "type"
ON "person_relationships"
FOR EACH ROW
EXECUTE FUNCTION "validate_husband_relationship_direction"();--> statement-breakpoint
CREATE FUNCTION "validate_gender_against_husband_relationships"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."gender" = OLD."gender" THEN
		RETURN NEW;
	END IF;

	IF NEW."gender" <> 'male'::"person_gender"
		AND EXISTS (
			SELECT 1
			FROM "person_relationships"
			WHERE "type" = 'husband_of'::"person_relationship_type"
				AND "from_person_id" = NEW."entity_id"
		)
	THEN
		RAISE EXCEPTION 'gender conflicts with outgoing husband_of relationship'
			USING ERRCODE = '23514';
	END IF;

	IF NEW."gender" <> 'female'::"person_gender"
		AND EXISTS (
			SELECT 1
			FROM "person_relationships"
			WHERE "type" = 'husband_of'::"person_relationship_type"
				AND "to_person_id" = NEW."entity_id"
		)
	THEN
		RAISE EXCEPTION 'gender conflicts with incoming husband_of relationship'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "people_gender_husband_relationship_trigger"
BEFORE UPDATE OF "gender"
ON "people"
FOR EACH ROW
EXECUTE FUNCTION "validate_gender_against_husband_relationships"();
