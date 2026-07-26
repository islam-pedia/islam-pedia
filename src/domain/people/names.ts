export const personNameTypes = [
  "personal",
  "kunyah",
  "laqab",
  "nisbah",
  "nasab",
  "alias",
] as const

export type PersonNameType = (typeof personNameTypes)[number]
