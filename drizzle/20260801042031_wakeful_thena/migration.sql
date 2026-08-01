ALTER TABLE "source_passages" ADD COLUMN "identity_key" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "identity_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "source_passages_source_identity_key_uidx" ON "source_passages" ("source_id","identity_key") WHERE "identity_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sources_identity_key_uidx" ON "sources" ("identity_key") WHERE "identity_key" IS NOT NULL;