import { expect, test } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js"
import { resetTestDatabase } from "@/testing/reset-test-database"

const integrationTest = Bun.env.TEST_DATABASE_URL ? test : test.skip

integrationTest(
  "imports, audits, and traverses a family branch",
  async () => {
    const databaseUrl = Bun.env.TEST_DATABASE_URL
    const testId = crypto.randomUUID()

    if (!databaseUrl) {
      throw new Error("TEST_DATABASE_URL is required for integration tests.")
    }

    await resetTestDatabase(databaseUrl)

    const client = new Client({
      name: "islam-pedia-family-tools-integration-test-client",
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

      const initialPeople = await client.callTool({
        name: "import_people",
        arguments: {
          batchKey: `family-tools-fixture-${testId}`,
          people: [
            {
              nameOriginal: "الأصل بن الجد",
              nameLatin: "Al-Asl ibn al-Jadd",
              nameType: "nasab",
              gender: "male",
            },
            {
              nameOriginal: "الموجود بن الأصل",
              nameLatin: "Al-Mawjud ibn al-Asl",
              nameType: "nasab",
              gender: "male",
            },
            {
              nameOriginal: "غير الموصول بن الأصل",
              nameLatin: "Ghayr al-Mawsul ibn al-Asl",
              nameType: "nasab",
              gender: "male",
            },
            {
              nameOriginal: "الأم بنت الجد",
              nameLatin: "Al-Umm bint al-Jadd",
              nameType: "nasab",
              gender: "female",
            },
          ],
        },
      })

      expect(initialPeople.isError).not.toBe(true)

      const initialContent = initialPeople.structuredContent as {
        people: Array<{ entityId: string }>
      }
      const rootPersonId = initialContent.people[0]?.entityId
      const existingChildId = initialContent.people[1]?.entityId
      const unlinkedPersonId = initialContent.people[2]?.entityId
      const motherPersonId = initialContent.people[3]?.entityId

      if (
        !rootPersonId ||
        !existingChildId ||
        !unlinkedPersonId ||
        !motherPersonId
      ) {
        throw new Error("Family fixture did not return all person IDs.")
      }

      const evidence = (assertion: string) => [
        {
          source: {
            category: "salaf_report",
            label: "Family Tool Integration Genealogy",
            author: "Integration Genealogist",
            workTitle: "Integration Genealogy",
            methodologyBasis:
              "Synthetic explicit genealogy fixture for integration testing.",
          },
          passage: assertion,
          language: "en",
          locator: {
            page: "1",
            section: "Direct children",
          },
          assertion,
          interpretation: "explicit",
        },
      ]
      const familyImportInput = {
        operationKey: `family-tools-import-${testId}`,
        rootPersonId,
        instruction: "Import a direct child branch.",
        members: [
          {
            existingPersonId: existingChildId,
            relationship: {
              type: "biological_parent_of",
              direction: "outgoing",
              status: "accepted",
              reason: "Explicit test genealogy.",
              evidence: evidence(
                "Al-Asl is explicitly the father of Al-Mawjud.",
              ),
            },
          },
          {
            person: {
              nameOriginal: "الجديد بن الأصل",
              nameLatin: "Al-Jadid ibn al-Asl",
              nameType: "nasab",
              gender: "male",
            },
            relationship: {
              type: "biological_parent_of",
              direction: "outgoing",
              status: "accepted",
              reason: "Explicit test genealogy.",
              evidence: evidence(
                "Al-Asl is explicitly the father of Al-Jadid.",
              ),
            },
          },
        ],
      } as const
      const familyImport = await client.callTool({
        name: "import_family_branch",
        arguments: familyImportInput,
      })

      expect(familyImport.isError).not.toBe(true)
      expect(familyImport.structuredContent).toMatchObject({
        replayed: false,
        rootPersonId,
        peopleRunId: expect.any(String),
        members: [
          {
            index: 0,
            created: false,
            person: { entityId: existingChildId },
            relationship: {
              replayed: false,
              created: true,
              status: "accepted",
            },
          },
          {
            index: 1,
            created: true,
            relationship: {
              replayed: false,
              created: true,
              status: "accepted",
            },
          },
        ],
      })

      const replayedImport = await client.callTool({
        name: "import_family_branch",
        arguments: familyImportInput,
      })

      expect(replayedImport.isError).not.toBe(true)
      expect(replayedImport.structuredContent).toMatchObject({
        replayed: true,
        members: [
          { relationship: { replayed: true } },
          { relationship: { replayed: true } },
        ],
      })

      const familyTree = await client.callTool({
        name: "get_family_tree",
        arguments: {
          rootPersonId,
          maxDepth: 1,
          relationshipTypes: ["biological_parent_of"],
          statuses: ["accepted"],
        },
      })

      expect(familyTree.isError).not.toBe(true)

      const treeContent = familyTree.structuredContent as {
        truncated: boolean
        nodes: Array<{ depth: number; person: { entityId: string } }>
        edges: Array<{ type: string; fromPersonId: string }>
      }

      expect(treeContent.truncated).toBe(false)
      expect(treeContent.nodes).toHaveLength(3)
      expect(treeContent.nodes).toContainEqual(
        expect.objectContaining({
          depth: 0,
          person: expect.objectContaining({ entityId: rootPersonId }),
        }),
      )
      expect(treeContent.edges).toHaveLength(2)
      expect(treeContent.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "biological_parent_of",
            fromPersonId: rootPersonId,
          }),
        ]),
      )

      const audit = await client.callTool({
        name: "audit_family_branch",
        arguments: {
          rootPersonId,
          relationshipType: "biological_parent_of",
          direction: "outgoing",
          sourceMembers: [
            {
              nameOriginal: "الموجود بن الأصل",
              nameLatin: "Al-Mawjud ibn al-Asl",
            },
            {
              nameOriginal: "غير الموصول بن الأصل",
              nameLatin: "Ghayr al-Mawsul ibn al-Asl",
            },
            {
              nameOriginal: "المفقود بن الأصل",
              nameLatin: "Al-Mafqud ibn al-Asl",
            },
          ],
        },
      })

      expect(audit.isError).not.toBe(true)

      const auditContent = audit.structuredContent as {
        matched: Array<{ person: { entityId: string } }>
        unlinked: Array<{ candidates: Array<{ entityId: string }> }>
        missing: unknown[]
        ambiguous: unknown[]
        databaseOnly: Array<{ relatedPerson: { entityId: string } }>
      }

      expect(auditContent.matched).toEqual([
        expect.objectContaining({
          person: expect.objectContaining({ entityId: existingChildId }),
        }),
      ])
      expect(auditContent.unlinked).toEqual([
        expect.objectContaining({
          candidates: [expect.objectContaining({ entityId: unlinkedPersonId })],
        }),
      ])
      expect(auditContent.missing).toHaveLength(1)
      expect(auditContent.ambiguous).toHaveLength(0)
      expect(auditContent.databaseOnly).toHaveLength(1)

      const motherRelationship = await client.callTool({
        name: "import_family_branch",
        arguments: {
          operationKey: `spouse-coverage-mother-${testId}`,
          rootPersonId: motherPersonId,
          members: [
            {
              existingPersonId: existingChildId,
              relationship: {
                type: "biological_parent_of",
                direction: "outgoing",
                status: "accepted",
                reason: "Explicit test genealogy.",
                evidence: evidence(
                  "Al-Umm is explicitly the mother of Al-Mawjud.",
                ),
              },
            },
          ],
        },
      })

      expect(motherRelationship.isError).not.toBe(true)

      const missingSpouseAudit = await client.callTool({
        name: "audit_spouse_coverage",
        arguments: {
          coverageStatuses: ["missing"],
        },
      })

      expect(missingSpouseAudit.isError).not.toBe(true)
      expect(missingSpouseAudit.structuredContent).toMatchObject({
        matchingPairs: 1,
        returnedPairs: 1,
        hasMore: false,
        summary: {
          biologicalParentRelationships: 3,
          childrenWithBothParentGenders: 1,
          coParentPairs: 1,
          accepted: 0,
          missing: 1,
        },
        pairs: [
          {
            coverage: "missing",
            maleParent: { entityId: rootPersonId },
            femaleParent: { entityId: motherPersonId },
            spouseRelationship: null,
            sharedChildren: [
              {
                child: { entityId: existingChildId },
                maleParentRelationship: {
                  type: "biological_parent_of",
                  status: "accepted",
                  evidence: [expect.objectContaining({})],
                },
                femaleParentRelationship: {
                  type: "biological_parent_of",
                  status: "accepted",
                  evidence: [expect.objectContaining({})],
                },
              },
            ],
          },
        ],
      })

      const spouseRelationship = await client.callTool({
        name: "add_person_relationship",
        arguments: {
          operationKey: `spouse-coverage-husband-${testId}`,
          fromPersonId: rootPersonId,
          toPersonId: motherPersonId,
          type: "husband_of",
          status: "accepted",
          reason: "Explicit test marriage.",
          evidence: evidence("Al-Asl is explicitly the husband of Al-Umm."),
        },
      })

      expect(spouseRelationship.isError).not.toBe(true)

      const coveredSpouseAudit = await client.callTool({
        name: "audit_spouse_coverage",
        arguments: {
          coverageStatuses: ["accepted"],
          limit: 1,
        },
      })

      expect(coveredSpouseAudit.isError).not.toBe(true)
      expect(coveredSpouseAudit.structuredContent).toMatchObject({
        matchingPairs: 1,
        returnedPairs: 1,
        hasMore: false,
        summary: {
          coParentPairs: 1,
          accepted: 1,
          missing: 0,
        },
        pairs: [
          {
            coverage: "accepted",
            spouseRelationship: {
              type: "husband_of",
              status: "accepted",
              fromPerson: { entityId: rootPersonId },
              toPerson: { entityId: motherPersonId },
              evidence: [expect.objectContaining({})],
            },
          },
        ],
      })
    } finally {
      await client.close()
    }
  },
  30_000,
)
