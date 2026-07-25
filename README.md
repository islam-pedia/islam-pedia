# islam-pedia

To install dependencies:

```bash
bun install
```

Create the local environment file:

```bash
cp .env.example .env
```

Start PostgreSQL:

```bash
docker compose up -d
```

Apply database migrations:

```bash
bun run db:migrate
```

Run the MCP server over stdio:

```bash
bun run mcp
```

The default database is available at
`postgresql://islam_pedia:islam_pedia_dev@127.0.0.1:5433/islam_pedia`.
Its files are persisted locally in `.data/postgres/`, which is ignored by Git.

The initial MCP tools are:

- `system_health` — checks the PostgreSQL connection.
- `project_context` — reports the current backend architecture.
- `import_people` — imports up to 500 people in one idempotent batch.
- `search_people` — searches original names, Latin names, and keywords.
- `get_person` — reads one person by entity ID.
- `add_person_keywords` — adds search-only spelling variants.

The MCP process must reserve stdout for protocol messages. Diagnostics are
written to stderr.

Run type checks and tests:

```bash
bun run typecheck
bun test
```

The local integration database uses `.env.test.local` and is separate from the
main database. Integration tests clean application data both before and after
each run, and refuse cleanup unless the connected database name ends in `_test`.
Run its migration once after creating or changing the test database:

```bash
bun run db:migrate:test
```

`bun test` automatically loads `.env.test.local` and includes the integration
test.

Stop PostgreSQL without deleting its data:

```bash
docker compose down
```

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
