export type EvalScenario = {
  id: string;
  description: string;
  userMessage: string;
  toolGroup: string;
  allowedToolNames: string[];
  expectedArgsSchema?: Record<string, unknown>;
  mustNotCallTools?: string[];
};

export type EvalResult = {
  scenarioId: string;
  promptListingMode: "full" | "names" | "off";
  runIndex: number;
  toolCallName: string | null;
  toolSelectionPass: boolean;
  argsValidationPass: boolean | null;
  argsErrors: string[];
  mustNotCallViolation: string | null;
};

export type EvalSummary = {
  mode: "full" | "names" | "off";
  totalScenarios: number;
  totalRuns: number;
  toolSelectionAccuracy: number;
  argsValidationAccuracy: number;
  mustNotCallViolations: number;
  compositeScore: number;
  perScenario: Array<{
    scenarioId: string;
    toolSelectionRate: number;
    argsValidationRate: number;
  }>;
};
