export const personGenders = ["male", "female", "unknown"] as const

export const personRelationshipTypes = [
  "biological_parent_of",
  "milk_parent_of",
  "adoptive_parent_of",
  "guardian_of",
  "husband_of",
  "teacher_of",
] as const

export type PersonGender = (typeof personGenders)[number]
export type PersonRelationshipType = (typeof personRelationshipTypes)[number]
export type PersonRelationshipDirection = "outgoing" | "incoming"

export function getPersonRelationshipLabel(
  type: PersonRelationshipType,
  direction: PersonRelationshipDirection,
  relatedPersonGender: PersonGender,
): string {
  if (type === "husband_of") {
    return direction === "outgoing" ? "wife" : "husband"
  }

  if (type === "teacher_of") {
    return direction === "outgoing" ? "student" : "teacher"
  }

  if (type === "guardian_of") {
    return direction === "outgoing" ? "ward" : "guardian"
  }

  const prefix =
    type === "milk_parent_of"
      ? "milk_"
      : type === "adoptive_parent_of"
        ? "adoptive_"
        : ""

  if (direction === "incoming") {
    const parentLabel =
      relatedPersonGender === "male"
        ? "father"
        : relatedPersonGender === "female"
          ? "mother"
          : "parent"

    return `${prefix}${parentLabel}`
  }

  const childLabel =
    relatedPersonGender === "male"
      ? "son"
      : relatedPersonGender === "female"
        ? "daughter"
        : "child"

  return `${prefix}${childLabel}`
}
