# Shape: multi-agent turn pipeline — S4/S5/S6 remainder

**Declared:** 2026-04-23
**Appetite:** ~6 thickenings, or 1 week wall-clock, whichever first
**Git strategy:** commit to main

## In scope

- **S4 — Interviewer-Big branch.** New single-call agent (big Gemma 4, no tools) replaces the legacy supervisor on the no-PRD-work branch of `apps/server/src/turn.ts`. New prompt file at `apps/server/src/prompts/interviewerBig.ts`.
- **S5 — Planner-Big pipeline.** Planner-Big (big Gemma 4, planning only, no edit tools) emits a structured task list. Sequential workers (small Gemma 4, scoped MCP edit tools per task) execute the list. Planner-Big final-verifies. Interviewer-Small (small Gemma 4, per-step prompt family) closes the work-branch turn. Legacy supervisor path deleted: `prompts/supervisor.ts`, `AgentRole "supervisor"`, and any supervisor-specific scaffolding removed. Likely decomposed into sub-thickenings (task-list contract, worker dispatch, final verify + close).
- **S6 — SSE transport and web streaming.** `apps/server/src/routes/messages.ts` becomes SSE-native (Hono `streamSSE`). Real `LlmClient.chatStreaming()` implementation. `StreamSink` swaps from console/buffer to SSE-writing. Web client subscribes via `EventSource`, renders `thinking` events with agent-role labels, replaces indicators on `final`. Polling in `useSessionPolling.ts` removed or disabled when SSE is active.
- **Persistence invariant** preserved: `thinking` events are transport-only; only `final` writes to `messages_json`.

## Out of scope (deliberately)

- Dual-path / feature-flagged legacy retention. Supervisor path is deleted in S5, not kept behind a toggle.
- Per-task planner-reviewer loop on worker output. Planner-Big's final verify is the only check.
- Hard global turn timer. Per-call timeouts from `ModelConfig` only.
- WebSocket transport. SSE is the chosen fit.
- Model swap away from Gemma 4 for any role.
- Changes to `apps/mcp`, `packages/shared`, or DB schema beyond the `prd_summary` column landed in S2.
- Web UI polish beyond the minimum needed to render thinking/final events.

## Known risks

- **Local GPU serialization.** Work-branch turns may take multiple minutes on one GPU; SSE thinking events are the mitigation (user sees progress), but per-call timeouts must be tuned against real LM Studio latency (plan R4 unresolved).
- **S5 decomposition surface.** Planner task-list contract, worker context tradeoff (plan C6 / R3 — section content in task payload vs. worker calls `get_prd`), final verify behavior, and Interviewer-Small close each have distinct failure modes. Expect 3–4 sub-thickenings, not one monolithic S5.
- **Summary drift by one turn** (carried from plan). Orchestrator reads summary generated after the prior turn; lag is bounded to one turn but can nudge routing on rapid sequential edits.
- **Orchestrator fail-closed silence.** Malformed classifier output routes to Interviewer-Big silently; no user-visible error. Accepted as the safe default but worth watching during integration.
- **Streaming shape unverified (plan R1).** LM Studio's Gemma 4 streaming delta shape hasn't been probed against the target hardware. Affects S6's client parsing.

## Success signal

A user turn that edits two PRD sections runs end-to-end through Orchestrator → Planner-Big → workers → Planner-Big verify → Interviewer-Small, with thinking events streaming to the browser labeled by agent role and a final event closing the turn; legacy supervisor code is absent from the repo.

## Notes

- Plan of record: `.docs/planning/plans/2026-04-21-multi-agent-turn-pipeline.plan.md`. Architectural decisions, rejected alternatives, shared contracts (C1–C6), and cross-system verification scenarios (V1–V7) carry forward from the plan and do not need to be restated per thickening.
- S1–S3 already committed (commits `4303cb8`, `264636e`, `7821098`). Legacy supervisor still runs both branches at the start of this session; S4 flips the no-work branch, S5 flips the work branch and deletes the supervisor.
- Domain model skipped — the plan's vocabulary (AgentRole, StreamEvent, StreamSink, ModelConfig) is already pinned in shared contracts.
