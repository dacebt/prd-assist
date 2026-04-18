import { describe, it, expect } from "vitest";
import { deriveTitle } from "./deriveTitle.js";

describe("deriveTitle", () => {
  it("returns empty string for empty input", () => {
    expect(deriveTitle("")).toBe("");
  });

  it("returns short 3-word input unchanged", () => {
    expect(deriveTitle("build a PRD")).toBe("build a PRD");
  });

  it("collapses internal whitespace to single spaces", () => {
    expect(deriveTitle("hello   world  here")).toBe("hello world here");
  });

  it("trims leading and trailing whitespace", () => {
    expect(deriveTitle("  hello world  ")).toBe("hello world");
  });

  it("returns 60-char input unchanged when it is exactly 60 chars", () => {
    const input = "a".repeat(29) + " " + "b".repeat(30);
    expect(input.length).toBe(60);
    const result = deriveTitle(input);
    expect(result).toBe(input);
  });

  it("backs up to last space when 60-char cut falls mid-word", () => {
    // 70-char input: "hello world this is a long sentence that goes beyond sixty chars"
    const input = "hello world this is a long sentence that goes beyond sixty chars";
    expect(input.length).toBeGreaterThan(60);
    const result = deriveTitle(input);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.at(-1)).not.toBe(" ");
    // char at result.length should be a space (the word boundary we backed up to)
    expect(input[result.length]).toBe(" ");
  });

  it("hard 60-char cut when no whitespace in first 60 chars", () => {
    const longWord = "x".repeat(80);
    const result = deriveTitle(longWord);
    expect(result).toBe("x".repeat(60));
  });

  it("handles input that needs whitespace collapse before 60-char limit", () => {
    // 8 words of 6 chars separated by 4 spaces → collapses to 55 chars, all returned
    const words = Array.from({ length: 8 }, () => "abcdef").join("    ");
    const result = deriveTitle(words);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result).toBe("abcdef abcdef abcdef abcdef abcdef abcdef abcdef abcdef");
  });

  it("correctly truncates long multi-word text at last space before 60", () => {
    const input = "The quick brown fox jumped over the lazy dog and then ran away";
    expect(input.length).toBeGreaterThan(60);
    const result = deriveTitle(input);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.at(-1)).not.toBe(" ");
  });
});
