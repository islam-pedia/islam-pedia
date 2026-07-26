CREATE TYPE "source_category" AS ENUM('quran', 'hadith', 'salaf_report', 'salafiyyun_scholar', 'context_only');--> statement-breakpoint
CREATE TYPE "source_methodology" AS ENUM('salafiyyun', 'context_only');--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "category" "source_category";--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "methodology" "source_methodology" DEFAULT 'salafiyyun'::"source_methodology" NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "methodology_basis" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "policy_version" text DEFAULT 'salafiyyun-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "verification" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE "sources"
SET
	"category" = CASE
		WHEN lower(btrim("label")) IN ('al-quran', 'al qur''an', 'al-qur''an', 'quran', 'qur''an')
			OR "uri" LIKE 'https://quran.com/%'
		THEN 'quran'::"source_category"
		ELSE 'context_only'::"source_category"
	END,
	"methodology" = CASE
		WHEN lower(btrim("label")) IN ('al-quran', 'al qur''an', 'al-qur''an', 'quran', 'qur''an')
			OR "uri" LIKE 'https://quran.com/%'
		THEN 'salafiyyun'::"source_methodology"
		ELSE 'context_only'::"source_methodology"
	END,
	"methodology_basis" = CASE
		WHEN lower(btrim("label")) IN ('al-quran', 'al qur''an', 'al-qur''an', 'quran', 'qur''an')
			OR "uri" LIKE 'https://quran.com/%'
		THEN 'Primary revelation; interpretation and conclusions must follow the tafsir of the Salaf.'
		ELSE 'Legacy source retained as context only pending review under source policy salafiyyun-v1.'
	END;--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "category" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "methodology_basis" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "sources_category_methodology_idx" ON "sources" ("category","methodology");--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_methodology_basis_not_blank" CHECK (btrim("methodology_basis") <> '');--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_policy_version_not_blank" CHECK (btrim("policy_version") <> '');--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_context_methodology_check" CHECK ((
        ("category" = 'context_only' AND "methodology" = 'context_only')
        OR
        ("category" <> 'context_only' AND "methodology" = 'salafiyyun')
      ));
