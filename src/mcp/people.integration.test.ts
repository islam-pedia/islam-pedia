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
            nameOriginal: "عَبْدُ ٱللَّٰهِ بْنُ أَبِي قُحَافَةَ",
            nameLatin: "Abdullah ibn Abi Quhafah",
            gender: "male",
            nameType: "nasab",
            names: [
              {
                type: "kunyah",
                nameOriginal: "أَبُو بَكْرٍ",
                nameLatin: "Abu Bakar",
              },
              {
                type: "nasab",
                nameOriginal: "عَبْدُ ٱللَّٰهِ بْنُ عُثْمَانَ",
                nameLatin: "Abdullah ibn Uthman",
              },
            ],
            keywords: ["Abd Allah", "Ibnu Abi Quhafah", uniqueSearchTerm],
          },
          {
            nameOriginal: "عَائِشَة بِنْت أَبِي بَكْرٍ",
            nameLatin: "Aisyah bint Abu Bakar",
            gender: "female",
            keywords: ["Aisha"],
          },
          {
            nameOriginal: "أُمُّ رُومَان",
            nameLatin: "Ummu Ruman",
            gender: "unknown",
            keywords: [],
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
        people: Array<{ entityId: string; gender: string }>
      }
      const entityId = importedContent.people[0]?.entityId
      const aisyahId = importedContent.people[1]?.entityId
      const ummuRumanId = importedContent.people[2]?.entityId

      if (!entityId || !aisyahId || !ummuRumanId) {
        throw new Error("Integration import did not return all person IDs.")
      }

      expect(importedContent.replayed).toBe(false)
      expect(entityId).toBeString()
      expect(aisyahId).toBeString()
      expect(ummuRumanId).toBeString()
      expect(importedContent.people.map(({ gender }) => gender)).toEqual([
        "male",
        "female",
        "unknown",
      ])

      const replayed = await client.callTool({
        name: "import_people",
        arguments: importInput,
      })

      expect(replayed.isError).not.toBe(true)
      expect(
        (replayed.structuredContent as { replayed: boolean }).replayed,
      ).toBe(true)

      const genderInput = {
        operationKey: `integration-gender-${testId}`,
        entityId: ummuRumanId,
        gender: "female",
        reason: "Integration fixture records Ummu Ruman as female.",
      } as const
      const genderResult = await client.callTool({
        name: "set_person_gender",
        arguments: genderInput,
      })

      expect(genderResult.isError).not.toBe(true)
      expect(genderResult.structuredContent).toMatchObject({
        replayed: false,
        entityId: ummuRumanId,
        previousGender: "unknown",
        gender: "female",
        changed: true,
        genderChangeId: expect.any(String),
      })

      const replayedGender = await client.callTool({
        name: "set_person_gender",
        arguments: genderInput,
      })

      expect(replayedGender.isError).not.toBe(true)
      expect(replayedGender.structuredContent).toMatchObject({
        replayed: true,
        previousGender: "unknown",
        gender: "female",
        changed: true,
      })

      const relationshipEvidence = (label: string, assertion: string) =>
        [
          {
            source: {
              category: "salaf_report",
              label,
              uri: `https://example.test/${label.toLowerCase().replaceAll(" ", "-")}`,
              author: "Test Genealogist",
              workTitle: "Test Genealogy",
              edition: "Test Edition",
              methodologyBasis:
                "Synthetic Salaf report fixture for relationship testing.",
            },
            passage: assertion,
            language: "en",
            locator: {
              page: "1",
              section: "Relationship fixture",
            },
            assertion,
            interpretation: "explicit",
            notes: "Synthetic evidence used only by the integration test.",
          },
        ] as const

      const fatherRelationshipInput = {
        operationKey: `integration-father-${testId}`,
        fromPersonId: entityId,
        toPersonId: aisyahId,
        type: "biological_parent_of",
        status: "accepted",
        reason: "Explicit genealogy fixture.",
        evidence: relationshipEvidence(
          "Father Relationship Source",
          "Abu Bakar is explicitly identified as Aisyah's father.",
        ),
      } as const
      const fatherRelationship = await client.callTool({
        name: "add_person_relationship",
        arguments: fatherRelationshipInput,
      })

      expect(fatherRelationship.isError).not.toBe(true)
      expect(fatherRelationship.structuredContent).toMatchObject({
        replayed: false,
        created: true,
        status: "accepted",
        relationshipId: expect.any(String),
        evidenceIds: [expect.any(String)],
        statusChangeId: expect.any(String),
      })

      const replayedFatherRelationship = await client.callTool({
        name: "add_person_relationship",
        arguments: fatherRelationshipInput,
      })

      expect(replayedFatherRelationship.isError).not.toBe(true)
      expect(replayedFatherRelationship.structuredContent).toMatchObject({
        replayed: true,
        created: true,
        status: "accepted",
      })

      const motherRelationship = await client.callTool({
        name: "add_person_relationship",
        arguments: {
          operationKey: `integration-mother-${testId}`,
          fromPersonId: ummuRumanId,
          toPersonId: aisyahId,
          type: "biological_parent_of",
          status: "accepted",
          reason: "Explicit genealogy fixture.",
          evidence: relationshipEvidence(
            "Mother Relationship Source",
            "Ummu Ruman is explicitly identified as Aisyah's mother.",
          ),
        },
      })

      expect(motherRelationship.isError).not.toBe(true)

      const marriageRelationship = await client.callTool({
        name: "add_person_relationship",
        arguments: {
          operationKey: `integration-husband-${testId}`,
          fromPersonId: entityId,
          toPersonId: ummuRumanId,
          type: "husband_of",
          status: "accepted",
          reason: "Explicit marriage fixture.",
          evidence: relationshipEvidence(
            "Marriage Relationship Source",
            "Abu Bakar is explicitly identified as Ummu Ruman's husband.",
          ),
        },
      })

      expect(marriageRelationship.isError).not.toBe(true)

      const invalidMarriageDirection = await client.callTool({
        name: "add_person_relationship",
        arguments: {
          operationKey: `integration-invalid-husband-${testId}`,
          fromPersonId: ummuRumanId,
          toPersonId: entityId,
          type: "husband_of",
          status: "accepted",
          reason: "Invalid direction fixture.",
          evidence: relationshipEvidence(
            "Invalid Marriage Source",
            "This fixture intentionally uses the wrong direction.",
          ),
        },
      })

      expect(invalidMarriageDirection.isError).toBe(true)

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

      const searchedByKunyah = await client.callTool({
        name: "search_people",
        arguments: { query: "Abu Bakar", limit: 10 },
      })

      expect(searchedByKunyah.isError).not.toBe(true)
      expect(
        (
          searchedByKunyah.structuredContent as {
            people: Array<{ entityId: string }>
          }
        ).people[0]?.entityId,
      ).toBe(entityId)

      const addedNames = await client.callTool({
        name: "add_person_names",
        arguments: {
          operationKey: `integration-names-${testId}`,
          entityId,
          names: [
            {
              type: "laqab",
              nameOriginal: "ٱلصِّدِّيق",
              nameLatin: "As-Siddiq",
            },
          ],
        },
      })

      expect(addedNames.isError).not.toBe(true)
      expect(
        (
          addedNames.structuredContent as {
            addedNames: Array<{ type: string; nameLatin: string }>
          }
        ).addedNames,
      ).toEqual([
        expect.objectContaining({
          type: "laqab",
          nameLatin: "As-Siddiq",
        }),
      ])

      const replayedNames = await client.callTool({
        name: "add_person_names",
        arguments: {
          operationKey: `integration-names-${testId}`,
          entityId,
          names: [
            {
              type: "laqab",
              nameOriginal: "ٱلصِّدِّيق",
              nameLatin: "As-Siddiq",
            },
          ],
        },
      })

      expect(replayedNames.isError).not.toBe(true)
      expect(
        (
          replayedNames.structuredContent as {
            replayed: boolean
            addedNames: Array<{ type: string; nameLatin: string }>
          }
        ).replayed,
      ).toBe(true)
      expect(
        (
          replayedNames.structuredContent as {
            addedNames: Array<{ type: string; nameLatin: string }>
          }
        ).addedNames,
      ).toEqual([
        expect.objectContaining({
          type: "laqab",
          nameLatin: "As-Siddiq",
        }),
      ])

      const primaryNameInput = {
        operationKey: `integration-primary-name-${testId}`,
        entityId,
        name: {
          type: "nasab",
          nameOriginal: "عَبْدُ ٱللَّٰهِ بْنُ عُثْمَانَ",
          nameLatin: "Abdullah ibn Uthman",
        },
        reason: "Use the existing ism-based nasab as the display name.",
      } as const
      const primaryNameResult = await client.callTool({
        name: "set_person_primary_name",
        arguments: primaryNameInput,
      })

      expect(primaryNameResult.isError).not.toBe(true)
      expect(primaryNameResult.structuredContent).toMatchObject({
        replayed: false,
        entityId,
        previousPrimaryName: {
          nameLatin: "Abdullah ibn Abi Quhafah",
          isPrimary: true,
        },
        primaryName: {
          type: "nasab",
          nameLatin: "Abdullah ibn Uthman",
          isPrimary: true,
        },
        changed: true,
        primaryNameChangeId: expect.any(String),
      })

      const replayedPrimaryName = await client.callTool({
        name: "set_person_primary_name",
        arguments: primaryNameInput,
      })

      expect(replayedPrimaryName.isError).not.toBe(true)
      expect(replayedPrimaryName.structuredContent).toMatchObject({
        replayed: true,
        entityId,
        previousPrimaryName: {
          nameLatin: "Abdullah ibn Abi Quhafah",
        },
        primaryName: {
          type: "nasab",
          nameLatin: "Abdullah ibn Uthman",
        },
        changed: true,
        primaryNameChangeId: expect.any(String),
      })

      const personAfterPrimaryNameChange = await client.callTool({
        name: "get_person",
        arguments: { entityId },
      })

      expect(personAfterPrimaryNameChange.isError).not.toBe(true)
      expect(personAfterPrimaryNameChange.structuredContent).toMatchObject({
        person: {
          entityId,
          nameOriginal: "عَبْدُ ٱللَّٰهِ بْنُ عُثْمَانَ",
          nameLatin: "Abdullah ibn Uthman",
          names: expect.arrayContaining([
            expect.objectContaining({
              nameLatin: "Abdullah ibn Uthman",
              isPrimary: true,
            }),
            expect.objectContaining({
              nameLatin: "Abdullah ibn Abi Quhafah",
              isPrimary: false,
            }),
          ]),
        },
      })

      const rejectedKunyahPrimary = await client.callTool({
        name: "set_person_primary_name",
        arguments: {
          operationKey: `integration-invalid-primary-kunyah-${testId}`,
          entityId,
          name: {
            type: "kunyah",
            nameOriginal: "أَبُو بَكْرٍ",
            nameLatin: "Abu Bakar",
          },
          reason: "This request intentionally violates the naming policy.",
        },
      })

      expect(rejectedKunyahPrimary.isError).toBe(true)

      const searchedByLaqab = await client.callTool({
        name: "search_people",
        arguments: { query: "As-Siddiq", limit: 10 },
      })

      expect(searchedByLaqab.isError).not.toBe(true)
      expect(
        (
          searchedByLaqab.structuredContent as {
            people: Array<{ entityId: string }>
          }
        ).people[0]?.entityId,
      ).toBe(entityId)

      const added = await client.callTool({
        name: "add_person_keywords",
        arguments: {
          operationKey: `integration-keywords-${testId}`,
          entityId,
          keywords: ["Abu Bakr", "Al-Siddiq"],
        },
      })

      expect(added.isError).not.toBe(true)
      expect(
        (added.structuredContent as { addedKeywords: string[] }).addedKeywords,
      ).toEqual(["Abu Bakr", "Al-Siddiq"])

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
      const fetchedPerson = (
        fetched.structuredContent as {
          person: {
            status: string
            gender: string
            keywords: string[]
            names: Array<{
              type: string
              nameLatin: string
              isPrimary: boolean
            }>
          }
        }
      ).person

      expect(fetchedPerson.status).toBe("active")
      expect(fetchedPerson.gender).toBe("male")
      expect(fetchedPerson.names).toHaveLength(4)
      expect(fetchedPerson.names).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "nasab",
            nameLatin: "Abdullah ibn Uthman",
            isPrimary: true,
          }),
          expect.objectContaining({
            type: "nasab",
            nameLatin: "Abdullah ibn Abi Quhafah",
            isPrimary: false,
          }),
          expect.objectContaining({
            type: "kunyah",
            nameLatin: "Abu Bakar",
            isPrimary: false,
          }),
          expect.objectContaining({
            type: "laqab",
            nameLatin: "As-Siddiq",
            isPrimary: false,
          }),
        ]),
      )
      expect(fetchedPerson.keywords).toContain("Abu Bakr")
      expect(fetchedPerson.keywords).toContain("Al-Siddiq")
      expect(fetchedPerson.keywords).toContain("Abd Allah")
      expect(fetchedPerson.keywords).toContain("Ibnu Abi Quhafah")
      expect(fetchedPerson.keywords).toContain(uniqueSearchTerm)

      const aisyahRelationshipsResult = await client.callTool({
        name: "get_person_relationships",
        arguments: { entityId: aisyahId },
      })

      expect(aisyahRelationshipsResult.isError).not.toBe(true)
      const aisyahRelationships = (
        aisyahRelationshipsResult.structuredContent as {
          relationships: Array<{
            type: string
            direction: string
            label: string
            relatedPerson: { entityId: string }
            evidence: unknown[]
            statusHistory: unknown[]
          }>
        }
      ).relationships

      expect(
        aisyahRelationships.map(
          ({ type, direction, label, relatedPerson }) => ({
            type,
            direction,
            label,
            relatedPersonId: relatedPerson.entityId,
          }),
        ),
      ).toEqual([
        {
          type: "biological_parent_of",
          direction: "incoming",
          label: "father",
          relatedPersonId: entityId,
        },
        {
          type: "biological_parent_of",
          direction: "incoming",
          label: "mother",
          relatedPersonId: ummuRumanId,
        },
      ])
      expect(aisyahRelationships[0]?.evidence).toHaveLength(1)
      expect(aisyahRelationships[0]?.statusHistory).toHaveLength(1)

      const abuBakarRelationshipsResult = await client.callTool({
        name: "get_person_relationships",
        arguments: { entityId },
      })

      expect(abuBakarRelationshipsResult.isError).not.toBe(true)
      expect(
        (
          abuBakarRelationshipsResult.structuredContent as {
            relationships: Array<{ type: string; label: string }>
          }
        ).relationships.map(({ type, label }) => ({ type, label })),
      ).toEqual([
        { type: "biological_parent_of", label: "daughter" },
        { type: "husband_of", label: "wife" },
      ])

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
