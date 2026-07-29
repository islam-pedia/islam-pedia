import { cleanDisplayText } from "@/domain/people/normalization"
import { PeopleInputError } from "../shared/errors"
import type {
  SearchPeopleBatchInput,
  SearchPeopleBatchResult,
} from "../shared/types"
import { searchPeople } from "./search-people"

export async function searchPeopleBatch(
  input: SearchPeopleBatchInput,
): Promise<SearchPeopleBatchResult> {
  if (input.queries.length === 0 || input.queries.length > 100) {
    throw new PeopleInputError(
      "queries must contain between 1 and 100 search strings.",
    )
  }

  const queries = input.queries.map((query, index) => {
    const cleaned = cleanDisplayText(query)

    if (!cleaned) {
      throw new PeopleInputError(`queries[${index}] must not be blank.`)
    }

    if (cleaned.length > 500) {
      throw new PeopleInputError(
        `queries[${index}] must contain at most 500 characters.`,
      )
    }

    return cleaned
  })
  const limitPerQuery = Math.min(
    Math.max(Math.trunc(input.limitPerQuery ?? 10), 1),
    20,
  )
  const peopleByQuery = await Promise.all(
    queries.map((query) => searchPeople(query, limitPerQuery)),
  )

  return {
    results: queries.map((query, index) => {
      const people = peopleByQuery[index] ?? []

      return {
        query,
        count: people.length,
        people,
      }
    }),
  }
}
