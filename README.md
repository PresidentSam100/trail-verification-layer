# TRAIL

Trajectory Retrieval and Intent Alignment Layer: a runtime verification layer for coding agents.

TRAIL turns prior Codex and Claude trajectories into reviewed, machine-readable route contracts. It retrieves routes only when required environment fields match, then blocks progress and PR release until the contract's evidence exists.

## What works

- Native Codex and Claude JSONL adapters.
- A privacy-safe historical review manifest anchored to hashed, redacted record ranges from real local runs.
- Local redaction before any OpenAI request.
- Reviewed trail contracts with provenance, applicability, invalidators, actions, and evidence.
- SQLite FTS/BM25 retrieval with mandatory environment filtering, an optional final OpenAI reranker, and explained rejected near-matches.
- Deterministic paired hero harness plus a real OpenAI Responses tool loop using the same model on both sides.
- Disposable fixture workspaces with path-constrained reads/writes and named checks only.
- Hard environment, changed-scope, test, remote-ancestry, HTTP, browser, provider, and runtime gates.
- Immutable retrieval-policy proposals with accept-or-rollback evaluation.
- Real `trail/verification` GitHub Action job and commit-status CLI. TRAIL never merges.
- Live judge interface, corpus search, transcript review, benchmark results, and RSI policy screen.

## Run it

Requirements: Node 22 and pnpm 10.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The API runs at `http://127.0.0.1:4317`.

Without `OPENAI_API_KEY`, deterministic proof and retrieval remain available, while extraction and live agent runs return an explicit unavailable state. Nothing is presented as live AI.

## CLI

```bash
# Hash and index local metadata/signals; raw transcripts are not copied.
pnpm trail ingest --scan

# Preview one transcript after local redaction.
pnpm trail ingest ~/.codex/sessions/.../rollout.jsonl

# Run the 8-task × 3-repeat × 2-condition fixture benchmark.
pnpm trail benchmark

# Run the paired deterministic hero scenario.
pnpm trail run

# Publish a real status for an exact commit after configuring a remote.
pnpm trail verify-pr \
  --repo owner/repository \
  --sha 0123456789abcdef \
  --state success \
  --description "All TRAIL evidence passed"
```

The repository's GitHub workflow exposes a check named `trail/verification`. Configure that check as required in the repository ruleset to block merge until it passes.

## Current fixture benchmark

The checked-in benchmark is deterministic and intended to prove orchestration and gating, not model intelligence.

| Metric | Baseline | TRAIL-guided |
| --- | ---: | ---: |
| Verified tasks | 6/24 (25%) | 24/24 (100%) |
| Unsafe approvals | 12 | 0 |
| Retrieval Recall@1 | — | 23/24 (95.83%) |
| MRR | — | 0.9583 |

Live OpenAI results must be measured separately with the configured model and may not reuse these numbers.

## Privacy boundary

- Raw transcripts remain at their original paths and are never modified or copied.
- The local index stores only a path hash, provider, basename, size, modified timestamp, and route signals.
- Secrets, tokens, emails, phone numbers, personal paths, and repository URLs are redacted locally.
- OpenAI extraction and reranking use `store: false`; transcript extraction receives only the redacted excerpt and reranking receives redacted query fields plus approved trail metadata.
- Drafts and run databases live under gitignored `.trail/`.
- Only an explicitly approved trail is exported to `corpus/public/`.

See [the architecture notes](docs/architecture.md) for data flow and trust boundaries.
The checked-in [historical review manifest](corpus/reviews/historical-review-manifest.json) records the observed failure/recovery shapes that informed the seed corpus without publishing transcript text or local paths.
