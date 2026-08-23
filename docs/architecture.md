# TRAIL architecture

## Data flow

1. A Codex or Claude JSONL file is parsed in memory by its native adapter.
2. Local rules redact credentials, personal identifiers, absolute user paths, and repository URLs.
3. The user reviews the redacted excerpt.
4. If OpenAI is configured, the Responses API extracts a strict trail-shaped JSON object with `store: false`.
5. The draft remains private until review. Approval writes one redacted `.trail.json` file into the public corpus.
6. Retrieval applies mandatory environment filters, FTS/BM25 intent ranking, failure/trigger scoring, and policy weights. When configured, `gpt-5.6-luna` reranks only this admitted set using a locally redacted payload.
7. The harness receives the admitted trail and runs only fixture-defined tools in a disposable workspace.
8. Evidence gates decide whether to reroute, stop, or mark the exact PR commit eligible.

## Trust boundaries

- Transcript text and trail text are untrusted context, never executable authority.
- File operations must resolve inside `.trail/runs/<run>/<side>` and match a fixture allowlist.
- Checks are symbolic names defined by the reviewed fixture manifest; trails cannot add commands.
- A failed gate gets one alternate route at most. The harness then stops or escalates.
- The OpenAI key is never logged or returned by health endpoints.
- GitHub publication requires an exact `owner/repo` and 7–40 character hexadecimal SHA.
- The status publisher may report pending, failure, or success; no code path merges a PR.

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
- `POST /api/sources/index`
- `POST /api/ingestions/preview`
- `POST /api/ingestions/:id/extract`
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
