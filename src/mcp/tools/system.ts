import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { getDatabase } from "@/db/client"
import { sourcePolicy } from "@/domain/evidence/source-policy"

const healthOutputSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.enum(["reachable", "unreachable"]),
  checkedAt: z.string(),
})

const projectContextOutputSchema = z.object({
  phase: z.literal("backend-only"),
  presentationLayer: z.literal("MCP over stdio"),
  sourceOfTruth: z.literal("PostgreSQL 18"),
  orm: z.literal("Drizzle ORM RC"),
  writePolicy: z.literal("owner-directed AI writes with validation and audit"),
  sourceMethodology: z.literal("salafiyyun"),
  sourcePolicyVersion: z.literal("salafiyyun-v1"),
  personNamingPolicy: z.object({
    primaryDisplay: z.literal(
      "original personal name (ism), normally expanded as nasab",
    ),
    allowedPrimaryNameTypes: z.tuple([
      z.literal("personal"),
      z.literal("nasab"),
    ]),
    alternateNames: z.literal(
      "kunyah, laqab, nisbah, and aliases remain separate structured names",
    ),
  }),
})

const sourcePolicyOutputSchema = z.object({
  version: z.literal("salafiyyun-v1"),
  methodology: z.literal("salafiyyun"),
  principle: z.string(),
  activationRules: z.object({
    interpretation: z.literal("explicit"),
    primaryEvidence: z.string(),
    secondaryEvidence: z.string(),
    contextOnly: z.string(),
  }),
  conflictPolicy: z.string(),
})

export function registerSystemTools(server: McpServer): void {
  server.registerTool(
    "system_health",
    {
      title: "System health",
      description:
        "Check whether the Islam Pedia MCP server can reach PostgreSQL.",
      inputSchema: z.object({}),
      outputSchema: healthOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const checkedAt = new Date().toISOString()

      try {
        await getDatabase().execute(sql`select 1`)

        const output = {
          status: "ok" as const,
          database: "reachable" as const,
          checkedAt,
        }

        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        }
      } catch (error) {
        console.error("PostgreSQL health check failed:", error)

        const output = {
          status: "degraded" as const,
          database: "unreachable" as const,
          checkedAt,
        }

        return {
          content: [
            {
              type: "text",
              text: `${JSON.stringify(output)}. Start PostgreSQL with docker compose up -d.`,
            },
          ],
          structuredContent: output,
        }
      }
    },
  )

  server.registerTool(
    "project_context",
    {
      title: "Project context",
      description:
        "Return the current architectural and canonical editorial context for Islam Pedia clients, including the enforced person naming policy.",
      inputSchema: z.object({}),
      outputSchema: projectContextOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const output = {
        phase: "backend-only" as const,
        presentationLayer: "MCP over stdio" as const,
        sourceOfTruth: "PostgreSQL 18" as const,
        orm: "Drizzle ORM RC" as const,
        writePolicy:
          "owner-directed AI writes with validation and audit" as const,
        sourceMethodology: "salafiyyun" as const,
        sourcePolicyVersion: "salafiyyun-v1" as const,
        personNamingPolicy: {
          primaryDisplay:
            "original personal name (ism), normally expanded as nasab" as const,
          allowedPrimaryNameTypes: ["personal", "nasab"] as const,
          alternateNames:
            "kunyah, laqab, nisbah, and aliases remain separate structured names" as const,
        },
      }

      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      }
    },
  )

  server.registerTool(
    "source_policy",
    {
      title: "Source policy",
      description:
        "Return the enforced source and methodology policy for Islam Pedia.",
      inputSchema: z.object({}),
      outputSchema: sourcePolicyOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const output = {
        version: sourcePolicy.version,
        methodology: sourcePolicy.methodology,
        principle: sourcePolicy.principle,
        activationRules: {
          interpretation: sourcePolicy.activationRules.interpretation,
          primaryEvidence: sourcePolicy.activationRules.primaryEvidence,
          secondaryEvidence: sourcePolicy.activationRules.secondaryEvidence,
          contextOnly: sourcePolicy.activationRules.contextOnly,
        },
        conflictPolicy: sourcePolicy.conflictPolicy,
      }

      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      }
    },
  )
}
