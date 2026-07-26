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

      const activationInput = {
        operationKey: `integration-activate-${testId}`,
        entityId,
        reason: "Identity confirmed by an explicit test source passage.",
        instruction: "Integration test activation",
        evidence: [
          {
            source: {
              category: "salafiyyun_scholar",
              label: "Integration Test Source One",
              uri: "https://example.test/source-one",
              author: "Test Author One",
              workTitle: "Test Work One",
              edition: "Test Edition",
              methodologyBasis:
                "Synthetic fixture representing a Salafiyyun source.",
            },
            passage: "This first passage explicitly names the test person.",
            language: "en",
            locator: {
              volume: "1",
              page: "10",
              chapter: "Identity",
              section: "Test fixture",
              url: "https://example.test/source-one#identity",
            },
            assertion: "The source explicitly identifies this person.",
            interpretation: "explicit",
            notes: "Synthetic evidence used only by the integration test.",
          },
          {
            source: {
              category: "salaf_report",
              label: "Integration Test Source Two",
              uri: "https://example.test/source-two",
              author: "Test Author Two",
              workTitle: "Test Work Two",
              edition: "Test Edition",
              methodologyBasis:
                "Synthetic fixture representing an independently transmitted report from the Salaf.",
            },
            passage: "This second passage explicitly names the test person.",
            language: "en",
            locator: {
              volume: "2",
              page: "20",
              chapter: "Identity",
              section: "Independent test fixture",
              url: "https://example.test/source-two#identity",
            },
            assertion:
              "An independent source explicitly identifies this person.",
            interpretation: "explicit",
            notes: "Synthetic evidence used only by the integration test.",
          },
        ],
      } as const
      const activated = await client.callTool({
        name: "activate_person",
        arguments: activationInput,
      })

      expect(activated.isError).not.toBe(true)
      const activationContent = activated.structuredContent as {
        replayed: boolean
        status: string
        evidenceIds: string[]
        statusChangeId: string
      }

      expect(activationContent.replayed).toBe(false)
      expect(activationContent.status).toBe("active")
      expect(activationContent.evidenceIds).toHaveLength(2)
      expect(activationContent.statusChangeId).toBeString()

      const replayedActivation = await client.callTool({
        name: "activate_person",
        arguments: activationInput,
      })

      expect(replayedActivation.isError).not.toBe(true)
      expect(
        (replayedActivation.structuredContent as { replayed: boolean })
          .replayed,
      ).toBe(true)

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

      expect(
        (
          fetched.structuredContent as {
            person: { status: string }
          }
        ).person.status,
      ).toBe("active")
      expect(fetchedKeywords).toContain("Al-Faruq")
      expect(fetchedKeywords).toContain("Farooq")
      expect(fetchedKeywords).toContain("Ibn al-Khattab")
      expect(fetchedKeywords).toContain("Omar")
      expect(fetchedKeywords).toContain("Umar")
      expect(fetchedKeywords).toContain(uniqueSearchTerm)

      const evidenceResult = await client.callTool({
        name: "get_person_evidence",
        arguments: { entityId },
      })

      expect(evidenceResult.isError).not.toBe(true)
      const evidenceContent = evidenceResult.structuredContent as {
        evidence: Array<{
          status: string
          interpretation: string
          source: {
            category: string
            label: string
            methodology: string
            policyVersion: string
          }
          passage: { text: string }
        }>
        statusHistory: Array<{
          fromStatus: string | null
          toStatus: string
          reason: string
          statusChangeId: string
          runId: string
          createdAt: string
        }>
      }

      expect(evidenceContent.evidence).toHaveLength(2)
      expect(evidenceContent.evidence[0]).toMatchObject({
        status: "accepted",
        interpretation: "explicit",
        source: {
          category: "salafiyyun_scholar",
          label: "Integration Test Source One",
          methodology: "salafiyyun",
          policyVersion: "salafiyyun-v1",
        },
        passage: {
          text: "This first passage explicitly names the test person.",
        },
      })
      expect(evidenceContent.statusHistory).toEqual([
        {
          fromStatus: null,
          toStatus: "provisional",
          reason: "Entity created pending identity verification.",
          statusChangeId: expect.any(String),
          runId: expect.any(String),
          createdAt: expect.any(String),
        },
        {
          fromStatus: "provisional",
          toStatus: "active",
          reason: "Identity confirmed by an explicit test source passage.",
          statusChangeId: expect.any(String),
          runId: expect.any(String),
          createdAt: expect.any(String),
        },
      ])
    } finally {
      try {
        await client.close()
      } finally {
        await resetTestDatabase(databaseUrl)
      }
    }
  },
)
