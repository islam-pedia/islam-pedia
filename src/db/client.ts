import { drizzle } from "drizzle-orm/bun-sql"

let database: ReturnType<typeof drizzle> | undefined

function getDatabaseUrl(): string {
  const databaseUrl = Bun.env.DATABASE_URL?.trim()

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required. Copy .env.example to .env and configure it.",
    )
  }

  return databaseUrl
}

export function getDatabase(): ReturnType<typeof drizzle> {
  database ??= drizzle(getDatabaseUrl())

  return database
}
