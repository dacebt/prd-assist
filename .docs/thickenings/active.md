# Thickening: repair the walking skeleton

**Started:** 2026-04-26
**Git strategy:** commit to main
**Appetite remaining:** shape appetite is already in progress; treat this as the required repair before any remaining checkpoint/streaming work

## Dimension

End-to-end dev entrypoint observability for the composed web service and multi-agent backend. The current project has working server code under direct invocation, but the declared skeleton entrypoint `pnpm dev` does not walk under the project-state check because Node watch mode fails before the service can be observed.

## Observable delta

After this thickening, the composed product's declared entrypoint is observable again:
- before: `pnpm dev` fails during skeleton observation with `EMFILE: too many open files, watch`.
- after: the walking-skeleton check starts the dev entrypoint, observes the backend HTTP surface, and reports `walked: true`.

## Minimum surface

- Root/package dev entrypoint or skeleton-walker configuration — make the discovered command observable without relying on brittle Node watch behavior.
- Server startup path only if needed to support the chosen observation path.
- Verification metadata only if the project already has a skeleton-walker config convention to update.

## Verification path

- `python3 /Users/colond01/projects/ebt-agent-skills/skills/next-thickening/scripts/project-state.py` — reports `"skeleton_walking": true`.
- Direct observation if needed: start the selected entrypoint with a disposable SQLite path and fetch `GET /api/health`, expecting `200 {"ok":true}`.

## Residual risks

- This repair does not add richer user-facing checkpoint text; it only restores the required runnable baseline.
- If the skeleton-walker discovers `pnpm dev` mechanically and cannot be configured to use a non-watch command, the fix may require changing package scripts rather than only adding verification metadata.
- Health endpoint observation proves the service starts, but it is weaker than a full PRD-editing turn because real LM Studio execution is intentionally not exercised in this repair.

## Notes

Treat this project as both a web service and a multi-agent system. For this repair, the minimum walking path is process start -> HTTP listener -> one real route response while the MCP child can initialize against a disposable SQLite file. Once this walks, the next thickening can target the checkpoint behavior the user identified: interviewerSmall-owned progress updates during work-branch execution.
