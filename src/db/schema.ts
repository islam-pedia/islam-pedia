import { sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

const uuidV7 = sql`uuidv7()`
const emptyJson = sql`'{}'::jsonb`

export const entityKind = pgEnum("entity_kind", ["person"])

export const entityStatus = pgEnum("entity_status", [
  "provisional",
  "active",
  "merged",
])

export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    instruction: text("instruction"),
    sourceLabel: text("source_label"),
    sourceUri: text("source_uri"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default(emptyJson)
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("ingestion_runs_idempotency_key_uidx").on(table.idempotencyKey),
    check(
      "ingestion_runs_idempotency_key_not_blank",
      sql`btrim(${table.idempotencyKey}) <> ''`,
    ),
  ],
)

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    kind: entityKind("kind").default("person").notNull(),
    status: entityStatus("status").default("provisional").notNull(),
    mergedIntoEntityId: uuid("merged_into_entity_id").references(
      (): AnyPgColumn => entities.id,
      { onDelete: "restrict" },
    ),
    createdByRunId: uuid("created_by_run_id")
      .notNull()
      .references(() => ingestionRuns.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("entities_kind_status_idx").on(table.kind, table.status),
    index("entities_created_by_run_idx").on(table.createdByRunId),
    check(
      "entities_merge_state_check",
      sql`(
        (${table.status} = 'merged' AND ${table.mergedIntoEntityId} IS NOT NULL)
        OR
        (${table.status} <> 'merged' AND ${table.mergedIntoEntityId} IS NULL)
      )`,
    ),
    check(
      "entities_cannot_merge_into_self",
      sql`${table.mergedIntoEntityId} IS NULL OR ${table.mergedIntoEntityId} <> ${table.id}`,
    ),
  ],
)

export const people = pgTable(
  "people",
  {
    entityId: uuid("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),
    nameOriginal: text("name_original").notNull(),
    nameOriginalNormalized: text("name_original_normalized").notNull(),
    nameLatin: text("name_latin").notNull(),
    nameLatinNormalized: text("name_latin_normalized").notNull(),
    normalizationVersion: smallint("normalization_version")
      .default(1)
      .notNull(),
  },
  (table) => [
    index("people_name_original_normalized_idx").on(
      table.nameOriginalNormalized,
    ),
    index("people_name_latin_normalized_idx").on(table.nameLatinNormalized),
    index("people_name_original_trgm_idx").using(
      "gin",
      table.nameOriginalNormalized.op("gin_trgm_ops"),
    ),
    index("people_name_latin_trgm_idx").using(
      "gin",
      table.nameLatinNormalized.op("gin_trgm_ops"),
    ),
    check(
      "people_name_original_not_blank",
      sql`btrim(${table.nameOriginal}) <> ''`,
    ),
    check(
      "people_name_original_normalized_not_blank",
      sql`btrim(${table.nameOriginalNormalized}) <> ''`,
    ),
    check("people_name_latin_not_blank", sql`btrim(${table.nameLatin}) <> ''`),
    check(
      "people_name_latin_normalized_not_blank",
      sql`btrim(${table.nameLatinNormalized}) <> ''`,
    ),
    check(
      "people_normalization_version_positive",
      sql`${table.normalizationVersion} > 0`,
    ),
  ],
)

export const entitySearchTerms = pgTable(
  "entity_search_terms",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    normalizedTerm: text("normalized_term").notNull(),
    weight: smallint("weight").default(50).notNull(),
    normalizationVersion: smallint("normalization_version")
      .default(1)
      .notNull(),
    createdByRunId: uuid("created_by_run_id")
      .notNull()
      .references(() => ingestionRuns.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("entity_search_terms_entity_normalized_uidx").on(
      table.entityId,
      table.normalizedTerm,
    ),
    index("entity_search_terms_entity_idx").on(table.entityId),
    index("entity_search_terms_created_by_run_idx").on(table.createdByRunId),
    index("entity_search_terms_normalized_trgm_idx").using(
      "gin",
      table.normalizedTerm.op("gin_trgm_ops"),
    ),
    check(
      "entity_search_terms_term_not_blank",
      sql`btrim(${table.term}) <> ''`,
    ),
    check(
      "entity_search_terms_normalized_not_blank",
      sql`btrim(${table.normalizedTerm}) <> ''`,
    ),
    check(
      "entity_search_terms_weight_range",
      sql`${table.weight} BETWEEN 1 AND 100`,
    ),
    check(
      "entity_search_terms_normalization_version_positive",
      sql`${table.normalizationVersion} > 0`,
    ),
  ],
)

export type Entity = typeof entities.$inferSelect
export type Person = typeof people.$inferSelect
export type EntitySearchTerm = typeof entitySearchTerms.$inferSelect
