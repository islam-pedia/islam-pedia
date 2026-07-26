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
import {
  type SourceVerification,
  sourceCategories,
  sourceMethodologies,
} from "@/domain/evidence/source-policy"

const uuidV7 = sql`uuidv7()`
const emptyJson = sql`'{}'::jsonb`

export const entityKind = pgEnum("entity_kind", ["person"])

export const entityStatus = pgEnum("entity_status", [
  "provisional",
  "active",
  "merged",
])

export const evidenceInterpretation = pgEnum("evidence_interpretation", [
  "explicit",
  "inferred",
])

export const assertionStatus = pgEnum("assertion_status", [
  "accepted",
  "uncertain",
  "disputed",
  "retracted",
])

export const sourceCategory = pgEnum("source_category", sourceCategories)

export const sourceMethodology = pgEnum(
  "source_methodology",
  sourceMethodologies,
)

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

export interface SourceLocator {
  volume?: string
  page?: string
  chapter?: string
  verse?: string
  hadithNumber?: string
  section?: string
  url?: string
}

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    category: sourceCategory("category").notNull(),
    label: text("label").notNull(),
    uri: text("uri"),
    author: text("author"),
    workTitle: text("work_title"),
    edition: text("edition"),
    methodology: sourceMethodology("methodology")
      .default("salafiyyun")
      .notNull(),
    methodologyBasis: text("methodology_basis").notNull(),
    policyVersion: text("policy_version").default("salafiyyun-v1").notNull(),
    verification: jsonb("verification")
      .$type<SourceVerification>()
      .default(emptyJson)
      .notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default(emptyJson)
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
    index("sources_created_by_run_idx").on(table.createdByRunId),
    index("sources_category_methodology_idx").on(
      table.category,
      table.methodology,
    ),
    index("sources_label_idx").on(table.label),
    check("sources_label_not_blank", sql`btrim(${table.label}) <> ''`),
    check(
      "sources_uri_not_blank",
      sql`${table.uri} IS NULL OR btrim(${table.uri}) <> ''`,
    ),
    check(
      "sources_author_not_blank",
      sql`${table.author} IS NULL OR btrim(${table.author}) <> ''`,
    ),
    check(
      "sources_work_title_not_blank",
      sql`${table.workTitle} IS NULL OR btrim(${table.workTitle}) <> ''`,
    ),
    check(
      "sources_edition_not_blank",
      sql`${table.edition} IS NULL OR btrim(${table.edition}) <> ''`,
    ),
    check(
      "sources_methodology_basis_not_blank",
      sql`btrim(${table.methodologyBasis}) <> ''`,
    ),
    check(
      "sources_policy_version_not_blank",
      sql`btrim(${table.policyVersion}) <> ''`,
    ),
    check(
      "sources_context_methodology_check",
      sql`(
        (${table.category} = 'context_only' AND ${table.methodology} = 'context_only')
        OR
        (${table.category} <> 'context_only' AND ${table.methodology} = 'salafiyyun')
      )`,
    ),
  ],
)

export const sourcePassages = pgTable(
  "source_passages",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    passage: text("passage").notNull(),
    language: text("language"),
    locator: jsonb("locator")
      .$type<SourceLocator>()
      .default(emptyJson)
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
    index("source_passages_source_idx").on(table.sourceId),
    index("source_passages_created_by_run_idx").on(table.createdByRunId),
    check(
      "source_passages_passage_not_blank",
      sql`btrim(${table.passage}) <> ''`,
    ),
    check(
      "source_passages_language_not_blank",
      sql`${table.language} IS NULL OR btrim(${table.language}) <> ''`,
    ),
  ],
)

export const entityEvidence = pgTable(
  "entity_evidence",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    passageId: uuid("passage_id")
      .notNull()
      .references(() => sourcePassages.id, { onDelete: "restrict" }),
    assertion: text("assertion").notNull(),
    interpretation: evidenceInterpretation("interpretation").notNull(),
    status: assertionStatus("status").default("accepted").notNull(),
    notes: text("notes"),
    qualifiers: jsonb("qualifiers")
      .$type<Record<string, unknown>>()
      .default(emptyJson)
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
    index("entity_evidence_entity_idx").on(table.entityId),
    index("entity_evidence_passage_idx").on(table.passageId),
    index("entity_evidence_status_idx").on(table.status),
    index("entity_evidence_created_by_run_idx").on(table.createdByRunId),
    check(
      "entity_evidence_assertion_not_blank",
      sql`btrim(${table.assertion}) <> ''`,
    ),
    check(
      "entity_evidence_notes_not_blank",
      sql`${table.notes} IS NULL OR btrim(${table.notes}) <> ''`,
    ),
  ],
)

export const entityStatusChanges = pgTable(
  "entity_status_changes",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    fromStatus: entityStatus("from_status"),
    toStatus: entityStatus("to_status").notNull(),
    reason: text("reason").notNull(),
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
    index("entity_status_changes_entity_idx").on(table.entityId),
    index("entity_status_changes_created_by_run_idx").on(table.createdByRunId),
    check(
      "entity_status_changes_transition_check",
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} <> ${table.toStatus}`,
    ),
    check(
      "entity_status_changes_reason_not_blank",
      sql`btrim(${table.reason}) <> ''`,
    ),
  ],
)

export type Entity = typeof entities.$inferSelect
export type Person = typeof people.$inferSelect
export type EntitySearchTerm = typeof entitySearchTerms.$inferSelect
export type Source = typeof sources.$inferSelect
export type SourcePassage = typeof sourcePassages.$inferSelect
export type EntityEvidence = typeof entityEvidence.$inferSelect
export type EntityStatusChange = typeof entityStatusChanges.$inferSelect
