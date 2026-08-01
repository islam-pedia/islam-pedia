import { PeopleInputError } from "../shared/errors"
import { requireCleanText } from "../shared/helpers"
import type {
  GetPersonFactsBatchInput,
  GetPersonFactsBatchResult,
} from "../shared/types"
import { getPerson } from "./get-person"
import { getPersonEncounters } from "./get-person-encounters"
import { getPersonReligionAtDeath } from "./get-person-religion-at-death"

export async function getPersonFactsBatch(
  input: GetPersonFactsBatchInput,
): Promise<GetPersonFactsBatchResult> {
  if (input.personIds.length === 0 || input.personIds.length > 100) {
    throw new PeopleInputError("personIds must contain between 1 and 100 IDs.")
  }

  const personIds = input.personIds.map((personId, index) =>
    requireCleanText(personId, `personIds[${index}]`, 100),
  )
  const encounterWithPersonId = input.encounterWithPersonId
    ? requireCleanText(
        input.encounterWithPersonId,
        "encounterWithPersonId",
        100,
      )
    : undefined

  if (encounterWithPersonId && !(await getPerson(encounterWithPersonId))) {
    throw new PeopleInputError(
      `Encounter target person "${encounterWithPersonId}" was not found.`,
    )
  }

  const items: GetPersonFactsBatchResult["items"] = []

  for (const personId of personIds) {
    const person = await getPerson(personId)

    if (!person) {
      items.push({
        personId,
        found: false,
        person: null,
        religionAtDeath: null,
        encounterWith: null,
      })
      continue
    }

    const religionAtDeath = await getPersonReligionAtDeath(personId)
    let encounterWith: GetPersonFactsBatchResult["items"][number]["encounterWith"] =
      null

    if (encounterWithPersonId) {
      const encounterResult = await getPersonEncounters(personId)
      const encounter = encounterResult?.encounters.find(
        ({ otherPerson }) => otherPerson.entityId === encounterWithPersonId,
      )
      encounterWith = {
        personId: encounterWithPersonId,
        conclusion: encounter?.conclusion ?? "unknown",
        assertions: encounter?.assertions ?? [],
      }
    }

    items.push({
      personId,
      found: true,
      person,
      religionAtDeath,
      encounterWith,
    })
  }

  return {
    encounterWithPersonId: encounterWithPersonId ?? null,
    items,
  }
}
