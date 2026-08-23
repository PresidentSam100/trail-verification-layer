# TRAIL

Trajectory Retrieval and Intent Alignment Layer: a runtime verification layer for coding agents.

TRAIL is an external human-context layer for coding agents. Give it a normal task prompt and it returns a source-backed execution brief: what the human wants, what the agent must and must not do, the applicable recovery route, and the evidence required before completion.

## What works

- A prompt-to-context compiler that preserves the current request verbatim and source-anchors every directive.
- Explicit Do / Do Not / Route / Evidence output with no-match and missing-environment states.
- A local stdio MCP server for Codex and Claude: `trail_build_context`, `trail_recover`, and `trail_verify`.
- Human-owned `.trailrc.json` evidence adapters; agent prose can never satisfy a release gate.
- Native Codex and Claude JSONL adapters.
- A privacy-safe historical review manifest anchored to hashed, redacted record ranges from real local runs.
- Local redaction before any live-provider request.
- Reviewed trail contracts with provenance, applicability, invalidators, actions, and evidence.
- SQLite FTS/BM25 retrieval with mandatory environment filtering, an optional final provider reranker, and explained rejected near-matches.
- Deterministic paired hero harness plus a real Responses-compatible tool loop using the same model on both sides.
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

The homepage is the product: enter a request, inspect the retrieved human context, and copy the compiled execution brief. The baseline-versus-guided benchmark remains under **Live proof**.

Without `OPENAI_API_KEY`, deterministic proof and retrieval remain available, while extraction and live agent runs return an explicit unavailable state. Nothing is presented as live AI.

The current local configuration routes the Responses-compatible calls to K3 through the configured Modal endpoint. `OPENAI_BASE_URL`, model names, and `TRAIL_PROVIDER_LABEL` keep this transport provider-neutral; `store: false` is sent on every model call.

## CLI

```bash
# Turn a normal request into an agent execution brief.
pnpm trail context --task "Fix the visible deployment. Do not edit a copied checkout." --workspace /path/to/repo

# Request the one allowed recovery route and verify the resulting bundle.
pnpm trail recover --bundle BUNDLE_ID --failure "browser proof failed"
pnpm trail verify --bundle BUNDLE_ID --workspace /path/to/repo

# Check provider, corpus, database, GitHub auth, and the MCP launch command.
pnpm trail doctor

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
  --bundle immutable-bundle-id \
  --description "All TRAIL evidence passed"
```

`success` is rejected unless the referenced immutable bundle is `ready` and the latest observation for every required evidence gate passed. `pending` and `failure` may be published without a bundle; TRAIL never merges.

## Use TRAIL from Codex or Claude

Keep `pnpm dev` running, build the MCP package once with `pnpm build`, then register the local stdio server:

```bash
codex mcp add trail --env TRAIL_API_BASE=http://127.0.0.1:4317 -- \
  node /Users/joshuajerin/Desktop/jarvis/hackathon-yc/apps/mcp/dist/index.js

claude mcp add --scope user trail -e TRAIL_API_BASE=http://127.0.0.1:4317 -- \
  node /Users/joshuajerin/Desktop/jarvis/hackathon-yc/apps/mcp/dist/index.js
```

At task start call `trail_build_context`. After a real failure call `trail_recover`. Before claiming completion or releasing a PR call `trail_verify`. The MCP server returns the same immutable bundles as the HTTP API and CLI.

Each target repository may define a human-owned `.trailrc.json`. Only named commands and adapters in that file can generate evidence; trail or transcript text cannot introduce executable commands.

The repository's GitHub workflow exposes a check named `trail/verification`. Configure that check as required in the repository ruleset to block merge until it passes.

## Current fixture benchmark

The checked-in benchmark is deterministic and intended to prove orchestration and gating, not model intelligence.

| Metric | Baseline | TRAIL-guided |
| --- | ---: | ---: |
| Verified tasks | 6/24 (25%) | 24/24 (100%) |
| Unsafe approvals | 12 | 0 |
| Retrieval Recall@1 | — | 23/24 (95.83%) |
| MRR | — | 0.9583 |

Live provider results must be measured separately with the configured model and may not reuse these numbers.

## Privacy boundary

- Raw transcripts remain at their original paths and are never modified or copied.
- The local index stores only a path hash, provider, basename, size, modified timestamp, and route signals.
- Secrets, tokens, emails, phone numbers, personal paths, and repository URLs are redacted locally.
- Live extraction and reranking use `store: false`; transcript extraction receives only the redacted excerpt and reranking receives redacted query fields plus approved trail metadata.
- Drafts and run databases live under gitignored `.trail/`.
- Only an explicitly approved trail is exported to `corpus/public/`.

See [the architecture notes](docs/architecture.md) for data flow and trust boundaries.
The checked-in [historical review manifest](corpus/reviews/historical-review-manifest.json) records the observed failure/recovery shapes that informed the seed corpus without publishing transcript text or local paths.
