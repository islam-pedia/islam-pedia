import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp"
import { z } from "zod"
import {
  addPersonKeywords,
  getPerson,
  IdempotencyConflictError,
  importPeople,
  PeopleInputError,
  searchPeople,
} from "@/application/people"

const sourceInputSchema = z.object({
  label: z.string().trim().min(1).max(500).optional(),
  uri: z.string().trim().min(1).max(2_000).optional(),
})

const personOutputSchema = z.object({
  entityId: z.uuid(),
  status: z.enum(["provisional", "active", "merged"]),
  mergedIntoEntityId: z.uuid().nullable(),
  nameOriginal: z.string(),
  nameLatin: z.string(),
  keywords: z.array(z.string()),
  createdAt: z.string(),
})

const importedPersonOutputSchema = personOutputSchema.extend({
  duplicateCandidateIds: z.array(z.uuid()),
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
        "Import one or more people with original names, Latin names, and search-only keywords. Similar names are reported as candidates and are never merged automatically.",
      inputSchema: z.object({
        batchKey: z.string().trim().min(1).max(300),
        instruction: z.string().trim().min(1).max(5_000).optional(),
        source: sourceInputSchema.optional(),
        people: z
          .array(
            z.object({
              nameOriginal: z.string().trim().min(1).max(500),
              nameLatin: z.string().trim().min(1).max(500),
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
        "Search people by original name, Latin name, transliteration, spelling variant, or search keyword.",
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
      description: "Get one person and all search keywords by entity ID.",
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
}
