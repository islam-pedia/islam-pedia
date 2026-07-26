import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import {
  activatePerson,
  addPersonKeywords,
  addPersonNames,
  addPersonRelationship,
  getPerson,
  getPersonEvidence,
  getPersonRelationships,
  IdempotencyConflictError,
  importPeople,
  PeopleInputError,
  searchPeople,
  setPersonGender,
} from "@/application/people"
import { hadithGrades, sourceCategories } from "@/domain/evidence/source-policy"
import { personNameTypes } from "@/domain/people/names"
import {
  personGenders,
  personRelationshipTypes,
} from "@/domain/people/relationships"

const sourceInputSchema = z.object({
  label: z.string().trim().min(1).max(500).optional(),
  uri: z.string().trim().min(1).max(2_000).optional(),
})

const personNameTypeSchema = z.enum(personNameTypes)
const personGenderSchema = z.enum(personGenders)
const personRelationshipTypeSchema = z.enum(personRelationshipTypes)
const assertionStatusSchema = z.enum([
  "accepted",
  "uncertain",
  "disputed",
  "retracted",
])

const personNameInputSchema = z.object({
  type: personNameTypeSchema,
  nameOriginal: z.string().trim().min(1).max(500),
  nameLatin: z.string().trim().min(1).max(500),
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
        "Import people with a primary classified name, optional additional names such as kunyah or laqab, and search-only keywords. Similar names are reported as candidates and are never merged automatically.",
      inputSchema: z.object({
        batchKey: z.string().trim().min(1).max(300),
        instruction: z.string().trim().min(1).max(5_000).optional(),
        source: sourceInputSchema.optional(),
        people: z
          .array(
            z.object({
              nameOriginal: z.string().trim().min(1).max(500),
              nameLatin: z.string().trim().min(1).max(500),
              gender: personGenderSchema.default("unknown"),
              nameType: personNameTypeSchema.default("personal"),
              names: z.array(personNameInputSchema).max(100).default([]),
              keywords: z
                .array(z.string().trim().min(1).max(500))
                .max(100)
                .default([]),
            }),
          )
          .min(1)
          .max(500),
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
        people: z.array(
          personOutputSchema.extend({
            score: z.number(),
          }),
        ),
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
      outputSchema: z.object({
        runId: z.uuid(),
        replayed: z.boolean(),
        relationshipId: z.uuid(),
        created: z.boolean(),
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
}
