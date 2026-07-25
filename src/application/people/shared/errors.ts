/** Errors exposed by the people application module. */
export class PeopleInputError extends Error {
  override name = "PeopleInputError"
}

export class IdempotencyConflictError extends Error {
  override name = "IdempotencyConflictError"
}
