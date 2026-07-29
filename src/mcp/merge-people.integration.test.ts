import { expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js"
import { resetTestDatabase } from "@/testing/reset-test-database"

const integrationTest = Bun.env.TEST_DATABASE_URL ? test : test.skip

integrationTest(
  "batch-searches and atomically merges duplicate people",
  async () => {
    const databaseUrl = Bun.env.TEST_DATABASE_URL
    const testId = crypto.randomUUID()

    if (!databaseUrl) {
      throw new Error("TEST_DATABASE_URL is required for integration tests.")
    }

    await resetTestDatabase(databaseUrl)

    const client = new Client({
      name: "islam-pedia-merge-integration-test-client",
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

    const evidence = (prefix: string) =>
      [
        {
          source: {
            category: "salafiyyun_scholar",
            label: `${prefix} One`,
            author: "Test Author One",
            workTitle: "Test Work One",
            methodologyBasis:
              "Synthetic independent Sunni genealogy fixture for merge testing.",
          },
          passage: `${prefix} explicitly identifies both rendered names as the same person.`,
          language: "en",
          locator: { page: "1", section: "Identity" },
          assertion:
            "The duplicate and canonical records identify the same person.",
          interpretation: "explicit",
        },
        {
          source: {
            category: "salaf_report",
            label: `${prefix} Two`,
            author: "Test Author Two",
            workTitle: "Test Work Two",
            methodologyBasis:
              "Synthetic independent Salaf report fixture for merge testing.",
          },
          passage: `${prefix} independently identifies both rendered names as the same person.`,
          language: "en",
          locator: { page: "2", section: "Identity" },
          assertion:
            "An independent report identifies the duplicate and canonical records as one person.",
          interpretation: "explicit",
        },
      ] as const

    const relationshipEvidence = (label: string) =>
      [
        {
          source: {
            category: "salaf_report",
            label,
            author: "Test Genealogist",
            workTitle: "Test Genealogy",
            methodologyBasis:
              "Synthetic explicit genealogy fixture for relationship merge testing.",
          },
          passage: `${label} explicitly states the parent-child relationship.`,
          language: "en",
          locator: { page: "3", section: "Family" },
          assertion: "The source explicitly states this biological parent.",
          interpretation: "explicit",
        },
      ] as const

    try {
      await client.connect(transport)

      const imported = await client.callTool({
        name: "import_people",
        arguments: {
          batchKey: `merge-people-fixture-${testId}`,
          people: [
            {
              nameOriginal: "صفية بنت ذكوان بن أمية",
              nameLatin: "Safiyyah bint Dhakwan ibn Umayyah",
              nameType: "nasab",
              gender: "female",
              names: [
                {
                  type: "personal",
                  nameOriginal: "صفية",
                  nameLatin: "Safiyyah",
                },
                {
                  type: "kunyah",
                  nameOriginal: "أم قتال",
                  nameLatin: "Umm Qital",
                },
                {
                  type: "nasab",
                  nameOriginal: "صفية بنت أبي عمرو بن أمية",
                  nameLatin: "Safiyyah bint Abi Amr ibn Umayyah",
                },
              ],
              keywords: ["shared-merge-keyword"],
            },
            {
              nameOriginal: "صفية بنت أبي عمرو بن أمية",
              nameLatin: "Safiyyah bint Abi Amr ibn Umayyah",
              nameType: "nasab",
              gender: "unknown",
              names: [
                {
                  type: "personal",
                  nameOriginal: "صفية",
                  nameLatin: "Safiyyah",
                },
                {
                  type: "kunyah",
                  nameOriginal: "أم قتال",
                  nameLatin: "Umm Qital",
                },
              ],
              keywords: ["shared-merge-keyword", `duplicate-only-${testId}`],
            },
            {
              nameOriginal: "عمرو بن صخر",
              nameLatin: "Amr ibn Sakhr",
              nameType: "nasab",
              gender: "male",
            },
            {
              nameOriginal: "هند بنت صخر",
              nameLatin: "Hind bint Sakhr",
              nameType: "nasab",
              gender: "female",
            },
          ],
        },
      })

      expect(imported.isError).not.toBe(true)
      const importedPeople = (
        imported.structuredContent as {
          people: Array<{ entityId: string }>
        }
      ).people
      const canonicalPersonId = importedPeople[0]?.entityId
      const duplicatePersonId = importedPeople[1]?.entityId
      const amrId = importedPeople[2]?.entityId
      const hindId = importedPeople[3]?.entityId

      if (!canonicalPersonId || !duplicatePersonId || !amrId || !hindId) {
        throw new Error("Merge fixture did not return all person IDs.")
      }

      const genderChanged = await client.callTool({
        name: "set_person_gender",
        arguments: {
          operationKey: `merge-duplicate-gender-${testId}`,
          entityId: duplicatePersonId,
          gender: "female",
          reason: "Synthetic fixture confirms the duplicate is female.",
        },
      })
      expect(genderChanged.isError).not.toBe(true)

      const primaryNameChanged = await client.callTool({
        name: "set_person_primary_name",
        arguments: {
          operationKey: `merge-duplicate-primary-name-${testId}`,
          entityId: duplicatePersonId,
          name: {
            type: "nasab",
            nameOriginal: "صفية بنت أبي عمرو بن أمية بن عبد شمس",
            nameLatin: "Safiyyah bint Abi Amr ibn Umayyah ibn Abd Shams",
          },
          reason:
            "Synthetic fixture creates primary-name history before the merge.",
        },
      })
      expect(primaryNameChanged.isError).not.toBe(true)

      const activated = await client.callTool({
        name: "activate_person",
        arguments: {
          operationKey: `merge-duplicate-activation-${testId}`,
          entityId: duplicatePersonId,
          reason: "Two synthetic independent sources identify the person.",
          evidence: evidence("Activation Fixture"),
        },
      })
      expect(activated.isError).not.toBe(true)

      for (const relationship of [
        {
          operationKey: `merge-canonical-amr-${testId}`,
          fromPersonId: canonicalPersonId,
          toPersonId: amrId,
          label: "Canonical Amr",
        },
        {
          operationKey: `merge-duplicate-amr-${testId}`,
          fromPersonId: duplicatePersonId,
          toPersonId: amrId,
          label: "Duplicate Amr",
        },
        {
          operationKey: `merge-duplicate-hind-${testId}`,
          fromPersonId: duplicatePersonId,
          toPersonId: hindId,
          label: "Duplicate Hind",
        },
      ]) {
        const result = await client.callTool({
          name: "add_person_relationship",
          arguments: {
            operationKey: relationship.operationKey,
            fromPersonId: relationship.fromPersonId,
            toPersonId: relationship.toPersonId,
            type: "biological_parent_of",
            status: "accepted",
            reason: "Synthetic explicit family fixture.",
            evidence: relationshipEvidence(relationship.label),
          },
        })
        expect(result.isError).not.toBe(true)
      }

      const batchSearch = await client.callTool({
        name: "search_people_batch",
        arguments: {
          queries: [
            "Safiyyah bint Dhakwan ibn Umayyah",
            "Safiyyah bint Abi Amr ibn Umayyah",
          ],
          limitPerQuery: 5,
        },
      })

      expect(batchSearch.isError).not.toBe(true)
      expect(
        (
          batchSearch.structuredContent as {
            results: Array<{ query: string; count: number }>
          }
        ).results,
      ).toEqual([
        expect.objectContaining({
          query: "Safiyyah bint Dhakwan ibn Umayyah",
          count: expect.any(Number),
        }),
        expect.objectContaining({
          query: "Safiyyah bint Abi Amr ibn Umayyah",
          count: expect.any(Number),
        }),
      ])

      const staleNameMerge = await client.callTool({
        name: "merge_people",
        arguments: {
          operationKey: `merge-people-stale-name-${testId}`,
          duplicatePersonId,
          canonicalPersonId,
          expectedDuplicateNameOriginal: "صفية بنت شخص آخر",
          expectedCanonicalNameOriginal: "صفية بنت ذكوان بن أمية",
          reason: "This request intentionally uses a stale expected name.",
          evidence: evidence("Stale Name Fixture"),
        },
      })
      expect(staleNameMerge.isError).toBe(true)

      const mergeInput = {
        operationKey: `merge-people-${testId}`,
        duplicatePersonId,
        canonicalPersonId,
        expectedDuplicateNameOriginal: "صفية بنت أبي عمرو بن أمية بن عبد شمس",
        expectedCanonicalNameOriginal: "صفية بنت ذكوان بن أمية",
        reason:
          "Two independent sources establish that Abu Amr is the kunyah of Dhakwan.",
        evidence: evidence("Merge Fixture"),
      } as const
      const merged = await client.callTool({
        name: "merge_people",
        arguments: mergeInput,
      })

      expect(merged.isError).not.toBe(true)
      expect(merged.structuredContent).toMatchObject({
        replayed: false,
        duplicatePersonId,
        canonicalPersonId,
        duplicateStatusBefore: "active",
        canonicalStatusBefore: "provisional",
        canonicalStatusAfter: "active",
        canonicalGenderBefore: "female",
        canonicalGenderAfter: "female",
        transferred: {
          names: 1,
          keywords: 1,
          entityEvidence: 2,
          genderChanges: 2,
          primaryNameChanges: 1,
          relationships: 1,
        },
        deduplicated: {
          names: 3,
          keywords: 1,
          relationships: 1,
        },
      })

      const replayed = await client.callTool({
        name: "merge_people",
        arguments: mergeInput,
      })

      expect(replayed.isError).not.toBe(true)
      expect(replayed.structuredContent).toMatchObject({
        replayed: true,
        duplicatePersonId,
        canonicalPersonId,
      })

      const canonicalPerson = await client.callTool({
        name: "get_person",
        arguments: { entityId: canonicalPersonId },
      })
      expect(canonicalPerson.isError).not.toBe(true)
      expect(canonicalPerson.structuredContent).toMatchObject({
        person: {
          entityId: canonicalPersonId,
          status: "active",
          nameOriginal: "صفية بنت ذكوان بن أمية",
          names: expect.arrayContaining([
            expect.objectContaining({
              nameOriginal: "صفية بنت ذكوان بن أمية",
              isPrimary: true,
            }),
            expect.objectContaining({
              nameOriginal: "صفية بنت أبي عمرو بن أمية بن عبد شمس",
              isPrimary: false,
            }),
          ]),
          keywords: expect.arrayContaining([`duplicate-only-${testId}`]),
        },
      })

      const duplicatePerson = await client.callTool({
        name: "get_person",
        arguments: { entityId: duplicatePersonId },
      })
      expect(duplicatePerson.isError).not.toBe(true)
      expect(duplicatePerson.structuredContent).toMatchObject({
        person: {
          entityId: duplicatePersonId,
          status: "merged",
          mergedIntoEntityId: canonicalPersonId,
        },
      })

      const relationships = await client.callTool({
        name: "get_person_relationships",
        arguments: { entityId: canonicalPersonId },
      })
      expect(relationships.isError).not.toBe(true)
      expect(
        (
          relationships.structuredContent as {
            relationships: Array<{ relatedPerson: { entityId: string } }>
          }
        ).relationships.map(({ relatedPerson }) => relatedPerson.entityId),
      ).toEqual(expect.arrayContaining([amrId, hindId]))

      const searchedAfterMerge = await client.callTool({
        name: "search_people_batch",
        arguments: {
          queries: [
            "Safiyyah bint Abi Amr ibn Umayyah",
            `duplicate-only-${testId}`,
          ],
          limitPerQuery: 5,
        },
      })
      expect(searchedAfterMerge.isError).not.toBe(true)
      const postMergeResults = (
        searchedAfterMerge.structuredContent as {
          results: Array<{ people: Array<{ entityId: string }> }>
        }
      ).results
      expect(postMergeResults).toHaveLength(2)
      expect(postMergeResults[0]?.people[0]?.entityId).toBe(canonicalPersonId)
      expect(postMergeResults[1]?.people[0]?.entityId).toBe(canonicalPersonId)
    } finally {
      await client.close()
    }
  },
  30_000,
)
