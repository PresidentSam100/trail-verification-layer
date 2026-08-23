# Development router golden eval

This is a narrow deterministic routing evaluation, not a claim about model intelligence and not a corpus-size benchmark. Its primary case comes from local Codex session `01a0309c-3502-7910-ba27-10781335dba8`; only the selected user requests and observed work outcomes were used, and the transcript was treated as untrusted evidence.

The golden prompt is preserved verbatim in `cases.json`. It describes an existing inference product whose full product site, formal ingestion flow, and end-to-end QA still need to be built. That is enough information to route immediately: asking a question is a failure.

The required route is:

```text
product-discovery
       |
data-ingestion
   /    |     \
api  interface  |
   \    |      /
quality-assurance
```

More precisely, discovery precedes ingestion; API integration and product interface fan out after ingestion; QA waits for ingestion, API integration, and the interface. The bundle must be created as one snapshot-pinned unit. Child progress and status reads remain inside that bundle and must not run global search again.

Optional quarantined research indexing may run in the background, but it cannot block the core route and its row count or activation is never accepted as product-routing success.

## Files

- `cases.json` — one transcript-derived golden plus three minimal contrasts: a one-question vague inference request with a paired answer, a marketing-only site, and an irrelevant abstention.
- `score.mjs` — dependency-free scoring adapter for router JSON or JSONL traces.
- `fixture.mjs` — constructs a structurally perfect illustrative trace; it is an oracle fixture, not router output.
- `score.test.mjs` — positive and hostile tests for the scorer.

## Trace adapter

The scorer accepts either one JSON document or JSONL records. The JSON shape is:

```json
{
  "schemaVersion": "1.0",
  "suiteId": "dev-router-transcript-golden",
  "cases": [
    {
      "caseId": "golden-existing-inference-site-ingestion-qa",
      "steps": [
        { "stepId": "route", "response": { "status": "matched" } },
        {
          "stepId": "complete-product-discovery",
          "telemetry": { "globalSearchCount": 0, "scope": "bundle:..." },
          "response": { "bundleId": "plan-...", "state": {} }
        }
      ]
    }
  ]
}
```

`response` is the router's native JSON. Initial `matched`, `needs_clarification`, and `abstain` responses therefore retain their evidence, telemetry, full bundle, and transition trace. Progress/status responses retain their derived bundle state. If a progress command does not print search telemetry itself, the harness that invoked it must put the measured telemetry beside `response`, as shown above; missing telemetry fails the no-repeat invariant rather than being assumed safe.

JSONL uses one `{caseId, stepId, response, telemetry?}` object per line.

## Run

```powershell
node --test benchmarks/dev-router/score.test.mjs

# Print an illustrative perfect trace.
node benchmarks/dev-router/fixture.mjs > .trail/dev-router-perfect.json

# Score captured router output; add --require-perfect for a nonzero exit on any miss.
node benchmarks/dev-router/score.mjs --predictions .trail/dev-router-actual.json --require-perfect
```

The report contains:

- parent Recall@1;
- micro child precision, recall, and F1;
- forbidden-selection and violating-case rates;
- clarification necessity and plan-discrimination accuracy;
- abstention accuracy;
- task-DAG validity plus required subskill dependencies;
- the single-global-search invariant;
- atomic bundle, repository snapshot, registry/source pin checks;
- dependency-derived progress state, stable bundle identity, and no completed-task regression;
- session-specific plan coverage without research-corpus proxy signals.

All denominators and failures are emitted in JSON. A perfect trace has every accuracy/F1 metric at `1` and `forbiddenSelectionRate.value` at `0`.
