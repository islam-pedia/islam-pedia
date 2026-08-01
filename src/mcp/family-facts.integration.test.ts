import { expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js"
import { SQL } from "bun"
import { resetTestDatabase } from "@/testing/reset-test-database"

const integrationTest = Bun.env.TEST_DATABASE_URL ? test : test.skip

integrationTest(
  "batches family facts, audits derived roles, and reuses evidence records",
  async () => {
    const databaseUrl = Bun.env.TEST_DATABASE_URL
    const testId = crypto.randomUUID()

    if (!databaseUrl) {
      throw new Error("TEST_DATABASE_URL is required for integration tests.")
    }

    await resetTestDatabase(databaseUrl)

    const client = new Client({
      name: "islam-pedia-family-facts-integration-test-client",
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

      const imported = await client.callTool({
        name: "import_people",
        arguments: {
          batchKey: `family-facts-people-${testId}`,
          people: [
            {
              nameOriginal: "الجذر بن الأب",
              nameLatin: "Al-Jidhr ibn al-Ab",
              gender: "male",
              nameType: "nasab",
            },
            {
              nameOriginal: "الأب بن الجد",
              nameLatin: "Al-Ab ibn al-Jadd",
              gender: "male",
              nameType: "nasab",
            },
            {
              nameOriginal: "الجد",
              nameLatin: "Al-Jadd",
              gender: "male",
            },
            {
              nameOriginal: "العم بن الجد",
              nameLatin: "Al-Amm ibn al-Jadd",
              gender: "male",
              nameType: "nasab",
            },
            {
              nameOriginal: "العمة بنت الجد",
              nameLatin: "Al-Ammah bint al-Jadd",
              gender: "female",
              nameType: "nasab",
            },
            {
              nameOriginal: "ابن العم",
              nameLatin: "Ibn al-Amm",
              gender: "male",
            },
          ],
        },
      })
      expect(imported.isError).not.toBe(true)

      const ids = (
        imported.structuredContent as {
          people: Array<{ entityId: string }>
        }
      ).people.map(({ entityId }) => entityId)
      const [rootId, fatherId, grandfatherId, uncleId, auntId, cousinId] = ids

      if (
        !rootId ||
        !fatherId ||
        !grandfatherId ||
        !uncleId ||
        !auntId ||
        !cousinId
      ) {
        throw new Error("Family-facts fixture did not return all person IDs.")
      }

      const sharedEvidence = (
        label: string,
        passage: string,
        assertion: string,
      ) => [
        {
          source: {
            category: "salaf_report",
            label,
            author: "Integration Genealogist",
            workTitle: "Integration Family Facts",
            methodologyBasis:
              "Synthetic explicit fixture used only for integration testing.",
          },
          passage,
          language: "en",
          locator: { page: "1", section: "Fixture" },
          assertion,
          interpretation: "explicit",
        },
      ]
      const relationships = [
        [fatherId, rootId],
        [grandfatherId, fatherId],
        [grandfatherId, uncleId],
        [grandfatherId, auntId],
        [uncleId, cousinId],
      ] as const

      for (const [
        index,
        [fromPersonId, toPersonId],
      ] of relationships.entries()) {
        const result = await client.callTool({
          name: "add_person_relationship",
          arguments: {
            operationKey: `family-facts-relationship-${testId}-${index}`,
            fromPersonId,
            toPersonId,
            type: "biological_parent_of",
            status: "accepted",
            reason: "Explicit integration genealogy.",
            evidence: sharedEvidence(
              "Shared Genealogy Source",
              "The fixture records the complete biological lineage.",
              `The fixture explicitly records relationship ${index}.`,
            ),
          },
        })
        expect(result.isError).not.toBe(true)
      }

      const religionBatch = await client.callTool({
        name: "assert_person_religions_at_death_batch",
        arguments: {
          assertions: [
            {
              operationKey: `family-facts-religion-${testId}-uncle`,
              personId: uncleId,
              value: "muslim",
              status: "accepted",
              reason: "Explicit integration fixture.",
              evidence: sharedEvidence(
                "Shared Fact Source",
                "The fixture explicitly records the family facts.",
                "The uncle died as a Muslim.",
              ),
            },
            {
              operationKey: `family-facts-religion-${testId}-cousin`,
              personId: cousinId,
              value: "muslim",
              status: "accepted",
              reason: "Explicit integration fixture.",
              evidence: sharedEvidence(
                "Shared Fact Source",
                "The fixture explicitly records the family facts.",
                "The cousin died as a Muslim.",
              ),
            },
            {
              operationKey: `family-facts-religion-${testId}-missing`,
              personId: "00000000-0000-4000-8000-000000000001",
              value: "muslim",
              status: "accepted",
              reason: "Exercise partial batch failure.",
              evidence: sharedEvidence(
                "Shared Fact Source",
                "The fixture explicitly records the family facts.",
                "This assertion targets a missing fixture person.",
              ),
            },
          ],
        },
      })

      expect(religionBatch.isError).not.toBe(true)
      expect(religionBatch.structuredContent).toMatchObject({
        total: 3,
        succeeded: 2,
        failed: 1,
        items: [
          { status: "succeeded" },
          { status: "succeeded" },
          { status: "failed", error: expect.stringContaining("not found") },
        ],
      })

      const encounterBatch = await client.callTool({
        name: "assert_person_encounters_batch",
        arguments: {
          assertions: [
            {
              operationKey: `family-facts-encounter-${testId}-uncle`,
              firstPersonId: rootId,
              secondPersonId: uncleId,
              outcome: "met",
              status: "accepted",
              reason: "Explicit integration fixture.",
              evidence: sharedEvidence(
                "Shared Fact Source",
                "The fixture explicitly records the family facts.",
                "The root met the uncle.",
              ),
            },
            {
              operationKey: `family-facts-encounter-${testId}-cousin`,
              firstPersonId: rootId,
              secondPersonId: cousinId,
              outcome: "did_not_meet",
              status: "accepted",
              reason: "Explicit integration fixture.",
              evidence: sharedEvidence(
                "Shared Fact Source",
                "The fixture explicitly records the family facts.",
                "The root did not meet the cousin.",
              ),
            },
          ],
        },
      })

      expect(encounterBatch.isError).not.toBe(true)
      expect(encounterBatch.structuredContent).toMatchObject({
        total: 2,
        succeeded: 2,
        failed: 0,
      })

      const facts = await client.callTool({
        name: "get_person_facts_batch",
        arguments: {
          personIds: [uncleId, auntId, cousinId],
          encounterWithPersonId: rootId,
        },
      })

      expect(facts.isError).not.toBe(true)
      expect(facts.structuredContent).toMatchObject({
        encounterWithPersonId: rootId,
        items: [
          {
            personId: uncleId,
            religionAtDeath: { conclusion: "muslim" },
            encounterWith: { conclusion: "met" },
          },
          {
            personId: auntId,
            religionAtDeath: { conclusion: "unknown" },
            encounterWith: { conclusion: "unknown" },
          },
          {
            personId: cousinId,
            religionAtDeath: { conclusion: "muslim" },
            encounterWith: { conclusion: "did_not_meet" },
          },
        ],
      })

      const audit = await client.callTool({
        name: "audit_family_facts",
        arguments: {
          rootPersonId: rootId,
          sides: ["paternal"],
          relationshipStatuses: ["accepted"],
        },
      })

      expect(audit.isError).not.toBe(true)
      expect(audit.structuredContent).toMatchObject({
        summary: {
          totalMembers: 3,
          byRole: {
            paternal_uncle: 1,
            paternal_aunt: 1,
            paternal_cousin: 1,
          },
          religionKnown: 2,
          religionUnknown: 1,
          encounterKnown: 2,
          encounterUnknown: 1,
        },
        members: expect.arrayContaining([
          expect.objectContaining({
            role: "paternal_uncle",
            person: expect.objectContaining({ entityId: uncleId }),
          }),
          expect.objectContaining({
            role: "paternal_aunt",
            person: expect.objectContaining({ entityId: auntId }),
          }),
          expect.objectContaining({
            role: "paternal_cousin",
            person: expect.objectContaining({ entityId: cousinId }),
          }),
        ]),
      })

      const sql = new SQL(databaseUrl)

      try {
        const [{ sourceCount }] = await sql<[{ sourceCount: number }]>`
          select count(*)::int as "sourceCount" from sources
        `
        const [{ passageCount }] = await sql<[{ passageCount: number }]>`
          select count(*)::int as "passageCount" from source_passages
        `

        expect(sourceCount).toBe(2)
        expect(passageCount).toBe(2)
      } finally {
        await sql.close({ timeout: 1 })
      }
    } finally {
      await client.close()
    }
  },
  60_000,
)
