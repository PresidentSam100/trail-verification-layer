# TRAIL architecture

## Data flow

1. Local source discovery indexes path hashes, provider, basename, size, modified time, and route signals without copying transcript bodies.
2. A selected Codex or Claude JSONL file is parsed in memory by its native adapter and enters the durable review queue as `previewed`.
3. Local rules redact credentials, personal identifiers, absolute user paths, and repository URLs.
4. The user reviews the exact redacted excerpt.
5. If OpenAI is configured, the Responses API extracts a strict trail-shaped JSON object with `store: false`; otherwise the reviewer can start a guarded manual template. Either path marks the queue item `drafted`.
6. The draft remains private until review. The API rejects unresolved manual placeholders; approval writes one redacted `.trail.json` file into the public corpus and marks the queue item `approved`.
7. Retrieval applies mandatory environment filters, FTS/BM25 intent ranking, failure/trigger scoring, and policy weights. When configured, `gpt-5.6-luna` reranks only this admitted set using a locally redacted payload.
8. The harness receives the admitted trail and runs only fixture-defined tools in a disposable workspace.
9. Evidence gates decide whether to reroute, stop, or mark the exact PR commit eligible.

## Trust boundaries

- Transcript text and trail text are untrusted context, never executable authority.
- File operations must resolve inside `.trail/runs/<run>/<side>` and match a fixture allowlist.
- Checks are symbolic names defined by the reviewed fixture manifest; trails cannot add commands.
- A failed gate gets one alternate route at most. The harness then stops or escalates.
- The OpenAI key is never logged or returned by health endpoints.
- GitHub publication requires an exact `owner/repo` and 7–40 character hexadecimal SHA.
- The status publisher may report pending, failure, or success; no code path merges a PR.
- The optional SkillMD research catalog is a separate quarantine boundary: raw bodies remain only in the pinned `.trail` artifact, derived search returns metadata only, and no result can become a runtime route without a separate review process. See [the corpus notes](skill-corpus.md).

## Core records

- `Trail`: intent, environment, triggers, failure signatures, ordered steps, evidence, applicability, invalidators, outcome, and provenance.
- `IngestionPreview`: detected format, locally redacted excerpt, signal classes, and review requirement.
- `RunEvent`: append-only timeline for baseline, guided, or system events.
- `RetrievalPolicy`: immutable version with environment, lexical, failure, and evidence weights.
- `PolicyEvaluation`: before/after held-out scores, unsafe approvals, family regressions, and adoption result.

## API

- `GET /api/health`
- `GET /api/trails`
- `GET /api/policies`
- `GET /api/sources`
- `POST /api/sources/index`
- `GET /api/research-corpus`
- `GET /api/ingestions`
- `GET /api/ingestions/:id`
- `POST /api/ingestions/sample`
- `POST /api/ingestions/preview`
- `POST /api/ingestions/:id/extract`
- `POST /api/ingestions/:id/draft-template`
- `POST /api/trails/:id/approve`
- `POST /api/retrieve`
- `POST /api/runs`
- `GET /api/runs/:id`
- `GET /api/runs/:id/events` (SSE)
- `POST /api/policies/propose`
- `POST /api/policies/:id/evaluate`
- `POST /api/benchmarks/run`

## Intentional v1 limits

No accounts, discussion forum, raw transcript hosting, arbitrary shell execution, autonomous merge, deployment, system-prompt rewriting, or harness source self-modification.
