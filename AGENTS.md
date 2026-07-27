# Islam Pedia — Agent Context

## Project Goal

Islam Pedia is currently a backend-only project for collecting and connecting
Islamic historical knowledge. Data entry, maintenance, and reading are performed
through AI agents using MCP tools, based on explicit instructions from the
project owner.

The knowledge base starts with people and is expected to grow into interconnected
domains such as:

- personal names, aliases, kunyah, laqab, nisbah, and titles;
- family and lineage relationships;
- teachers, students, companions, and narrator relationships;
- hadith, transmission variants, and ordered chains of narrators;
- migrations, battles, events, locations, and participant roles;
- organizations, tribes, groups, works, and other related entities;
- sources, passages, evidence, disagreements, and historical uncertainty.

The long-term goal is to provide structured data for a pedia-style frontend where
entities and their relationships can be explored easily.

## Architecture Decisions

- PostgreSQL is the initial and authoritative source of truth.
- MCP over stdio is the primary presentation layer during the backend-only
  phase. Keep domain and database logic outside MCP tool handlers so an HTTP
  presentation layer can be added later without rewriting core behavior.
- Do not introduce Neo4j merely because the domain is highly connected.
- Model relationships in PostgreSQL as first-class records so the data remains
  graph-friendly.
- Neo4j may be introduced later as a rebuildable read projection when measured
  requirements justify complex or performance-sensitive multi-hop traversal,
  graph visualization, shortest-path queries, or graph analytics.
- If Neo4j is added, never make PostgreSQL and Neo4j independent writable
  sources of truth. Write to PostgreSQL and project changes into Neo4j.
- The backend and MCP interface are the only required application surfaces for
  now. Do not build a frontend unless explicitly requested.

## MCP Conventions

- Build the MCP server with the official TypeScript SDK and run it with Bun.
- Use stdio for local agent integrations. Never write application logs to
  stdout because stdout carries MCP JSON-RPC messages; use stderr instead.
- Expose narrow tools aligned with user intentions rather than generic table
  access or unrestricted SQL.
- Use Zod input and output schemas and return `structuredContent` in addition to
  concise text content.
- Mark tools accurately with MCP annotations such as `readOnlyHint`,
  `destructiveHint`, `idempotentHint`, and `openWorldHint`.
- Keep tool registration grouped by domain under `src/mcp/tools/`.
- Keep validation and domain operations reusable outside the MCP transport.

## Data Modeling Principles

- Keep canonical entities separate from names, aliases, titles, relationships,
  events, and source evidence.
- The current people-only schema consists of `ingestion_runs`, `entities`,
  `people`, and `entity_search_terms`. New domains should extend the shared
  entity identity instead of replacing it.
- `people.name_original` preserves the original-script display name and
  `people.name_latin` preserves the selected canonical Latin rendering.
- Use the person's original personal name (ism), normally expanded as a nasab,
  for the primary display name. Keep better-known kunyah and laqab as separate
  structured names rather than substituting them for the person's ism in the
  primary display.
- `person_names` stores classified forms of a person's name. Use `personal` for
  the personal name (ism), `kunyah` for forms such as Abu/Umm, and the explicit
  `laqab`, `nisbah`, `nasab`, or `alias` types for their respective meanings.
  The row marked `is_primary` must match the display name stored on `people`.
- `people.gender` is explicit structured data with `male`, `female`, or
  `unknown`. Never infer it from a name, kunyah, title, or relationship label.
- Store person relationships once in their canonical direction: parent to
  child, husband to wife (`husband_of`), guardian to ward, and teacher to
  student. Derive inverse labels such as father, mother, son, daughter, husband,
  wife, teacher, and student when reading.
- Record both known biological parents independently. Never infer a father or
  mother from a marriage relationship, and keep biological, milk, adoptive, and
  guardian relationships distinct.
- Every person relationship must retain its assertion status, source passage
  evidence, and status history. Accepted relationships require explicit
  non-context-only evidence; uncertain or disputed claims remain queryable.
- Normalized columns are derived search data. Never overwrite display names
  with their normalized forms.
- `entity_search_terms` contains search-only keywords and spelling variants.
  Keywords are rebuildable search aids, not structured names, kunyah, historical
  facts, tags, titles, or relationship data.
- Never auto-merge people based only on matching or similar names. Report
  duplicate candidates and preserve distinct provisional entities until stronger
  identity evidence exists.
- Treat historical relationships as assertions, not as unquestionable columns
  on an entity. For example, do not model lineage only with `person.parent_id`.
- Every meaningful assertion should be traceable to one or more source passages.
- Preserve conflicting claims from different sources. Use statuses such as
  `accepted`, `uncertain`, `disputed`, and `retracted` instead of deleting
  inconvenient history.
- Store both structured source locators and the extracted passage when possible,
  including work, author, edition, volume, page, chapter, hadith number, or URL.
- Distinguish explicit statements in a source from AI inference.
- Model ordered structures, such as hadith narrator chains, with explicit
  sequence numbers and transmission/variant context.
- Use JSONB for evolving qualifiers and source-specific metadata, not as a
  replacement for stable relational columns.
- Use stable internal IDs. Names and transliterations are not identifiers.
- Prefer reversible corrections and revision history over destructive updates.

## AI and MCP Write Policy

- The owner explicitly authorizes AI-driven reads and writes when issuing a
  relevant instruction. Per-row manual approval is not required.
- MCP write tools should be narrow, intention-revealing operations such as the
  current `import_people` and `add_person_keywords`, and future
  `add_relationship` and `attach_evidence` operations. Avoid exposing
  unrestricted production SQL as the normal interface.
- Direct canonical writes are allowed after automatic validation.
- Before creating an entity, search for likely duplicates across canonical
  names, Arabic names, transliterations, aliases, dates, and known relations.
- All writes must be idempotent where practical and record an operation/run ID
  so a retried AI request does not duplicate data.
- Record who or what created and changed data, when it happened, and the source
  supplied for the change.
- Ambiguous identity matches, destructive merges, unsupported claims, and source
  conflicts must be retained or flagged for resolution rather than guessed away.
- Confidence scores are supplementary metadata; they do not replace citations
  or source evidence.

## Source and Methodology Policy

- All accepted conclusions and canonical editorial decisions must follow the
  Salafiyyun methodology. The enforced policy version is `salafiyyun-v1`.
- Use the Quran as primary evidence with an exact surah and verse, understood
  through the tafsir and explanations transmitted from the Salaf.
- Use hadith as primary evidence only when the collection and hadith number are
  recorded and an explicit `sahih` or `hasan` grading with the grader is stored.
- Reports from the Sahabah, Tabi'in, and Tabi' al-Tabi'in, and explanations by
  Ahl al-Sunnah scholars following the Salaf, may support conclusions when the
  author, work, exact locator, extracted passage, and methodology basis are
  recorded.
- The label "Salafi" or "Salafiyyun" alone is never evidence. Every assertion
  still requires an exact citation and an extracted passage.
- A person may become `active` from one explicit qualifying Quran/authentic
  hadith passage, or from at least two independent qualifying secondary sources.
- Sources outside this methodology may be retained as `context_only` to
  document another view, but they cannot activate an entity or establish an
  accepted canonical conclusion.
- Preserve disagreements among Salafiyyun scholars and contrary reports. Attach
  each view to its evidence and use `uncertain`, `disputed`, or `retracted`
  instead of deleting inconvenient history.
- AI inference, search snippets, unsourced websites, social media, blogs, and
  Wikipedia are discovery aids only; they are not activation evidence.

## Technology and Development Conventions

- Use Bun and TypeScript for backend and MCP development.
- Keep each application domain under `src/application/<domain>/` with a
  consistent `commands/`, `queries/`, and `shared/` structure. Commands perform
  writes, queries perform reads, and shared contains domain-local types, errors,
  and helpers.
- Treat `src/application/<domain>/index.ts` as the domain's public API. Code
  outside that domain must import through the public index (preferably through
  the `@/*` alias) instead of deep-importing its internal files.
- Use the release-candidate versions of Drizzle ORM and Drizzle Kit, pinned to
  exact matching versions until the owner explicitly decides to upgrade.
- Use Drizzle's native Bun SQL integration (`drizzle-orm/bun-sql`) for
  PostgreSQL connections. Do not add `pg`, `postgres.js`, or `dotenv`; Bun
  provides the SQL driver and loads `.env` automatically.
- Define the database schema with Drizzle, generate versioned migrations with
  Drizzle Kit, and use Drizzle's query APIs for normal application access.
- Use raw SQL only when PostgreSQL-specific functionality cannot be expressed
  clearly through Drizzle, and keep that SQL inside the repository and covered
  by migrations or tests as appropriate.
- Use PostgreSQL constraints, foreign keys, transactions, and indexes to enforce
  invariants rather than relying only on prompts.
- Use migrations for every schema change. Never edit a shared database schema
  manually without capturing the equivalent migration.
- Keep secrets in `.env`; commit only `.env.example`.
- The local PostgreSQL service is defined in `compose.yaml`.

## Current Local Database

Start PostgreSQL with:

```bash
docker compose up -d
```

Check its status with:

```bash
docker compose ps
```

Stop the service without deleting its data with:

```bash
docker compose down
```

The default host connection string is documented in `.env.example`. Do not use
destructive filesystem commands against `.data/postgres`; it contains the local
PostgreSQL database and is intentionally excluded from version control.
