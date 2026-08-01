import { sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import {
  boolean,
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
import {
  personEncounterOutcomes,
  personReligionsAtDeath,
} from "@/domain/people/assertions"
import { personNameTypes } from "@/domain/people/names"
import {
  personGenders,
  personRelationshipTypes,
} from "@/domain/people/relationships"

const uuidV7 = sql`uuidv7()`
const emptyJson = sql`'{}'::jsonb`

export const entityKind = pgEnum("entity_kind", ["person"])

export const entityStatus = pgEnum("entity_status", [
  "provisional",
  "active",
  "merged",
])

export const personNameType = pgEnum("person_name_type", personNameTypes)

export const personGender = pgEnum("person_gender", personGenders)

export const personRelationshipType = pgEnum(
  "person_relationship_type",
  personRelationshipTypes,
)

export const personReligionAtDeath = pgEnum(
  "person_religion_at_death",
  personReligionsAtDeath,
)

export const personEncounterOutcome = pgEnum(
  "person_encounter_outcome",
  personEncounterOutcomes,
)

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
    gender: personGender("gender").default("unknown").notNull(),
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

export const personGenderChanges = pgTable(
  "person_gender_changes",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => people.entityId, { onDelete: "restrict" }),
    fromGender: personGender("from_gender"),
    toGender: personGender("to_gender").notNull(),
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
    index("person_gender_changes_entity_idx").on(table.entityId),
    index("person_gender_changes_created_by_run_idx").on(table.createdByRunId),
    check(
      "person_gender_changes_transition_check",
      sql`${table.fromGender} IS NULL OR ${table.fromGender} <> ${table.toGender}`,
    ),
    check(
      "person_gender_changes_reason_not_blank",
      sql`btrim(${table.reason}) <> ''`,
    ),
  ],
)

export const personRelationships = pgTable(
  "person_relationships",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    fromPersonId: uuid("from_person_id")
      .notNull()
      .references(() => people.entityId, { onDelete: "restrict" }),
    toPersonId: uuid("to_person_id")
      .notNull()
      .references(() => people.entityId, { onDelete: "restrict" }),
    type: personRelationshipType("type").notNull(),
    status: assertionStatus("status").default("accepted").notNull(),
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
    uniqueIndex("person_relationships_unique_fact_uidx").on(
      table.fromPersonId,
      table.toPersonId,
      table.type,
    ),
    index("person_relationships_from_idx").on(table.fromPersonId, table.type),
    index("person_relationships_to_idx").on(table.toPersonId, table.type),
    index("person_relationships_status_idx").on(table.status),
    index("person_relationships_created_by_run_idx").on(table.createdByRunId),
    check(
      "person_relationships_not_self",
      sql`${table.fromPersonId} <> ${table.toPersonId}`,
    ),
  ],
)

export const personRelationshipEvidence = pgTable(
  "person_relationship_evidence",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    relationshipId: uuid("relationship_id")
      .notNull()
      .references(() => personRelationships.id, { onDelete: "restrict" }),
    passageId: uuid("passage_id")
      .notNull()
      .references(() => sourcePassages.id, { onDelete: "restrict" }),
    assertion: text("assertion").notNull(),
    interpretation: evidenceInterpretation("interpretation").notNull(),
    status: assertionStatus("status").notNull(),
    notes: text("notes"),
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
    index("person_relationship_evidence_relationship_idx").on(
      table.relationshipId,
    ),
    index("person_relationship_evidence_passage_idx").on(table.passageId),
    index("person_relationship_evidence_status_idx").on(table.status),
    index("person_relationship_evidence_created_by_run_idx").on(
      table.createdByRunId,
    ),
    check(
      "person_relationship_evidence_assertion_not_blank",
      sql`btrim(${table.assertion}) <> ''`,
    ),
    check(
      "person_relationship_evidence_notes_not_blank",
      sql`${table.notes} IS NULL OR btrim(${table.notes}) <> ''`,
    ),
  ],
)

export const personRelationshipStatusChanges = pgTable(
  "person_relationship_status_changes",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    relationshipId: uuid("relationship_id")
      .notNull()
      .references(() => personRelationships.id, { onDelete: "restrict" }),
    fromStatus: assertionStatus("from_status"),
    toStatus: assertionStatus("to_status").notNull(),
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
    index("person_relationship_status_changes_relationship_idx").on(
      table.relationshipId,
    ),
    index("person_relationship_status_changes_run_idx").on(
      table.createdByRunId,
    ),
    check(
      "person_relationship_status_changes_transition_check",
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} <> ${table.toStatus}`,
    ),
    check(
      "person_relationship_status_changes_reason_not_blank",
      sql`btrim(${table.reason}) <> ''`,
    ),
  ],
)

export const personReligionAtDeathAssertions = pgTable(
  "person_religion_at_death_assertions",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.entityId, { onDelete: "restrict" }),
    value: personReligionAtDeath("value").notNull(),
    status: assertionStatus("status").notNull(),
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
    uniqueIndex("person_religion_at_death_unique_fact_uidx").on(
      table.personId,
      table.value,
    ),
    uniqueIndex("person_religion_at_death_one_accepted_uidx")
      .on(table.personId)
      .where(sql`${table.status} = 'accepted'`),
    index("person_religion_at_death_person_idx").on(table.personId),
    index("person_religion_at_death_status_idx").on(table.status),
    index("person_religion_at_death_created_by_run_idx").on(
      table.createdByRunId,
    ),
  ],
)

export const personReligionAtDeathEvidence = pgTable(
  "person_religion_at_death_evidence",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    assertionId: uuid("assertion_id")
      .notNull()
      .references(() => personReligionAtDeathAssertions.id, {
        onDelete: "restrict",
      }),
    passageId: uuid("passage_id")
      .notNull()
      .references(() => sourcePassages.id, { onDelete: "restrict" }),
    assertion: text("assertion").notNull(),
    interpretation: evidenceInterpretation("interpretation").notNull(),
    status: assertionStatus("status").notNull(),
    notes: text("notes"),
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
    index("person_religion_at_death_evidence_assertion_idx").on(
      table.assertionId,
    ),
    index("person_religion_at_death_evidence_passage_idx").on(table.passageId),
    index("person_religion_at_death_evidence_run_idx").on(table.createdByRunId),
    check(
      "person_religion_at_death_evidence_assertion_not_blank",
      sql`btrim(${table.assertion}) <> ''`,
    ),
    check(
      "person_religion_at_death_evidence_notes_not_blank",
      sql`${table.notes} IS NULL OR btrim(${table.notes}) <> ''`,
    ),
  ],
)

export const personReligionAtDeathStatusChanges = pgTable(
  "person_religion_at_death_status_changes",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    assertionId: uuid("assertion_id")
      .notNull()
      .references(() => personReligionAtDeathAssertions.id, {
        onDelete: "restrict",
      }),
    fromStatus: assertionStatus("from_status"),
    toStatus: assertionStatus("to_status").notNull(),
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
    index("person_religion_at_death_status_assertion_idx").on(
      table.assertionId,
    ),
    index("person_religion_at_death_status_run_idx").on(table.createdByRunId),
    check(
      "person_religion_at_death_status_transition_check",
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} <> ${table.toStatus}`,
    ),
    check(
      "person_religion_at_death_status_reason_not_blank",
      sql`btrim(${table.reason}) <> ''`,
    ),
  ],
)

export const personEncounterAssertions = pgTable(
  "person_encounter_assertions",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    firstPersonId: uuid("first_person_id")
      .notNull()
      .references(() => people.entityId, { onDelete: "restrict" }),
    secondPersonId: uuid("second_person_id")
      .notNull()
      .references(() => people.entityId, { onDelete: "restrict" }),
    outcome: personEncounterOutcome("outcome").notNull(),
    status: assertionStatus("status").notNull(),
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
    uniqueIndex("person_encounters_unique_fact_uidx").on(
      table.firstPersonId,
      table.secondPersonId,
      table.outcome,
    ),
    uniqueIndex("person_encounters_one_accepted_uidx")
      .on(table.firstPersonId, table.secondPersonId)
      .where(sql`${table.status} = 'accepted'`),
    index("person_encounters_first_person_idx").on(table.firstPersonId),
    index("person_encounters_second_person_idx").on(table.secondPersonId),
    index("person_encounters_status_idx").on(table.status),
    index("person_encounters_created_by_run_idx").on(table.createdByRunId),
    check(
      "person_encounters_canonical_pair_check",
      sql`${table.firstPersonId} < ${table.secondPersonId}`,
    ),
  ],
)

export const personEncounterEvidence = pgTable(
  "person_encounter_evidence",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    assertionId: uuid("assertion_id")
      .notNull()
      .references(() => personEncounterAssertions.id, {
        onDelete: "restrict",
      }),
    passageId: uuid("passage_id")
      .notNull()
      .references(() => sourcePassages.id, { onDelete: "restrict" }),
    assertion: text("assertion").notNull(),
    interpretation: evidenceInterpretation("interpretation").notNull(),
    status: assertionStatus("status").notNull(),
    notes: text("notes"),
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
    index("person_encounter_evidence_assertion_idx").on(table.assertionId),
    index("person_encounter_evidence_passage_idx").on(table.passageId),
    index("person_encounter_evidence_run_idx").on(table.createdByRunId),
    check(
      "person_encounter_evidence_assertion_not_blank",
      sql`btrim(${table.assertion}) <> ''`,
    ),
    check(
      "person_encounter_evidence_notes_not_blank",
      sql`${table.notes} IS NULL OR btrim(${table.notes}) <> ''`,
    ),
  ],
)

export const personEncounterStatusChanges = pgTable(
  "person_encounter_status_changes",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    assertionId: uuid("assertion_id")
      .notNull()
      .references(() => personEncounterAssertions.id, {
        onDelete: "restrict",
      }),
    fromStatus: assertionStatus("from_status"),
    toStatus: assertionStatus("to_status").notNull(),
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
    index("person_encounter_status_assertion_idx").on(table.assertionId),
    index("person_encounter_status_run_idx").on(table.createdByRunId),
    check(
      "person_encounter_status_transition_check",
      sql`${table.fromStatus} IS NULL OR ${table.fromStatus} <> ${table.toStatus}`,
    ),
    check(
      "person_encounter_status_reason_not_blank",
      sql`btrim(${table.reason}) <> ''`,
    ),
  ],
)

export const personNames = pgTable(
  "person_names",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => people.entityId, { onDelete: "cascade" }),
    type: personNameType("type").notNull(),
    nameOriginal: text("name_original").notNull(),
    nameOriginalNormalized: text("name_original_normalized").notNull(),
    nameLatin: text("name_latin").notNull(),
    nameLatinNormalized: text("name_latin_normalized").notNull(),
    isPrimary: boolean("is_primary").default(false).notNull(),
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
    uniqueIndex("person_names_entity_type_names_uidx").on(
      table.entityId,
      table.type,
      table.nameOriginalNormalized,
      table.nameLatinNormalized,
    ),
    uniqueIndex("person_names_entity_primary_uidx")
      .on(table.entityId)
      .where(sql`${table.isPrimary}`),
    index("person_names_entity_type_idx").on(table.entityId, table.type),
    index("person_names_created_by_run_idx").on(table.createdByRunId),
    index("person_names_original_trgm_idx").using(
      "gin",
      table.nameOriginalNormalized.op("gin_trgm_ops"),
    ),
    index("person_names_latin_trgm_idx").using(
      "gin",
      table.nameLatinNormalized.op("gin_trgm_ops"),
    ),
    check(
      "person_names_original_not_blank",
      sql`btrim(${table.nameOriginal}) <> ''`,
    ),
    check(
      "person_names_original_normalized_not_blank",
      sql`btrim(${table.nameOriginalNormalized}) <> ''`,
    ),
    check("person_names_latin_not_blank", sql`btrim(${table.nameLatin}) <> ''`),
    check(
      "person_names_latin_normalized_not_blank",
      sql`btrim(${table.nameLatinNormalized}) <> ''`,
    ),
    check(
      "person_names_normalization_version_positive",
      sql`${table.normalizationVersion} > 0`,
    ),
  ],
)

export const personPrimaryNameChanges = pgTable(
  "person_primary_name_changes",
  {
    id: uuid("id").default(uuidV7).primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => people.entityId, { onDelete: "restrict" }),
    fromNameId: uuid("from_name_id")
      .notNull()
      .references(() => personNames.id, { onDelete: "restrict" }),
    toNameId: uuid("to_name_id")
      .notNull()
      .references(() => personNames.id, { onDelete: "restrict" }),
    fromType: personNameType("from_type").notNull(),
    fromNameOriginal: text("from_name_original").notNull(),
    fromNameLatin: text("from_name_latin").notNull(),
    toType: personNameType("to_type").notNull(),
    toNameOriginal: text("to_name_original").notNull(),
    toNameLatin: text("to_name_latin").notNull(),
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
    index("person_primary_name_changes_entity_idx").on(table.entityId),
    uniqueIndex("person_primary_name_changes_run_uidx").on(
      table.createdByRunId,
    ),
    check(
      "person_primary_name_changes_reason_not_blank",
      sql`btrim(${table.reason}) <> ''`,
    ),
    check(
      "person_primary_name_changes_names_not_blank",
      sql`
        btrim(${table.fromNameOriginal}) <> ''
        AND btrim(${table.fromNameLatin}) <> ''
        AND btrim(${table.toNameOriginal}) <> ''
        AND btrim(${table.toNameLatin}) <> ''
      `,
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
    identityKey: text("identity_key"),
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
    uniqueIndex("sources_identity_key_uidx")
      .on(table.identityKey)
      .where(sql`${table.identityKey} IS NOT NULL`),
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
    identityKey: text("identity_key"),
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
    uniqueIndex("source_passages_source_identity_key_uidx")
      .on(table.sourceId, table.identityKey)
      .where(sql`${table.identityKey} IS NOT NULL`),
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
export type PersonName = typeof personNames.$inferSelect
export type PersonGenderChange = typeof personGenderChanges.$inferSelect
export type PersonPrimaryNameChange =
  typeof personPrimaryNameChanges.$inferSelect
export type PersonRelationship = typeof personRelationships.$inferSelect
export type PersonRelationshipEvidence =
  typeof personRelationshipEvidence.$inferSelect
export type PersonRelationshipStatusChange =
  typeof personRelationshipStatusChanges.$inferSelect
export type PersonReligionAtDeathAssertion =
  typeof personReligionAtDeathAssertions.$inferSelect
export type PersonReligionAtDeathEvidence =
  typeof personReligionAtDeathEvidence.$inferSelect
export type PersonReligionAtDeathStatusChange =
  typeof personReligionAtDeathStatusChanges.$inferSelect
export type PersonEncounterAssertion =
  typeof personEncounterAssertions.$inferSelect
export type PersonEncounterEvidence =
  typeof personEncounterEvidence.$inferSelect
export type PersonEncounterStatusChange =
  typeof personEncounterStatusChanges.$inferSelect
export type EntitySearchTerm = typeof entitySearchTerms.$inferSelect
export type Source = typeof sources.$inferSelect
export type SourcePassage = typeof sourcePassages.$inferSelect
export type EntityEvidence = typeof entityEvidence.$inferSelect
export type EntityStatusChange = typeof entityStatusChanges.$inferSelect
