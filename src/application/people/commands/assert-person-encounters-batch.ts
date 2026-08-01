import { IdempotencyConflictError, PeopleInputError } from "../shared/errors"
import type {
  AssertPersonEncountersBatchInput,
  AssertPersonEncountersBatchResult,
} from "../shared/types"
import { assertPersonEncounter } from "./assert-person-encounter"

export async function assertPersonEncountersBatch(
  input: AssertPersonEncountersBatchInput,
): Promise<AssertPersonEncountersBatchResult> {
  if (input.assertions.length === 0 || input.assertions.length > 100) {
    throw new PeopleInputError(
      "assertions must contain between 1 and 100 items.",
    )
  }

  const items: AssertPersonEncountersBatchResult["items"] = []

  for (const [index, assertion] of input.assertions.entries()) {
    try {
      items.push({
        index,
        operationKey: assertion.operationKey,
        status: "succeeded",
        result: await assertPersonEncounter(assertion),
      })
    } catch (error) {
      if (
        !(error instanceof PeopleInputError) &&
        !(error instanceof IdempotencyConflictError)
      ) {
        throw error
      }

      items.push({
        index,
        operationKey: assertion.operationKey,
        status: "failed",
        error: error.message,
      })
    }
  }

  const succeeded = items.filter(({ status }) => status === "succeeded").length
  return {
    total: items.length,
    succeeded,
    failed: items.length - succeeded,
    items,
  }
}
