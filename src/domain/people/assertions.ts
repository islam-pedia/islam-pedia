export const personReligionsAtDeath = ["muslim", "non_muslim"] as const

export const personEncounterOutcomes = ["met", "did_not_meet"] as const

export type PersonReligionAtDeath = (typeof personReligionsAtDeath)[number]

export type PersonEncounterOutcome = (typeof personEncounterOutcomes)[number]
