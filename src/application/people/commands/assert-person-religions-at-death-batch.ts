import { IdempotencyConflictError, PeopleInputError } from "../shared/errors"
import type {
  AssertPersonReligionsAtDeathBatchInput,
  AssertPersonReligionsAtDeathBatchResult,
} from "../shared/types"
import { assertPersonReligionAtDeath } from "./assert-person-religion-at-death"

export async function assertPersonReligionsAtDeathBatch(
  input: AssertPersonReligionsAtDeathBatchInput,
): Promise<AssertPersonReligionsAtDeathBatchResult> {
  if (input.assertions.length === 0 || input.assertions.length > 100) {
    throw new PeopleInputError(
      "assertions must contain between 1 and 100 items.",
    )
  }

  const items: AssertPersonReligionsAtDeathBatchResult["items"] = []

  for (const [index, assertion] of input.assertions.entries()) {
    try {
      items.push({
        index,
        operationKey: assertion.operationKey,
        status: "succeeded",
        result: await assertPersonReligionAtDeath(assertion),
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
