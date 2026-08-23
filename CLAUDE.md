# Automatic development routing

For any software-development request in this repository, load and follow `integrations/agent-router/SKILL.md` before planning or editing.

The user should only need to say `build X`. Inspect the repository read-only, invoke the bridge exactly once with the whole request, follow the persisted PlanBundle's explicit subskills and dependencies, and update progress only through its append-only interface. Do not ask the user to run a skill search or router command, and do not let child agents reroute.

