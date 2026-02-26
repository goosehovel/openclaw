import fs from "node:fs";
import path from "node:path";
import type { EvalResult, EvalScenario, EvalSummary } from "./types.js";

const SCENARIOS_DIR = path.join(import.meta.dirname ?? __dirname, "scenarios");
const RUNS_PER_SCENARIO = 3;
const LISTING_MODES = ["full", "names", "off"] as const;

export function loadScenarios(): EvalScenario[] {
  const files = fs.readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith(".json"));
  return files.map((file) => {
    const content = fs.readFileSync(path.join(SCENARIOS_DIR, file), "utf-8");
    return JSON.parse(content) as EvalScenario;
  });
}

export function validateToolSelection(
  scenario: EvalScenario,
  toolCallName: string | null,
): boolean {
  if (!toolCallName) return false;
  return scenario.allowedToolNames.includes(toolCallName);
}

export function validateMustNotCall(
  scenario: EvalScenario,
  toolCallName: string | null,
): string | null {
  if (!toolCallName) return null;
  if (!scenario.mustNotCallTools) return null;
  if (scenario.mustNotCallTools.includes(toolCallName)) {
    return toolCallName;
  }
  return null;
}

/**
 * Validate tool call args against the scenario's expected schema.
 * Uses a simplified structural check (not full AJV) for zero-dep operation.
 * For production eval runs, use AJV for strict validation.
 */
export function validateArgs(
  scenario: EvalScenario,
  args: Record<string, unknown> | null,
): { pass: boolean; errors: string[] } {
  if (!scenario.expectedArgsSchema) {
    return { pass: true, errors: [] };
  }
  if (!args) {
    return { pass: false, errors: ["args is null"] };
  }

  const errors: string[] = [];
  const schema = scenario.expectedArgsSchema;

  const required = (schema.required ?? []) as string[];
  for (const key of required) {
    if (!(key in args)) {
      errors.push(`missing required: ${key}`);
    }
  }

  const properties = (schema.properties ?? {}) as Record<string, { type?: string; const?: unknown }>;
  for (const [key, propSchema] of Object.entries(properties)) {
    if (!(key in args)) continue;
    const value = args[key];

    if (propSchema.type) {
      const actualType = typeof value;
      if (propSchema.type === "string" && actualType !== "string") {
        errors.push(`wrong type for ${key}: expected string, got ${actualType}`);
      }
      if (propSchema.type === "number" && actualType !== "number") {
        errors.push(`wrong type for ${key}: expected number, got ${actualType}`);
      }
      if (propSchema.type === "boolean" && actualType !== "boolean") {
        errors.push(`wrong type for ${key}: expected boolean, got ${actualType}`);
      }
    }

    if (propSchema.const !== undefined && value !== propSchema.const) {
      errors.push(`wrong value for ${key}: expected ${JSON.stringify(propSchema.const)}, got ${JSON.stringify(value)}`);
    }
  }

  return { pass: errors.length === 0, errors };
}

export function buildEvalResult(
  scenario: EvalScenario,
  mode: "full" | "names" | "off",
  runIndex: number,
  toolCallName: string | null,
  toolCallArgs: Record<string, unknown> | null,
): EvalResult {
  const toolSelectionPass = validateToolSelection(scenario, toolCallName);
  const argsResult = scenario.expectedArgsSchema
    ? validateArgs(scenario, toolCallArgs)
    : { pass: true, errors: [] };
  const mustNotCallViolation = validateMustNotCall(scenario, toolCallName);

  return {
    scenarioId: scenario.id,
    promptListingMode: mode,
    runIndex,
    toolCallName,
    toolSelectionPass,
    argsValidationPass: scenario.expectedArgsSchema ? argsResult.pass : null,
    argsErrors: argsResult.errors,
    mustNotCallViolation,
  };
}

export function summarizeResults(
  results: EvalResult[],
  mode: "full" | "names" | "off",
): EvalSummary {
  const modeResults = results.filter((r) => r.promptListingMode === mode);
  const scenarioIds = [...new Set(modeResults.map((r) => r.scenarioId))];

  const toolSelectionPasses = modeResults.filter((r) => r.toolSelectionPass).length;
  const argsResults = modeResults.filter((r) => r.argsValidationPass !== null);
  const argsValidationPasses = argsResults.filter((r) => r.argsValidationPass).length;
  const mustNotCallViolations = modeResults.filter((r) => r.mustNotCallViolation !== null).length;

  const totalRuns = modeResults.length;
  const toolSelectionAccuracy = totalRuns > 0 ? toolSelectionPasses / totalRuns : 0;
  const argsValidationAccuracy = argsResults.length > 0 ? argsValidationPasses / argsResults.length : 0;
  const compositeScore = (toolSelectionAccuracy + argsValidationAccuracy) / 2;

  const perScenario = scenarioIds.map((id) => {
    const scenarioResults = modeResults.filter((r) => r.scenarioId === id);
    const selectionPasses = scenarioResults.filter((r) => r.toolSelectionPass).length;
    const argsScenarioResults = scenarioResults.filter((r) => r.argsValidationPass !== null);
    const argsPasses = argsScenarioResults.filter((r) => r.argsValidationPass).length;
    return {
      scenarioId: id,
      toolSelectionRate: scenarioResults.length > 0 ? selectionPasses / scenarioResults.length : 0,
      argsValidationRate: argsScenarioResults.length > 0 ? argsPasses / argsScenarioResults.length : 0,
    };
  });

  return {
    mode,
    totalScenarios: scenarioIds.length,
    totalRuns,
    toolSelectionAccuracy,
    argsValidationAccuracy,
    mustNotCallViolations,
    compositeScore,
    perScenario,
  };
}

export function formatEvalSummary(summary: EvalSummary): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines: string[] = [
    `=== Eval Summary: mode=${summary.mode} ===`,
    `Scenarios: ${summary.totalScenarios}`,
    `Total runs: ${summary.totalRuns}`,
    `Tool selection accuracy: ${pct(summary.toolSelectionAccuracy)}`,
    `Args validation accuracy: ${pct(summary.argsValidationAccuracy)}`,
    `Must-not-call violations: ${summary.mustNotCallViolations}`,
    `Composite score: ${pct(summary.compositeScore)}`,
    "",
    "Per-scenario:",
  ];
  for (const s of summary.perScenario) {
    lines.push(`  ${s.scenarioId}: selection=${pct(s.toolSelectionRate)} args=${pct(s.argsValidationRate)}`);
  }
  return lines.join("\n");
}

export { SCENARIOS_DIR, RUNS_PER_SCENARIO, LISTING_MODES };
