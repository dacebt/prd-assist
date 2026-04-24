import { z } from "zod";

export type AgentRole =
  | "orchestrator"
  | "interviewerBig"
  | "interviewerSmall"
  | "plannerBig"
  | "worker"
  | "summary";

export const AgentRoleSchema = z.enum([
  "orchestrator",
  "interviewerBig",
  "interviewerSmall",
  "plannerBig",
  "worker",
  "summary",
]);

export interface ModelRoleConfig {
  model: string;
  perCallTimeoutMs: number;
  maxIterations: number;
}

export type ModelConfig = Record<AgentRole, ModelRoleConfig>;

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  orchestrator: { model: "google/gemma-4-e4b", perCallTimeoutMs: 90_000, maxIterations: 1 },
  interviewerBig: { model: "google/gemma-4-26b-a4b", perCallTimeoutMs: 90_000, maxIterations: 1 },
  interviewerSmall: { model: "google/gemma-4-e4b", perCallTimeoutMs: 90_000, maxIterations: 1 },
  plannerBig: { model: "google/gemma-4-26b-a4b", perCallTimeoutMs: 90_000, maxIterations: 12 },
  worker: { model: "google/gemma-4-e4b", perCallTimeoutMs: 90_000, maxIterations: 12 },
  summary: { model: "google/gemma-4-e4b", perCallTimeoutMs: 90_000, maxIterations: 1 },
};

const OverrideSchema = z.record(
  AgentRoleSchema,
  z
    .object({
      model: z.string().min(1),
      perCallTimeoutMs: z.number().int().positive().optional(),
      maxIterations: z.number().int().positive().optional(),
    })
    .partial({ perCallTimeoutMs: true, maxIterations: true }),
);

export function buildModelConfigFromEnv(overrideJson: string | undefined): ModelConfig {
  if (overrideJson === undefined) {
    return { ...DEFAULT_MODEL_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(overrideJson);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`invalid LM_STUDIO_MODELS_OVERRIDE JSON: ${message}`);
    process.exit(1);
  }

  const result = OverrideSchema.safeParse(parsed);
  if (!result.success) {
    console.error(`invalid LM_STUDIO_MODELS_OVERRIDE shape: ${result.error.message}`);
    process.exit(1);
  }

  const merged: ModelConfig = { ...DEFAULT_MODEL_CONFIG };
  for (const [role, override] of Object.entries(result.data)) {
    const key = role as AgentRole;
    const base = DEFAULT_MODEL_CONFIG[key];
    merged[key] = {
      model: override.model,
      perCallTimeoutMs: override.perCallTimeoutMs ?? base.perCallTimeoutMs,
      maxIterations: override.maxIterations ?? base.maxIterations,
    };
  }
  return merged;
}

export interface TurnConfig {
  models: ModelConfig;
  maxIterations: number;
  perCallTimeoutMs: number;
  wallClockMs: number;
}

export const TURN_DEFAULTS = {
  maxIterations: 12,
  perCallTimeoutMs: 90_000,
  wallClockMs: 300_000,
} as const;
