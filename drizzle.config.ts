import { defineConfig } from "drizzle-kit"

const databaseUrl = process.env.DATABASE_URL?.trim()

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required. Copy .env.example to .env and configure it.",
  )
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
})
