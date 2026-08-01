import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import {
  activatePerson,
  addPersonKeywords,
  addPersonNames,
  addPersonRelationship,
  assertPersonEncounter,
  assertPersonEncountersBatch,
  assertPersonReligionAtDeath,
  assertPersonReligionsAtDeathBatch,
  auditFamilyBranch,
  auditFamilyFacts,
  auditSpouseCoverage,
  getFamilyTree,
  getPerson,
  getPersonEncounters,
  getPersonEvidence,
  getPersonFactsBatch,
  getPersonRelationships,
  getPersonReligionAtDeath,
  IdempotencyConflictError,
  importFamilyBranch,
  importPeople,
  mergePeople,
  PeopleInputError,
  searchPeople,
  searchPeopleBatch,
  setPersonGender,
  setPersonPrimaryName,
} from "@/application/people"
import { hadithGrades, sourceCategories } from "@/domain/evidence/source-policy"
import {
  personEncounterOutcomes,
  personReligionsAtDeath,
} from "@/domain/people/assertions"
import { personNameTypes, primaryPersonNameTypes } from "@/domain/people/names"
import {
  personGenders,
  personRelationshipTypes,
} from "@/domain/people/relationships"

const sourceInputSchema = z.object({
  label: z.string().trim().min(1).max(500).optional(),
  uri: z.string().trim().min(1).max(2_000).optional(),
})

const personNameTypeSchema = z.enum(personNameTypes)
const primaryPersonNameTypeSchema = z.enum(primaryPersonNameTypes)
const personGenderSchema = z.enum(personGenders)
const personRelationshipTypeSchema = z.enum(personRelationshipTypes)
const personReligionAtDeathSchema = z.enum(personReligionsAtDeath)
const personEncounterOutcomeSchema = z.enum(personEncounterOutcomes)
const assertionStatusSchema = z.enum([
  "accepted",
  "uncertain",
  "disputed",
  "retracted",
])
const spouseCoverageStatusSchema = z.enum([
  "accepted",
  "uncertain",
  "disputed",
  "retracted",
  "missing",
])

const personNameInputSchema = z.object({
  type: personNameTypeSchema,
  nameOriginal: z.string().trim().min(1).max(500),
  nameLatin: z.string().trim().min(1).max(500),
})

const primaryPersonNameInputSchema = personNameInputSchema.extend({
  type: primaryPersonNameTypeSchema,
})

const personNameOutputSchema = personNameInputSchema.extend({
  id: z.uuid(),
  isPrimary: z.boolean(),
})

const evidenceLocatorSchema = z.object({
  volume: z.string().trim().min(1).max(100).optional(),
  page: z.string().trim().min(1).max(100).optional(),
  chapter: z.string().trim().min(1).max(500).optional(),
  verse: z.string().trim().min(1).max(100).optional(),
  hadithNumber: z.string().trim().min(1).max(100).optional(),
  section: z.string().trim().min(1).max(500).optional(),
  url: z.string().trim().min(1).max(2_000).optional(),
})

const evidenceSourceSchema = z.object({
  category: z.enum(sourceCategories),
  label: z.string().trim().min(1).max(500),
  uri: z.string().trim().min(1).max(2_000).optional(),
  author: z.string().trim().min(1).max(500).optional(),
  workTitle: z.string().trim().min(1).max(500).optional(),
  edition: z.string().trim().min(1).max(500).optional(),
  methodologyBasis: z.string().trim().min(1).max(5_000),
  verification: z
    .object({
      hadithGrade: z.enum(hadithGrades).optional(),
      gradedBy: z.string().trim().min(1).max(500).optional(),
      notes: z.string().trim().min(1).max(5_000).optional(),
    })
    .optional(),
})

const evidenceInputSchema = z.object({
  source: evidenceSourceSchema,
  passage: z.string().trim().min(1).max(20_000),
  language: z.string().trim().min(1).max(100).optional(),
  locator: evidenceLocatorSchema.optional(),
  assertion: z.string().trim().min(1).max(5_000),
  interpretation: z.enum(["explicit", "inferred"]),
  notes: z.string().trim().min(1).max(5_000).optional(),
})

const religionAtDeathAssertionInputSchema = z.object({
  operationKey: z.string().trim().min(1).max(300),
  personId: z.uuid(),
  value: personReligionAtDeathSchema,
  status: assertionStatusSchema.default("accepted"),
  reason: z.string().trim().min(1).max(5_000),
  instruction: z.string().trim().min(1).max(5_000).optional(),
  evidence: z.array(evidenceInputSchema).min(1).max(20),
})

const encounterAssertionInputSchema = z.object({
  operationKey: z.string().trim().min(1).max(300),
  firstPersonId: z.uuid(),
  secondPersonId: z.uuid(),
  outcome: personEncounterOutcomeSchema,
  status: assertionStatusSchema.default("accepted"),
  reason: z.string().trim().min(1).max(5_000),
  instruction: z.string().trim().min(1).max(5_000).optional(),
  evidence: z.array(evidenceInputSchema).min(1).max(20),
})

const personOutputSchema = z.object({
  entityId: z.uuid(),
  status: z.enum(["provisional", "active", "merged"]),
  mergedIntoEntityId: z.uuid().nullable(),
  nameOriginal: z.string(),
  nameLatin: z.string(),
  gender: personGenderSchema,
  names: z.array(personNameOutputSchema),
  keywords: z.array(z.string()),
  createdAt: z.string(),
})

const importedPersonOutputSchema = personOutputSchema.extend({
  duplicateCandidateIds: z.array(z.uuid()),
})

const searchPersonOutputSchema = personOutputSchema.extend({
  score: z.number(),
})

const personInputSchema = z.object({
  nameOriginal: z.string().trim().min(1).max(500),
  nameLatin: z.string().trim().min(1).max(500),
  gender: personGenderSchema.default("unknown"),
  nameType: primaryPersonNameTypeSchema.default("personal"),
  names: z.array(personNameInputSchema).max(100).default([]),
  keywords: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
})

const familyBranchSourceMemberSchema = z.object({
  nameOriginal: z.string().trim().min(1).max(500),
  nameLatin: z.string().trim().min(1).max(500),
  names: z.array(personNameInputSchema).max(100).default([]),
})

const activatePersonOutputSchema = z.object({
  runId: z.uuid(),
  replayed: z.boolean(),
  entityId: z.uuid(),
  status: z.literal("active"),
  evidenceIds: z.array(z.uuid()),
  statusChangeId: z.uuid(),
})

const personEvidenceOutputSchema = z.object({
  entityId: z.uuid(),
  evidence: z.array(
    z.object({
      evidenceId: z.uuid(),
      assertion: z.string(),
      interpretation: z.enum(["explicit", "inferred"]),
      status: z.enum(["accepted", "uncertain", "disputed", "retracted"]),
      notes: z.string().nullable(),
      source: z.object({
        sourceId: z.uuid(),
        category: z.enum(sourceCategories),
        label: z.string(),
        uri: z.string().nullable(),
        author: z.string().nullable(),
        workTitle: z.string().nullable(),
        edition: z.string().nullable(),
        methodology: z.enum(["salafiyyun", "context_only"]),
        methodologyBasis: z.string(),
        policyVersion: z.string(),
        verification: z.object({
          hadithGrade: z.enum(hadithGrades).optional(),
          gradedBy: z.string().optional(),
          notes: z.string().optional(),
        }),
      }),
      passage: z.object({
        passageId: z.uuid(),
        text: z.string(),
        language: z.string().nullable(),
        locator: evidenceLocatorSchema,
      }),
      createdAt: z.string(),
    }),
  ),
  statusHistory: z.array(
    z.object({
      statusChangeId: z.uuid(),
      fromStatus: z.enum(["provisional", "active", "merged"]).nullable(),
      toStatus: z.enum(["provisional", "active", "merged"]),
      reason: z.string(),
      runId: z.uuid(),
      createdAt: z.string(),
    }),
  ),
})

const relatedPersonOutputSchema = z.object({
  entityId: z.uuid(),
  gender: personGenderSchema,
  nameOriginal: z.string(),
  nameLatin: z.string(),
})

const relationshipEvidenceOutputSchema = z.object({
  evidenceId: z.uuid(),
  assertion: z.string(),
  interpretation: z.enum(["explicit", "inferred"]),
  status: assertionStatusSchema,
  notes: z.string().nullable(),
  source: z.object({
    sourceId: z.uuid(),
    category: z.enum(sourceCategories),
    label: z.string(),
    uri: z.string().nullable(),
    author: z.string().nullable(),
    workTitle: z.string().nullable(),
    edition: z.string().nullable(),
    methodology: z.enum(["salafiyyun", "context_only"]),
    methodologyBasis: z.string(),
    policyVersion: z.string(),
    verification: z.object({
      hadithGrade: z.enum(hadithGrades).optional(),
      gradedBy: z.string().optional(),
      notes: z.string().optional(),
    }),
  }),
  passage: z.object({
    passageId: z.uuid(),
    text: z.string(),
    language: z.string().nullable(),
    locator: evidenceLocatorSchema,
  }),
  createdAt: z.string(),
})

const assertionStatusChangeOutputSchema = z.object({
  statusChangeId: z.uuid(),
  fromStatus: assertionStatusSchema.nullable(),
  toStatus: assertionStatusSchema,
  reason: z.string(),
  runId: z.uuid(),
  createdAt: z.string(),
})

const religionAtDeathAssertionOutputSchema = z.object({
  assertionId: z.uuid(),
  value: personReligionAtDeathSchema,
  status: assertionStatusSchema,
  evidence: z.array(relationshipEvidenceOutputSchema),
  statusHistory: z.array(assertionStatusChangeOutputSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const personEncounterAssertionOutputSchema = z.object({
  assertionId: z.uuid(),
  outcome: personEncounterOutcomeSchema,
  status: assertionStatusSchema,
  firstPerson: relatedPersonOutputSchema,
  secondPerson: relatedPersonOutputSchema,
  evidence: z.array(relationshipEvidenceOutputSchema),
  statusHistory: z.array(assertionStatusChangeOutputSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const religionAtDeathOutputSchema = z.object({
  personId: z.uuid(),
  conclusion: z.union([personReligionAtDeathSchema, z.literal("unknown")]),
  assertions: z.array(religionAtDeathAssertionOutputSchema),
})

const encounterResultOutputSchema = z.object({
  runId: z.uuid(),
  replayed: z.boolean(),
  assertionId: z.uuid(),
  created: z.boolean(),
  firstPersonId: z.uuid(),
  secondPersonId: z.uuid(),
  outcome: personEncounterOutcomeSchema,
  status: assertionStatusSchema,
  evidenceIds: z.array(z.uuid()),
  statusChangeId: z.uuid().nullable(),
})

const religionAtDeathResultOutputSchema = z.object({
  runId: z.uuid(),
  replayed: z.boolean(),
  assertionId: z.uuid(),
  created: z.boolean(),
  value: personReligionAtDeathSchema,
  status: assertionStatusSchema,
  evidenceIds: z.array(z.uuid()),
  statusChangeId: z.uuid().nullable(),
})

const batchAssertionFailureOutputSchema = z.object({
  index: z.number().int().nonnegative(),
  operationKey: z.string(),
  status: z.literal("failed"),
  error: z.string(),
})

const familySideSchema = z.enum(["paternal", "maternal", "unknown"])
const extendedFamilyRoleSchema = z.enum([
  "paternal_uncle",
  "paternal_aunt",
  "paternal_parent_sibling",
  "maternal_uncle",
  "maternal_aunt",
  "maternal_parent_sibling",
  "unknown_side_uncle",
  "unknown_side_aunt",
  "unknown_side_parent_sibling",
  "paternal_cousin",
  "maternal_cousin",
  "unknown_side_cousin",
])

const personRelationshipOutputSchema = z.object({
  relationshipId: z.uuid(),
  type: personRelationshipTypeSchema,
  status: assertionStatusSchema,
  direction: z.enum(["outgoing", "incoming"]),
  label: z.string(),
  fromPerson: relatedPersonOutputSchema,
  toPerson: relatedPersonOutputSchema,
  relatedPerson: relatedPersonOutputSchema,
  evidence: z.array(relationshipEvidenceOutputSchema),
  statusHistory: z.array(
    z.object({
      statusChangeId: z.uuid(),
      fromStatus: assertionStatusSchema.nullable(),
      toStatus: assertionStatusSchema,
      reason: z.string(),
      runId: z.uuid(),
      createdAt: z.string(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const spouseCoveragePairOutputSchema = z.object({
  coverage: spouseCoverageStatusSchema,
  maleParent: relatedPersonOutputSchema,
  femaleParent: relatedPersonOutputSchema,
  spouseRelationship: personRelationshipOutputSchema.nullable(),
  sharedChildren: z.array(
    z.object({
      child: relatedPersonOutputSchema,
      maleParentRelationship: personRelationshipOutputSchema,
      femaleParentRelationship: personRelationshipOutputSchema,
    }),
  ),
})

const addPersonRelationshipOutputSchema = z.object({
  runId: z.uuid(),
  replayed: z.boolean(),
  relationshipId: z.uuid(),
  created: z.boolean(),
  status: assertionStatusSchema,
  evidenceIds: z.array(z.uuid()),
  statusChangeId: z.uuid().nullable(),
})

const mergePeopleOutputSchema = z.object({
  runId: z.uuid(),
  replayed: z.boolean(),
  duplicatePersonId: z.uuid(),
  canonicalPersonId: z.uuid(),
  duplicateStatusBefore: z.enum(["provisional", "active"]),
  canonicalStatusBefore: z.enum(["provisional", "active"]),
  canonicalStatusAfter: z.enum(["provisional", "active"]),
  canonicalGenderBefore: personGenderSchema,
  canonicalGenderAfter: personGenderSchema,
  duplicateStatusChangeId: z.uuid(),
  canonicalStatusChangeId: z.uuid().nullable(),
  canonicalGenderChangeId: z.uuid().nullable(),
  mergeEvidenceIds: z.array(z.uuid()),
  transferred: z.object({
    names: z.number().int().nonnegative(),
    keywords: z.number().int().nonnegative(),
    entityEvidence: z.number().int().nonnegative(),
    genderChanges: z.number().int().nonnegative(),
    primaryNameChanges: z.number().int().nonnegative(),
    relationships: z.number().int().nonnegative(),
    relationshipEvidence: z.number().int().nonnegative(),
    relationshipStatusChanges: z.number().int().nonnegative(),
  }),
  deduplicated: z.object({
    names: z.number().int().nonnegative(),
    keywords: z.number().int().nonnegative(),
    relationships: z.number().int().nonnegative(),
  }),
})

const familyBranchAuditCandidateGroupSchema = z.object({
  sourceIndex: z.number().int().nonnegative(),
  sourceMember: familyBranchSourceMemberSchema,
  candidates: z.array(searchPersonOutputSchema),
})

const familyBranchAuditMissingSchema = z.object({
  sourceIndex: z.number().int().nonnegative(),
  sourceMember: familyBranchSourceMemberSchema,
  fuzzyCandidates: z.array(searchPersonOutputSchema),
})

function toolError(error: unknown): {
  content: Array<{ type: "text"; text: string }>
  isError: true
} {
  if (
    error instanceof PeopleInputError ||
    error instanceof IdempotencyConflictError
  ) {
    return {
      content: [{ type: "text", text: error.message }],
      isError: true,
    }
  }

  console.error("People MCP tool failed:", error)

  return {
    content: [
      {
        type: "text",
        text: "The people operation failed. Check the MCP server diagnostics.",
      },
    ],
    isError: true,
  }
}

export function registerPeopleTools(server: McpServer): void {
  server.registerTool(
    "import_people",
    {
      title: "Import people",
      description:
        "Import people using the person's original personal name (ism), normally expanded as a nasab, for the primary display. Primary nameType must be personal or nasab; store kunyah, laqab, nisbah, and aliases as additional names. Similar names are reported as candidates and are never merged automatically.",
      inputSchema: z.object({
        batchKey: z.string().trim().min(1).max(300),
        instruction: z.string().trim().min(1).max(5_000).optional(),
        source: sourceInputSchema.optional(),
        people: z.array(personInputSchema).min(1).max(500),
      }),
      outputSchema: z.object({
        runId: z.uuid(),
        replayed: z.boolean(),
        people: z.array(importedPersonOutputSchema),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const result = await importPeople(input)
        const output = {
          runId: result.runId,
          replayed: result.replayed,
          people: result.people,
        }

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "import_family_branch",
    {
      title: "Import family branch",
      description:
        "Run an idempotent, resumable family import workflow. Each member either reuses an explicit existing person ID or creates a provisional person, then records one canonical directed relationship with evidence. Duplicate candidates are reported and never merged automatically.",
      inputSchema: z.object({
        operationKey: z.string().trim().min(1).max(240),
        rootPersonId: z.uuid(),
        instruction: z.string().trim().min(1).max(5_000).optional(),
        source: sourceInputSchema.optional(),
        members: z
          .array(
            z
              .object({
                existingPersonId: z.uuid().optional(),
                person: personInputSchema.optional(),
                relationship: z.object({
                  type: personRelationshipTypeSchema,
                  direction: z.enum(["outgoing", "incoming"]),
                  status: assertionStatusSchema.default("accepted"),
                  reason: z.string().trim().min(1).max(5_000),
                  evidence: z.array(evidenceInputSchema).min(1).max(20),
                }),
              })
              .refine(
                ({ existingPersonId, person }) =>
                  (existingPersonId === undefined) !== (person === undefined),
                {
                  message:
                    "Provide exactly one of existingPersonId or person for each member.",
                },
              ),
          )
          .min(1)
          .max(200),
      }),
      outputSchema: z.object({
        runId: z.uuid(),
        replayed: z.boolean(),
        rootPersonId: z.uuid(),
        peopleRunId: z.uuid().nullable(),
        members: z.array(
          z.object({
            index: z.number().int().nonnegative(),
            created: z.boolean(),
            person: importedPersonOutputSchema,
            relationship: addPersonRelationshipOutputSchema,
          }),
        ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await importFamilyBranch(input)

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "audit_family_branch",
    {
      title: "Audit family branch",
      description:
        "Compare a source-derived list of direct family members supplied by the caller with one stored relationship branch. Returns exact matches, existing-but-unlinked people, ambiguous identities, missing people with fuzzy candidates, and database-only relationships. This tool does not browse or modify data.",
      inputSchema: z.object({
        rootPersonId: z.uuid(),
        relationshipType: personRelationshipTypeSchema,
        direction: z.enum(["outgoing", "incoming"]),
        sourceMembers: z.array(familyBranchSourceMemberSchema).min(1).max(100),
      }),
      outputSchema: z.object({
        rootPerson: personOutputSchema,
        relationshipType: personRelationshipTypeSchema,
        direction: z.enum(["outgoing", "incoming"]),
        matched: z.array(
          z.object({
            sourceIndex: z.number().int().nonnegative(),
            sourceMember: familyBranchSourceMemberSchema,
            person: searchPersonOutputSchema,
            relationship: personRelationshipOutputSchema,
          }),
        ),
        unlinked: z.array(familyBranchAuditCandidateGroupSchema),
        ambiguous: z.array(familyBranchAuditCandidateGroupSchema),
        missing: z.array(familyBranchAuditMissingSchema),
        databaseOnly: z.array(personRelationshipOutputSchema),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await auditFamilyBranch(input)

        if (!output) {
          return {
            content: [
              {
                type: "text",
                text: `Person "${input.rootPersonId}" was not found.`,
              },
            ],
            isError: true,
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "audit_spouse_coverage",
    {
      title: "Audit spouse coverage",
      description:
        "Find male and female biological co-parent pairs and compare them with stored canonical husband_of assertions. Returns shared children, the full parent assertions with evidence and status history, and any existing spouse assertion. Missing spouse assertions are review candidates only: co-parenthood is never treated as proof of marriage and this tool never writes data.",
      inputSchema: z.object({
        parentStatuses: z
          .array(assertionStatusSchema)
          .min(1)
          .max(4)
          .default(["accepted"]),
        coverageStatuses: z
          .array(spouseCoverageStatusSchema)
          .min(1)
          .max(5)
          .default([
            "accepted",
            "uncertain",
            "disputed",
            "retracted",
            "missing",
          ]),
        offset: z.number().int().min(0).max(100_000).default(0),
        limit: z.number().int().min(1).max(500).default(100),
      }),
      outputSchema: z.object({
        parentStatuses: z.array(assertionStatusSchema),
        coverageStatuses: z.array(spouseCoverageStatusSchema),
        offset: z.number().int().nonnegative(),
        limit: z.number().int().positive(),
        matchingPairs: z.number().int().nonnegative(),
        returnedPairs: z.number().int().nonnegative(),
        hasMore: z.boolean(),
        summary: z.object({
          biologicalParentRelationships: z.number().int().nonnegative(),
          childrenWithBothParentGenders: z.number().int().nonnegative(),
          coParentPairs: z.number().int().nonnegative(),
          unclassifiedParentRelationships: z.number().int().nonnegative(),
          accepted: z.number().int().nonnegative(),
          uncertain: z.number().int().nonnegative(),
          disputed: z.number().int().nonnegative(),
          retracted: z.number().int().nonnegative(),
          missing: z.number().int().nonnegative(),
        }),
        pairs: z.array(spouseCoveragePairOutputSchema),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await auditSpouseCoverage(input)

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "get_family_tree",
    {
      title: "Get family tree",
      description:
        "Traverse a person's relationship graph into a bounded family tree. Returns unique people as nodes and canonical directed relationships as edges, with configurable depth, node limit, relationship types, and assertion statuses.",
      inputSchema: z.object({
        rootPersonId: z.uuid(),
        maxDepth: z.number().int().min(1).max(6).default(2),
        maxNodes: z.number().int().min(1).max(500).default(100),
        relationshipTypes: z
          .array(personRelationshipTypeSchema)
          .min(1)
          .max(personRelationshipTypes.length)
          .default([...personRelationshipTypes]),
        statuses: z
          .array(assertionStatusSchema)
          .min(1)
          .max(4)
          .default(["accepted", "uncertain", "disputed"]),
      }),
      outputSchema: z.object({
        rootPersonId: z.uuid(),
        maxDepth: z.number().int(),
        maxNodes: z.number().int(),
        truncated: z.boolean(),
        nodes: z.array(
          z.object({
            depth: z.number().int().nonnegative(),
            person: personOutputSchema,
          }),
        ),
        edges: z.array(
          z.object({
            relationshipId: z.uuid(),
            type: personRelationshipTypeSchema,
            status: assertionStatusSchema,
            fromPersonId: z.uuid(),
            toPersonId: z.uuid(),
          }),
        ),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await getFamilyTree(input)

        if (!output) {
          return {
            content: [
              {
                type: "text",
                text: `Person "${input.rootPersonId}" was not found.`,
              },
            ],
            isError: true,
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "search_people",
    {
      title: "Search people",
      description:
        "Search people by primary name, kunyah, laqab, nisbah, nasab, alias, transliteration, spelling variant, or search keyword.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(500),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      outputSchema: z.object({
        query: z.string(),
        count: z.number().int().nonnegative(),
        people: z.array(searchPersonOutputSchema),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, limit }) => {
      try {
        const people = await searchPeople(query, limit)
        const output = {
          query,
          count: people.length,
          people,
        }

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "search_people_batch",
    {
      title: "Search people in batch",
      description:
        "Search up to 100 person names or variants in one read-only call. Returns an ordered result group for every query, making duplicate prechecks and large family imports more efficient.",
      inputSchema: z.object({
        queries: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
        limitPerQuery: z.number().int().min(1).max(20).default(10),
      }),
      outputSchema: z.object({
        results: z.array(
          z.object({
            query: z.string(),
            count: z.number().int().nonnegative(),
            people: z.array(searchPersonOutputSchema),
          }),
        ),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await searchPeopleBatch(input)

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "get_person",
    {
      title: "Get person",
      description:
        "Get one person with all structured names and search keywords by entity ID.",
      inputSchema: z.object({
        entityId: z.uuid(),
      }),
      outputSchema: z.object({
        person: personOutputSchema,
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ entityId }) => {
      try {
        const person = await getPerson(entityId)

        if (!person) {
          return {
            content: [
              {
                type: "text",
                text: `Person "${entityId}" was not found.`,
              },
            ],
            isError: true,
          }
        }

        const output = { person }

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "set_person_gender",
    {
      title: "Set person gender",
      description:
        "Set or correct a person's gender with an idempotent audited change. Existing husband_of relationships are protected from incompatible changes.",
      inputSchema: z.object({
        operationKey: z.string().trim().min(1).max(300),
        entityId: z.uuid(),
        gender: personGenderSchema,
        reason: z.string().trim().min(1).max(5_000),
        instruction: z.string().trim().min(1).max(5_000).optional(),
        source: sourceInputSchema.optional(),
      }),
      outputSchema: z.object({
        runId: z.uuid(),
        replayed: z.boolean(),
        entityId: z.uuid(),
        previousGender: personGenderSchema,
        gender: personGenderSchema,
        changed: z.boolean(),
        genderChangeId: z.uuid().nullable(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await setPersonGender(input)

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "set_person_primary_name",
    {
      title: "Set person primary name",
      description:
        "Set or correct a person's primary display using the original personal name (ism), normally expanded as a nasab. Only personal or nasab is accepted; kunyah, laqab, nisbah, and aliases remain alternate structured names. The change is idempotent and audited.",
      inputSchema: z.object({
        operationKey: z.string().trim().min(1).max(300),
        entityId: z.uuid(),
        name: primaryPersonNameInputSchema,
        reason: z.string().trim().min(1).max(5_000),
        instruction: z.string().trim().min(1).max(5_000).optional(),
        source: sourceInputSchema.optional(),
      }),
      outputSchema: z.object({
        runId: z.uuid(),
        replayed: z.boolean(),
        entityId: z.uuid(),
        previousPrimaryName: personNameOutputSchema,
        primaryName: personNameOutputSchema,
        changed: z.boolean(),
        primaryNameChangeId: z.uuid().nullable(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await setPersonPrimaryName(input)

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "merge_people",
    {
      title: "Merge duplicate people",
      description:
        "Destructively merge one confirmed duplicate person into a canonical person in a single audited transaction. Requires current expected original names and activation-grade identity evidence under salafiyyun-v1. Transfers structured names, keywords, evidence, histories, and relationships; deduplicates matching facts; and rejects gender, self-relationship, or relationship-status conflicts instead of guessing.",
      inputSchema: z.object({
        operationKey: z.string().trim().min(1).max(300),
        duplicatePersonId: z.uuid(),
        canonicalPersonId: z.uuid(),
        expectedDuplicateNameOriginal: z.string().trim().min(1).max(500),
        expectedCanonicalNameOriginal: z.string().trim().min(1).max(500),
        reason: z.string().trim().min(1).max(5_000),
        instruction: z.string().trim().min(1).max(5_000).optional(),
        evidence: z.array(evidenceInputSchema).min(1).max(20),
      }),
      outputSchema: mergePeopleOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await mergePeople(input)

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "add_person_relationship",
    {
      title: "Add person relationship",
      description:
        "Create or support a directed relationship with evidence and status. Store parent to child, husband to wife, guardian to ward, and teacher to student.",
      inputSchema: z.object({
        operationKey: z.string().trim().min(1).max(300),
        fromPersonId: z.uuid(),
        toPersonId: z.uuid(),
        type: personRelationshipTypeSchema,
        status: assertionStatusSchema.default("accepted"),
        reason: z.string().trim().min(1).max(5_000),
        instruction: z.string().trim().min(1).max(5_000).optional(),
        evidence: z.array(evidenceInputSchema).min(1).max(20),
      }),
      outputSchema: addPersonRelationshipOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await addPersonRelationship(input)

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "get_person_relationships",
    {
      title: "Get person relationships",
      description:
        "Get all directed relationships for a person with derived labels, related people, evidence, and status history.",
      inputSchema: z.object({
        entityId: z.uuid(),
      }),
      outputSchema: z.object({
        entityId: z.uuid(),
        relationships: z.array(personRelationshipOutputSchema),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ entityId }) => {
      try {
        const output = await getPersonRelationships(entityId)

        if (!output) {
          return {
            content: [
              {
                type: "text",
                text: `Person "${entityId}" was not found.`,
              },
            ],
            isError: true,
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "assert_person_religion_at_death",
    {
      title: "Assert religion at death",
      description:
        "Create or support an evidenced assertion that a person died as Muslim or non-Muslim. Absence of an accepted assertion means unknown; conflicting claims remain preserved by assertion status.",
      inputSchema: z.object({
        operationKey: z.string().trim().min(1).max(300),
        personId: z.uuid(),
        value: personReligionAtDeathSchema,
        status: assertionStatusSchema.default("accepted"),
        reason: z.string().trim().min(1).max(5_000),
        instruction: z.string().trim().min(1).max(5_000).optional(),
        evidence: z.array(evidenceInputSchema).min(1).max(20),
      }),
      outputSchema: z.object({
        runId: z.uuid(),
        replayed: z.boolean(),
        assertionId: z.uuid(),
        created: z.boolean(),
        value: personReligionAtDeathSchema,
        status: assertionStatusSchema,
        evidenceIds: z.array(z.uuid()),
        statusChangeId: z.uuid().nullable(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await assertPersonReligionAtDeath(input)

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "get_person_religion_at_death",
    {
      title: "Get religion at death",
      description:
        "Get the accepted religion-at-death conclusion for a person, or unknown, together with every preserved assertion, source passage, and status change.",
      inputSchema: z.object({ personId: z.uuid() }),
      outputSchema: z.object({
        personId: z.uuid(),
        conclusion: z.union([
          personReligionAtDeathSchema,
          z.literal("unknown"),
        ]),
        assertions: z.array(religionAtDeathAssertionOutputSchema),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ personId }) => {
      try {
        const output = await getPersonReligionAtDeath(personId)

        if (!output) {
          return {
            content: [
              { type: "text", text: `Person "${personId}" was not found.` },
            ],
            isError: true,
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "assert_person_encounter",
    {
      title: "Assert person encounter",
      description:
        "Create or support an evidenced, symmetric assertion that two people met or did not meet. The pair is canonicalized so reversing the input does not create a duplicate fact.",
      inputSchema: z.object({
        operationKey: z.string().trim().min(1).max(300),
        firstPersonId: z.uuid(),
        secondPersonId: z.uuid(),
        outcome: personEncounterOutcomeSchema,
        status: assertionStatusSchema.default("accepted"),
        reason: z.string().trim().min(1).max(5_000),
        instruction: z.string().trim().min(1).max(5_000).optional(),
        evidence: z.array(evidenceInputSchema).min(1).max(20),
      }),
      outputSchema: z.object({
        runId: z.uuid(),
        replayed: z.boolean(),
        assertionId: z.uuid(),
        created: z.boolean(),
        firstPersonId: z.uuid(),
        secondPersonId: z.uuid(),
        outcome: personEncounterOutcomeSchema,
        status: assertionStatusSchema,
        evidenceIds: z.array(z.uuid()),
        statusChangeId: z.uuid().nullable(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await assertPersonEncounter(input)

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "get_person_encounters",
    {
      title: "Get person encounters",
      description:
        "Get all encounter conclusions for a person, including unknown conclusions, conflicting assertions, evidence, and status history.",
      inputSchema: z.object({ personId: z.uuid() }),
      outputSchema: z.object({
        personId: z.uuid(),
        encounters: z.array(
          z.object({
            otherPerson: relatedPersonOutputSchema,
            conclusion: z.union([
              personEncounterOutcomeSchema,
              z.literal("unknown"),
            ]),
            assertions: z.array(personEncounterAssertionOutputSchema),
          }),
        ),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ personId }) => {
      try {
        const output = await getPersonEncounters(personId)

        if (!output) {
          return {
            content: [
              { type: "text", text: `Person "${personId}" was not found.` },
            ],
            isError: true,
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "add_person_names",
    {
      title: "Add person names",
      description:
        "Add structured names such as a personal name, kunyah, laqab, nisbah, nasab, or alias to an existing person.",
      inputSchema: z.object({
        operationKey: z.string().trim().min(1).max(300),
        entityId: z.uuid(),
        names: z.array(personNameInputSchema).min(1).max(100),
        instruction: z.string().trim().min(1).max(5_000).optional(),
        source: sourceInputSchema.optional(),
      }),
      outputSchema: z.object({
        runId: z.uuid(),
        replayed: z.boolean(),
        entityId: z.uuid(),
        addedNames: z.array(personNameOutputSchema),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await addPersonNames(input)

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "add_person_keywords",
    {
      title: "Add person keywords",
      description:
        "Add search-only spelling variants or keywords to an existing person.",
      inputSchema: z.object({
        operationKey: z.string().trim().min(1).max(300),
        entityId: z.uuid(),
        keywords: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
        instruction: z.string().trim().min(1).max(5_000).optional(),
        source: sourceInputSchema.optional(),
      }),
      outputSchema: z.object({
        runId: z.uuid(),
        replayed: z.boolean(),
        entityId: z.uuid(),
        addedKeywords: z.array(z.string()),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const result = await addPersonKeywords(input)
        const output = {
          runId: result.runId,
          replayed: result.replayed,
          entityId: result.entityId,
          addedKeywords: result.addedKeywords,
        }

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "activate_person",
    {
      title: "Activate person",
      description:
        "Verify a provisional person under source policy salafiyyun-v1, record the evidence and status history, and mark the person active. Requires one explicit Quran/authentic-hadith passage or two independent qualifying secondary sources.",
      inputSchema: z.object({
        operationKey: z.string().trim().min(1).max(300),
        entityId: z.uuid(),
        reason: z.string().trim().min(1).max(5_000),
        instruction: z.string().trim().min(1).max(5_000).optional(),
        evidence: z.array(evidenceInputSchema).min(1).max(20),
      }),
      outputSchema: activatePersonOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await activatePerson(input)

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "get_person_evidence",
    {
      title: "Get person evidence",
      description:
        "Get accepted, uncertain, disputed, or retracted evidence and the complete status history for one person.",
      inputSchema: z.object({
        entityId: z.uuid(),
      }),
      outputSchema: personEvidenceOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ entityId }) => {
      try {
        const output = await getPersonEvidence(entityId)

        if (!output) {
          return {
            content: [
              {
                type: "text",
                text: `Person "${entityId}" was not found.`,
              },
            ],
            isError: true,
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "get_person_facts_batch",
    {
      title: "Get person facts in batch",
      description:
        "Read religion-at-death facts for up to 100 people and, optionally, each person's encounter conclusion with one target person. Missing people and unknown conclusions remain explicit in the ordered result.",
      inputSchema: z.object({
        personIds: z.array(z.uuid()).min(1).max(100),
        encounterWithPersonId: z.uuid().optional(),
      }),
      outputSchema: z.object({
        encounterWithPersonId: z.uuid().nullable(),
        items: z.array(
          z.object({
            personId: z.uuid(),
            found: z.boolean(),
            person: personOutputSchema.nullable(),
            religionAtDeath: religionAtDeathOutputSchema.nullable(),
            encounterWith: z
              .object({
                personId: z.uuid(),
                conclusion: z.union([
                  personEncounterOutcomeSchema,
                  z.literal("unknown"),
                ]),
                assertions: z.array(personEncounterAssertionOutputSchema),
              })
              .nullable(),
          }),
        ),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await getPersonFactsBatch(input)
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "assert_person_religions_at_death_batch",
    {
      title: "Assert religions at death in batch",
      description:
        "Run up to 100 independently idempotent religion-at-death assertions. Each item retains its own evidence and operation key; validation failures are returned per item without hiding successful writes.",
      inputSchema: z.object({
        assertions: z
          .array(religionAtDeathAssertionInputSchema)
          .min(1)
          .max(100),
      }),
      outputSchema: z.object({
        total: z.number().int().nonnegative(),
        succeeded: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        items: z.array(
          z.discriminatedUnion("status", [
            z.object({
              index: z.number().int().nonnegative(),
              operationKey: z.string(),
              status: z.literal("succeeded"),
              result: religionAtDeathResultOutputSchema,
            }),
            batchAssertionFailureOutputSchema,
          ]),
        ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await assertPersonReligionsAtDeathBatch(input)
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "assert_person_encounters_batch",
    {
      title: "Assert person encounters in batch",
      description:
        "Run up to 100 independently idempotent symmetric encounter assertions. Each item retains its own evidence and operation key; validation failures are returned per item without hiding successful writes.",
      inputSchema: z.object({
        assertions: z.array(encounterAssertionInputSchema).min(1).max(100),
      }),
      outputSchema: z.object({
        total: z.number().int().nonnegative(),
        succeeded: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        items: z.array(
          z.discriminatedUnion("status", [
            z.object({
              index: z.number().int().nonnegative(),
              operationKey: z.string(),
              status: z.literal("succeeded"),
              result: encounterResultOutputSchema,
            }),
            batchAssertionFailureOutputSchema,
          ]),
        ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await assertPersonEncountersBatch(input)
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )

  server.registerTool(
    "audit_family_facts",
    {
      title: "Audit extended-family facts",
      description:
        "Derive paternal and maternal uncles, aunts, and cousins from evidenced biological-parent paths, then report each member's religion-at-death and encounter conclusion with the root person. Unknown and conflicting facts remain visible; kinship paths and assertion statuses are returned for review.",
      inputSchema: z.object({
        rootPersonId: z.uuid(),
        sides: z
          .array(familySideSchema)
          .min(1)
          .max(3)
          .default(["paternal", "maternal", "unknown"]),
        relationshipStatuses: z
          .array(assertionStatusSchema)
          .min(1)
          .max(4)
          .default(["accepted", "uncertain", "disputed"]),
      }),
      outputSchema: z.object({
        rootPerson: personOutputSchema,
        sides: z.array(familySideSchema),
        relationshipStatuses: z.array(assertionStatusSchema),
        summary: z.object({
          totalMembers: z.number().int().nonnegative(),
          byRole: z.object({
            paternal_uncle: z.number().int().nonnegative(),
            paternal_aunt: z.number().int().nonnegative(),
            paternal_parent_sibling: z.number().int().nonnegative(),
            maternal_uncle: z.number().int().nonnegative(),
            maternal_aunt: z.number().int().nonnegative(),
            maternal_parent_sibling: z.number().int().nonnegative(),
            unknown_side_uncle: z.number().int().nonnegative(),
            unknown_side_aunt: z.number().int().nonnegative(),
            unknown_side_parent_sibling: z.number().int().nonnegative(),
            paternal_cousin: z.number().int().nonnegative(),
            maternal_cousin: z.number().int().nonnegative(),
            unknown_side_cousin: z.number().int().nonnegative(),
          }),
          religionKnown: z.number().int().nonnegative(),
          religionUnknown: z.number().int().nonnegative(),
          encounterKnown: z.number().int().nonnegative(),
          encounterUnknown: z.number().int().nonnegative(),
        }),
        members: z.array(
          z.object({
            role: extendedFamilyRoleSchema,
            person: personOutputSchema,
            derivationPaths: z.array(
              z.object({
                side: familySideSchema,
                relationshipIds: z.array(z.uuid()),
                relationshipStatuses: z.array(assertionStatusSchema),
              }),
            ),
            religionAtDeath: religionAtDeathOutputSchema,
            encounterWithRoot: z.object({
              conclusion: z.union([
                personEncounterOutcomeSchema,
                z.literal("unknown"),
              ]),
              assertions: z.array(personEncounterAssertionOutputSchema),
            }),
          }),
        ),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const output = await auditFamilyFacts(input)

        if (!output) {
          return {
            content: [
              {
                type: "text",
                text: `Person "${input.rootPersonId}" was not found.`,
              },
            ],
            isError: true,
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        return toolError(error)
      }
    },
  )
}
