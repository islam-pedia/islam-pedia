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

The MCP process must reserve stdout for protocol messages. Diagnostics are
written to stderr.

Stop PostgreSQL without deleting its data:

```bash
docker compose down
```

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
