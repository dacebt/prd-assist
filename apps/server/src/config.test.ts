import { describe, it, expect, vi, afterEach } from "vitest";
import { buildModelConfigFromEnv, DEFAULT_MODEL_CONFIG } from "./config";

describe("buildModelConfigFromEnv", () => {
  it("undefined returns deep-equal copy of DEFAULT_MODEL_CONFIG", () => {
    const result = buildModelConfigFromEnv(undefined);
    expect(result).toEqual(DEFAULT_MODEL_CONFIG);
  });

  it("partial override merges specified fields, retains defaults for the rest", () => {
    const result = buildModelConfigFromEnv('{"orchestrator":{"model":"google/gemma-4-e2b"}}');
    expect(result.orchestrator.model).toBe("google/gemma-4-e2b");
    expect(result.orchestrator.perCallTimeoutMs).toBe(90_000);
    expect(result.orchestrator.maxIterations).toBe(DEFAULT_MODEL_CONFIG.orchestrator.maxIterations);
    for (const role of [
      "supervisor",
      "interviewerBig",
      "interviewerSmall",
      "plannerBig",
      "worker",
      "summary",
    ] as const) {
      expect(result[role]).toEqual(DEFAULT_MODEL_CONFIG[role]);
    }
  });

  describe("invalid JSON aborts with exit code 1", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("logs JSON error message and exits 1", () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
        throw new Error(`exited ${String(code)}`);
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      expect(() => buildModelConfigFromEnv("not-json")).toThrow();
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("invalid LM_STUDIO_MODELS_OVERRIDE JSON"),
      );
    });
  });

  describe("invalid shape aborts with exit code 1", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("logs shape error message and exits 1 for empty model string", () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
        throw new Error(`exited ${String(code)}`);
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      expect(() => buildModelConfigFromEnv('{"orchestrator":{"model":""}}')).toThrow();
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("invalid LM_STUDIO_MODELS_OVERRIDE shape"),
      );
    });
  });
});
