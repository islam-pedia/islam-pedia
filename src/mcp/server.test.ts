import { afterAll, beforeAll, expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

let client: Client

beforeAll(async () => {
  client = new Client({
    name: "islam-pedia-test-client",
    version: "0.1.0",
  })

  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/mcp/server.ts"],
    cwd: process.cwd(),
    stderr: "pipe",
  })

  await client.connect(transport)
})

afterAll(async () => {
  await client.close()
})

test("exposes the initial MCP tools", async () => {
  const { tools } = await client.listTools()

  expect(tools.map(({ name }) => name).sort()).toEqual([
    "project_context",
    "system_health",
  ])
})

test("returns structured project context", async () => {
  const result = await client.callTool({
    name: "project_context",
    arguments: {},
  })

  expect(result.isError).not.toBe(true)
  expect(result.structuredContent).toEqual({
    phase: "backend-only",
    presentationLayer: "MCP over stdio",
    sourceOfTruth: "PostgreSQL 18",
    orm: "Drizzle ORM RC",
    writePolicy: "owner-directed AI writes with validation and audit",
  })
})
