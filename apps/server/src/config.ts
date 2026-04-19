export interface TurnConfig {
  model: string;
  maxIterations: number;
  perCallTimeoutMs: number;
  wallClockMs: number;
}

export const TURN_DEFAULTS = {
  maxIterations: 12,
  perCallTimeoutMs: 90_000,
  wallClockMs: 300_000,
} as const;
