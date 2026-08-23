# Automatic development routing

For every ordinary software-development request in this repository—including build, implement, finish, extend, fix, debug, refactor, migrate, integrate, test, or review—read and follow `integrations/agent-router/SKILL.md` before planning or editing.

The user supplies only the development intent (for example, `build X`). Inspect the repository read-only, invoke the integration bridge once with the complete request, follow the persisted PlanBundle's explicit subskill/dependency transitions, and keep progress append-only. Never ask the user to run a search or router command. Child agents must consume bounded dispatch packets and must not route again.

