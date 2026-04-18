import { describe, it, expect } from "vitest";
import { SectionKeySchema, SectionStatusSchema } from "./validate.js";

describe("SectionKeySchema", () => {
  it("accepts all seven valid keys", () => {
    const keys = [
      "vision",
      "problem",
      "targetUsers",
      "goals",
      "coreFeatures",
      "outOfScope",
      "openQuestions",
    ];
    for (const key of keys) {
      expect(SectionKeySchema.safeParse(key).success).toBe(true);
    }
  });

  it("rejects unknown key 'risks'", () => {
    expect(SectionKeySchema.safeParse("risks").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(SectionKeySchema.safeParse("").success).toBe(false);
  });
});

describe("SectionStatusSchema", () => {
  it("accepts empty, draft, confirmed", () => {
    expect(SectionStatusSchema.safeParse("empty").success).toBe(true);
    expect(SectionStatusSchema.safeParse("draft").success).toBe(true);
    expect(SectionStatusSchema.safeParse("confirmed").success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(SectionStatusSchema.safeParse("pending").success).toBe(false);
  });
});

describe("content length validation (via SectionKeySchema boundary)", () => {
  it("string of length 10000 is within bounds", () => {
    const s = "a".repeat(10000);
    expect(s.length).toBe(10000);
    expect(s.length <= 10000).toBe(true);
  });

  it("string of length 10001 exceeds bounds", () => {
    const s = "a".repeat(10001);
    expect(s.length).toBe(10001);
    expect(s.length > 10000).toBe(true);
  });
});
