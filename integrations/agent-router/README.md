# Agent router integration

This directory makes the development router an agent behavior, not an end-user search command. Repository-local `AGENTS.md` and `CLAUDE.md` direct fresh Codex and Claude sessions here automatically.

## End-user flow

```text
User: build X
Agent: inspects the repository, routes the complete request once, follows the PlanBundle, implements, and verifies
Agent: Built X. <result and evidence>
```

The agent invokes this internally:

```text
node integrations/agent-router/scripts/agent-router.mjs route --request "build X" --project-root "."
```

It then uses `clarify`, `progress`, and `status` through the same bridge. JSON is automatic. The initial route is the only global search; clarification resumes and explicit subskill transitions reuse the pinned route.

A session that was already running when the repository entrypoints were added may have cached its instructions. Start a fresh Codex or Claude session in this repository for guaranteed automatic discovery. No global install is needed for this repository.

## Optional user-level discovery

To expose this repo-owned skill outside the checkout, link it into one or both agent skill directories:

```text
node integrations/agent-router/scripts/install.mjs --all
```

The installer links the source, never copies or overwrites it. Use `--dry-run` to inspect destinations first. This is optional and should be run by the repository owner, not as part of a development request.

## Offline checks

```text
node --check integrations/agent-router/scripts/agent-router.mjs
node --check integrations/agent-router/scripts/install.mjs
node --test integrations/agent-router/test/agent-router.test.mjs integrations/agent-router/test/skill-contract.test.mjs
```

The tests use only Node's standard library and temporary directories. They do not need the corpus, database, router service, or network.

