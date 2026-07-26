import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { getDatabase } from "@/db/client"

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
        "Return the current architectural context for Islam Pedia clients.",
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
      }

      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      }
    },
  )
}
