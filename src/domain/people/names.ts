export const personNameTypes = [
  "personal",
  "kunyah",
  "laqab",
  "nisbah",
  "nasab",
  "alias",
] as const

export type PersonNameType = (typeof personNameTypes)[number]

export const primaryPersonNameTypes = ["personal", "nasab"] as const

export type PrimaryPersonNameType = (typeof primaryPersonNameTypes)[number]
