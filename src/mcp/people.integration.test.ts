import { expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js"
import { resetTestDatabase } from "@/testing/reset-test-database"

const integrationTest = Bun.env.TEST_DATABASE_URL ? test : test.skip

integrationTest(
  "imports, replays, searches, and updates a person",
  async () => {
    const databaseUrl = Bun.env.TEST_DATABASE_URL
    const testId = crypto.randomUUID()
    const uniqueSearchTerm = `integration-${testId}`

    if (!databaseUrl) {
      throw new Error("TEST_DATABASE_URL is required for integration tests.")
    }

    await resetTestDatabase(databaseUrl)

    const client = new Client({
      name: "islam-pedia-integration-test-client",
      version: "0.1.0",
    })
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["run", "src/mcp/server.ts"],
      cwd: process.cwd(),
      env: {
        ...getDefaultEnvironment(),
        DATABASE_URL: databaseUrl,
      },
      stderr: "pipe",
    })

    try {
      await client.connect(transport)

      const importInput = {
        batchKey: `integration-people-${testId}`,
        instruction: "Integration test import",
        people: [
          {
            nameOriginal: "عُمَر بْن ٱلْخَطَّاب",
            nameLatin: "Umar ibn al-Khaṭṭāb",
            keywords: ["Umar", "Omar", "Ibn al-Khattab", uniqueSearchTerm],
          },
        ],
      }
      const imported = await client.callTool({
        name: "import_people",
        arguments: importInput,
      })

      expect(imported.isError).not.toBe(true)

      const importedContent = imported.structuredContent as {
        replayed: boolean
        people: Array<{ entityId: string }>
      }
      const entityId = importedContent.people[0]?.entityId

      expect(importedContent.replayed).toBe(false)
      expect(entityId).toBeString()

      const replayed = await client.callTool({
        name: "import_people",
        arguments: importInput,
      })

      expect(replayed.isError).not.toBe(true)
      expect(
        (replayed.structuredContent as { replayed: boolean }).replayed,
      ).toBe(true)

      const searched = await client.callTool({
        name: "search_people",
        arguments: { query: uniqueSearchTerm, limit: 10 },
      })

      expect(searched.isError).not.toBe(true)
      expect(
        (
          searched.structuredContent as {
            people: Array<{ entityId: string }>
          }
        ).people[0]?.entityId,
      ).toBe(entityId)

      const added = await client.callTool({
        name: "add_person_keywords",
        arguments: {
          operationKey: `integration-keywords-${testId}`,
          entityId,
          keywords: ["Al-Faruq", "Farooq"],
        },
      })

      expect(added.isError).not.toBe(true)
      expect(
        (added.structuredContent as { addedKeywords: string[] }).addedKeywords,
      ).toEqual(["Al-Faruq", "Farooq"])

      const fetched = await client.callTool({
        name: "get_person",
        arguments: { entityId },
      })

      expect(fetched.isError).not.toBe(true)
      const fetchedKeywords = (
        fetched.structuredContent as {
          person: { keywords: string[] }
        }
      ).person.keywords

      expect(fetchedKeywords).toContain("Al-Faruq")
      expect(fetchedKeywords).toContain("Farooq")
      expect(fetchedKeywords).toContain("Ibn al-Khattab")
      expect(fetchedKeywords).toContain("Omar")
      expect(fetchedKeywords).toContain("Umar")
      expect(fetchedKeywords).toContain(uniqueSearchTerm)
    } finally {
      try {
        await client.close()
      } finally {
        await resetTestDatabase(databaseUrl)
      }
    }
  },
)
