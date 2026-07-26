import { SQL } from "bun"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/bun-sql"
import {
  entities,
  entityEvidence,
  entitySearchTerms,
  entityStatusChanges,
  ingestionRuns,
  people,
  sourcePassages,
  sources,
} from "@/db/schema"

interface CurrentDatabaseRow extends Record<string, unknown> {
  databaseName: string
}

export function assertSafeTestDatabaseName(databaseName: string): void {
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to clean database "${databaseName}". Test database names must end with "_test".`,
    )
  }
}

export async function resetTestDatabase(databaseUrl: string): Promise<void> {
  const client = new SQL(databaseUrl)
  const database = drizzle({ client })

  try {
    const [currentDatabase] = await database.execute<CurrentDatabaseRow>(
      sql`select current_database() as "databaseName"`,
    )

    if (!currentDatabase) {
      throw new Error("Could not determine the current test database.")
    }

    assertSafeTestDatabaseName(currentDatabase.databaseName)

    await database.execute(sql`
      TRUNCATE TABLE
        ${entityEvidence},
        ${entityStatusChanges},
        ${sourcePassages},
        ${sources},
        ${entitySearchTerms},
        ${people},
        ${entities},
        ${ingestionRuns}
      CASCADE
    `)
  } finally {
    await client.close({ timeout: 1 })
  }
}
