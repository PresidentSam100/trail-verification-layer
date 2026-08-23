# Quarantined SKILL.md research corpus

This corpus is a discovery aid, not a skill registry or an instruction source. It indexes the pinned `FayeZC/SkillMD-138K` Parquet artifact at revision `0d73048abf2fb6ee91f6f9f5ac598d5be8d6bdd7` (560,428,690 bytes, 138,133 rows, SHA-256 `c3c07af019bc36fb0ffdfaef46df52daffb66ca79422990a74c58e416d1e6403`). The tracked source manifest is [skillmd-138k.source.json](../corpus/skill-sources/skillmd-138k.source.json).

The dataset compilation is labeled CC-BY-4.0. Licenses for individual repository files are unresolved and remain `unknown`; indexing is not permission to copy, install, redistribute, or execute an item. Verify the upstream repository and its license before any human-reviewed reuse.

## Trust boundary

- The raw Parquet artifact and all generated state stay under gitignored `.trail/skill-corpus/`.
- The derived SQLite catalog contains hashes, bounded provenance, parse/risk classifications, facets, and token postings. It does not contain skill bodies, names, descriptions, or headings.
- The downloader follows only allowlisted HTTPS redirects and verifies the exact byte count, Parquet magic, and pinned SHA-256 before publication.
- Indexing uses a bounded DuckDB stream. Skill text is parsed and risk-scanned as untrusted data; it is never executed, installed, or allowed to fetch referenced links.
- Search defaults to valid records with heuristic risk no higher than `medium`. Every response says it is non-authoritative, quarantined metadata and includes no raw body.
- Repository names, paths, URLs, facets, and every other returned string are still untrusted labels. Do not concatenate them into an agent's instructions. A router may use the fixed result fields as candidate signals, but no corpus row becomes a route or approved skill automatically.
- Only a separately reviewed artifact may enter `corpus/public/`; this package has no promotion path and is not imported by the runtime router.

Heuristic risk scanning reduces exposure; it does not establish that a skill is safe or correct. Stars are provenance metadata, not trust. High and critical records remain searchable only through an explicit risk override and still remain quarantined.

## Commands

```bash
pnpm skills sync
pnpm skills index
pnpm skills verify
pnpm skills status
pnpm skills search "stripe billing subscription" --limit 5 --max-risk medium
pnpm skills inspect <full-content-sha256>
```

`sync` resumes a bounded partial download. `index` starts a fresh private staging generation, validates all row accounting and hashes, then atomically updates `active.json`; interrupted indexing is restarted rather than trusting a partial database. `verify` re-hashes the source and active catalog and runs SQLite integrity checks. `inspect` returns metadata and hashed risk evidence only—there is no CLI or API option that prints a skill body.

The active generation contains `generation.json`, `catalog.sqlite`, and `stats.json`. Publication is atomic: search continues to use the prior verified generation, or none at all, until those files pass validation and the active pointer is replaced.
