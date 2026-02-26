import type { Command } from "commander";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import type { SessionSystemPromptReport } from "../config/sessions/types.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";

function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}

function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatCharsAndTokens(chars: number): string {
  return `${formatInt(chars)} chars (~${formatInt(estimateTokensFromChars(chars))} tok)`;
}

type TokenCensusOptions = {
  json?: boolean;
  provider?: string;
  model?: string;
  profile?: string;
  compareProfile?: string;
  promptListing?: string;
  agentId?: string;
};

type CensusToolEntry = {
  name: string;
  summaryChars: number;
  schemaChars: number;
  propertiesCount: number | null;
};

type CensusReport = {
  provider?: string;
  model?: string;
  profile?: string;
  promptListing: string;
  tools: {
    listChars: number;
    schemaChars: number;
    totalToolChars: number;
    count: number;
    entries: CensusToolEntry[];
  };
  systemPrompt: {
    chars: number;
    projectContextChars: number;
    nonProjectContextChars: number;
  };
  estimatedTokens: {
    systemPrompt: number;
    toolList: number;
    toolSchemas: number;
    total: number;
  };
};

function buildCensusFromReport(
  report: SessionSystemPromptReport,
  opts: { provider?: string; model?: string; profile?: string; promptListing?: string },
): CensusReport {
  const entries = [...report.tools.entries].toSorted((a, b) => b.schemaChars - a.schemaChars);
  const totalToolChars = report.tools.listChars + report.tools.schemaChars;
  return {
    provider: opts.provider ?? report.provider,
    model: opts.model ?? report.model,
    profile: opts.profile,
    promptListing: opts.promptListing ?? "full",
    tools: {
      listChars: report.tools.listChars,
      schemaChars: report.tools.schemaChars,
      totalToolChars,
      count: entries.length,
      entries,
    },
    systemPrompt: report.systemPrompt,
    estimatedTokens: {
      systemPrompt: estimateTokensFromChars(report.systemPrompt.chars),
      toolList: estimateTokensFromChars(report.tools.listChars),
      toolSchemas: estimateTokensFromChars(report.tools.schemaChars),
      total: estimateTokensFromChars(report.systemPrompt.chars + report.tools.schemaChars),
    },
  };
}

function formatCensusText(census: CensusReport, label?: string): string {
  const lines: string[] = [];
  if (label) {
    lines.push(`=== ${label} ===`);
  }
  lines.push(`Provider: ${census.provider ?? "(default)"}`);
  lines.push(`Model: ${census.model ?? "(default)"}`);
  if (census.profile) {
    lines.push(`Profile: ${census.profile}`);
  }
  lines.push(`Prompt listing mode: ${census.promptListing}`);
  lines.push("");
  lines.push("--- Token Estimates ---");
  lines.push(`System prompt: ${formatCharsAndTokens(census.systemPrompt.chars)}`);
  lines.push(`  Project context: ${formatCharsAndTokens(census.systemPrompt.projectContextChars)}`);
  lines.push(
    `  Non-project context: ${formatCharsAndTokens(census.systemPrompt.nonProjectContextChars)}`,
  );
  lines.push(`Tool list (prompt text): ${formatCharsAndTokens(census.tools.listChars)}`);
  lines.push(`Tool schemas (JSON): ${formatCharsAndTokens(census.tools.schemaChars)}`);
  lines.push(`Total tool overhead: ${formatCharsAndTokens(census.tools.totalToolChars)}`);
  lines.push(
    `Estimated total input floor: ~${formatInt(census.estimatedTokens.total)} tokens (system + schemas)`,
  );
  lines.push("");
  lines.push(`--- Per-Tool Breakdown (${census.tools.count} tools) ---`);
  for (const entry of census.tools.entries) {
    const props = entry.propertiesCount != null ? ` (${entry.propertiesCount} params)` : "";
    lines.push(
      `  ${entry.name}: schema ${formatCharsAndTokens(entry.schemaChars)}, summary ${formatCharsAndTokens(entry.summaryChars)}${props}`,
    );
  }
  return lines.join("\n");
}

function formatDelta(a: CensusReport, b: CensusReport, labelA: string, labelB: string): string {
  const lines: string[] = [];
  lines.push("--- A/B Delta ---");
  lines.push(`  [A] ${labelA}: ${a.tools.count} tools`);
  lines.push(`  [B] ${labelB}: ${b.tools.count} tools`);
  const toolsDelta = b.tools.totalToolChars - a.tools.totalToolChars;
  const tokensDelta = b.estimatedTokens.total - a.estimatedTokens.total;
  const sign = (n: number) => (n >= 0 ? "+" : "");
  lines.push(
    `  Tool overhead delta: ${sign(toolsDelta)}${formatCharsAndTokens(toolsDelta)}`,
  );
  lines.push(`  Total token delta: ${sign(tokensDelta)}${formatInt(tokensDelta)} tokens`);

  const aToolNames = new Set(a.tools.entries.map((t) => t.name));
  const bToolNames = new Set(b.tools.entries.map((t) => t.name));
  const added = [...bToolNames].filter((n) => !aToolNames.has(n));
  const removed = [...aToolNames].filter((n) => !bToolNames.has(n));
  if (added.length) {
    lines.push(`  Added in [B]: ${added.join(", ")}`);
  }
  if (removed.length) {
    lines.push(`  Removed in [B]: ${removed.join(", ")}`);
  }
  return lines.join("\n");
}

async function resolveTokenCensusReport(opts: {
  provider?: string;
  model?: string;
  profile?: string;
  agentId?: string;
}): Promise<SessionSystemPromptReport> {
  const config = loadConfig();
  const agentId = opts.agentId ?? resolveDefaultAgentId(config);
  const workspaceDir = resolveAgentWorkspaceDir(config, agentId);

  const {
    resolveBootstrapMaxChars,
    resolveBootstrapTotalMaxChars,
  } = await import("../agents/pi-embedded-helpers.js");
  const { buildSystemPromptReport } = await import("../agents/system-prompt-report.js");
  const { buildAgentSystemPrompt } = await import("../agents/system-prompt.js");
  const { createOpenClawCodingTools } = await import("../agents/pi-tools.js");
  const { buildToolSummaryMap } = await import("../agents/tool-summaries.js");

  const overriddenConfig = { ...config };
  if (opts.profile) {
    overriddenConfig.tools = { ...overriddenConfig.tools, profile: opts.profile as never };
  }

  const tools = createOpenClawCodingTools({
    config: overriddenConfig,
    modelProvider: opts.provider,
  });

  const toolSummaries = buildToolSummaryMap(tools as never[]);
  const toolNames = tools.map((t) => (t as { name: string }).name);

  const systemPrompt = buildAgentSystemPrompt({
    toolNames,
    toolSummaries,
  });

  const bootstrapMaxChars = resolveBootstrapMaxChars(config);
  const bootstrapTotalMaxChars = resolveBootstrapTotalMaxChars(config);

  return buildSystemPromptReport({
    source: "estimate",
    generatedAt: Date.now(),
    provider: opts.provider,
    model: opts.model,
    workspaceDir,
    bootstrapMaxChars,
    bootstrapTotalMaxChars,
    systemPrompt,
    bootstrapFiles: [],
    injectedFiles: [],
    skillsPrompt: "",
    tools: tools as never[],
  });
}

export function registerToolsCli(program: Command) {
  const tools = program
    .command("tools")
    .description("Inspect and analyze tool configuration, schemas, and token usage")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/tools", "docs.openclaw.ai/tools")}\n`,
    );

  tools
    .command("token-census")
    .description("Report per-tool schema/summary token contributions and estimated input floor")
    .option("--json", "Output as JSON", false)
    .option("--provider <provider>", "Provider id (e.g. openai, anthropic, google-antigravity)")
    .option("--model <model>", "Model id")
    .option("--profile <profile>", "Tool profile to evaluate")
    .option("--compare-profile <profile>", "Compare against this profile (A/B delta)")
    .option("--prompt-listing <mode>", "Prompt listing mode: full, names, off", "full")
    .option("--agent-id <id>", "Agent id (defaults to default agent)")
    .action(async (opts: TokenCensusOptions) => {
      try {
        const reportA = await resolveTokenCensusReport({
          provider: opts.provider,
          model: opts.model,
          profile: opts.profile,
          agentId: opts.agentId,
        });
        const censusA = buildCensusFromReport(reportA, {
          provider: opts.provider,
          model: opts.model,
          profile: opts.profile,
          promptListing: opts.promptListing,
        });

        if (opts.compareProfile) {
          const reportB = await resolveTokenCensusReport({
            provider: opts.provider,
            model: opts.model,
            profile: opts.compareProfile,
            agentId: opts.agentId,
          });
          const censusB = buildCensusFromReport(reportB, {
            provider: opts.provider,
            model: opts.model,
            profile: opts.compareProfile,
            promptListing: opts.promptListing,
          });

          if (opts.json) {
            defaultRuntime.log(
              JSON.stringify({ a: censusA, b: censusB }, null, 2),
            );
          } else {
            const labelA = opts.profile ?? "(default)";
            const labelB = opts.compareProfile;
            defaultRuntime.log(formatCensusText(censusA, `Profile: ${labelA}`));
            defaultRuntime.log("");
            defaultRuntime.log(formatCensusText(censusB, `Profile: ${labelB}`));
            defaultRuntime.log("");
            defaultRuntime.log(formatDelta(censusA, censusB, labelA, labelB));
          }
        } else {
          if (opts.json) {
            defaultRuntime.log(JSON.stringify(censusA, null, 2));
          } else {
            defaultRuntime.log(formatCensusText(censusA));
          }
        }
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });
}
