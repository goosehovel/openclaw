import { describe, expect, it } from "vitest";
import {
  buildEvalResult,
  formatEvalSummary,
  loadScenarios,
  summarizeResults,
  validateArgs,
  validateMustNotCall,
  validateToolSelection,
} from "./tool-call-eval.js";
import type { EvalScenario } from "./types.js";

const sampleScenario: EvalScenario = {
  id: "test-read",
  description: "Test reading a file",
  userMessage: "Read config.yaml",
  toolGroup: "group:fs",
  allowedToolNames: ["read"],
  expectedArgsSchema: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string" },
    },
  },
  mustNotCallTools: ["exec", "write"],
};

describe("tool-call-eval", () => {
  it("loads scenarios from disk", () => {
    const scenarios = loadScenarios();
    expect(scenarios.length).toBeGreaterThanOrEqual(20);
    for (const s of scenarios) {
      expect(s.id).toBeTruthy();
      expect(s.allowedToolNames.length).toBeGreaterThan(0);
    }
  });

  it("validates tool selection correctly", () => {
    expect(validateToolSelection(sampleScenario, "read")).toBe(true);
    expect(validateToolSelection(sampleScenario, "exec")).toBe(false);
    expect(validateToolSelection(sampleScenario, null)).toBe(false);
  });

  it("detects must-not-call violations", () => {
    expect(validateMustNotCall(sampleScenario, "read")).toBeNull();
    expect(validateMustNotCall(sampleScenario, "exec")).toBe("exec");
    expect(validateMustNotCall(sampleScenario, "write")).toBe("write");
    expect(validateMustNotCall(sampleScenario, null)).toBeNull();
  });

  it("validates args with required fields", () => {
    const pass = validateArgs(sampleScenario, { path: "/tmp/file.txt" });
    expect(pass.pass).toBe(true);
    expect(pass.errors).toHaveLength(0);

    const fail = validateArgs(sampleScenario, {});
    expect(fail.pass).toBe(false);
    expect(fail.errors).toContain("missing required: path");
  });

  it("validates args type checking", () => {
    const fail = validateArgs(sampleScenario, { path: 42 });
    expect(fail.pass).toBe(false);
    expect(fail.errors.some((e) => e.includes("wrong type"))).toBe(true);
  });

  it("builds eval result correctly", () => {
    const result = buildEvalResult(sampleScenario, "full", 0, "read", { path: "/tmp/file.txt" });
    expect(result.scenarioId).toBe("test-read");
    expect(result.promptListingMode).toBe("full");
    expect(result.toolSelectionPass).toBe(true);
    expect(result.argsValidationPass).toBe(true);
    expect(result.mustNotCallViolation).toBeNull();
  });

  it("summarizes results by mode", () => {
    const results = [
      buildEvalResult(sampleScenario, "full", 0, "read", { path: "/a" }),
      buildEvalResult(sampleScenario, "full", 1, "read", { path: "/b" }),
      buildEvalResult(sampleScenario, "full", 2, "exec", { command: "ls" }),
    ];
    const summary = summarizeResults(results, "full");
    expect(summary.mode).toBe("full");
    expect(summary.totalRuns).toBe(3);
    expect(summary.toolSelectionAccuracy).toBeCloseTo(2 / 3, 2);
    expect(summary.mustNotCallViolations).toBe(1);
  });

  it("formats summary as readable text", () => {
    const results = [
      buildEvalResult(sampleScenario, "names", 0, "read", { path: "/a" }),
    ];
    const summary = summarizeResults(results, "names");
    const text = formatEvalSummary(summary);
    expect(text).toContain("mode=names");
    expect(text).toContain("100.0%");
  });
});
