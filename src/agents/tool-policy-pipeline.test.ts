import { describe, expect, test } from "vitest";
import {
  applyToolPolicyPipeline,
  buildDefaultToolPolicyPipelineSteps,
} from "./tool-policy-pipeline.js";

type DummyTool = { name: string };

// oxlint-disable-next-line typescript/no-explicit-any
const asTools = (tools: DummyTool[]) => tools as any;
// oxlint-disable-next-line typescript/no-explicit-any
const noMeta = () => undefined as any;
const getNames = (filtered: { name: string }[]) =>
  filtered.map((t) => (t as unknown as DummyTool).name).toSorted();

describe("tool-policy-pipeline", () => {
  test("strips allowlists that would otherwise disable core tools", () => {
    const tools = [{ name: "exec" }, { name: "plugin_tool" }] as unknown as DummyTool[];
    const filtered = applyToolPolicyPipeline({
      tools: asTools(tools),
      // oxlint-disable-next-line typescript/no-explicit-any
      toolMeta: (t: any) => (t.name === "plugin_tool" ? { pluginId: "foo" } : undefined),
      warn: () => {},
      steps: [
        {
          policy: { allow: ["plugin_tool"] },
          label: "tools.allow",
          stripPluginOnlyAllowlist: true,
        },
      ],
    });
    const names = filtered.map((t) => (t as unknown as DummyTool).name).toSorted();
    expect(names).toEqual(["exec", "plugin_tool"]);
  });

  test("warns about unknown allowlist entries", () => {
    const warnings: string[] = [];
    const tools = [{ name: "exec" }] as unknown as DummyTool[];
    applyToolPolicyPipeline({
      tools: asTools(tools),
      toolMeta: noMeta,
      warn: (msg) => warnings.push(msg),
      steps: [
        {
          policy: { allow: ["wat"] },
          label: "tools.allow",
          stripPluginOnlyAllowlist: true,
        },
      ],
    });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("unknown entries (wat)");
  });

  test("applies allowlist filtering when core tools are explicitly listed", () => {
    const tools = [{ name: "exec" }, { name: "process" }] as unknown as DummyTool[];
    const filtered = applyToolPolicyPipeline({
      tools: asTools(tools),
      toolMeta: noMeta,
      warn: () => {},
      steps: [
        {
          policy: { allow: ["exec"] },
          label: "tools.allow",
          stripPluginOnlyAllowlist: true,
        },
      ],
    });
    expect(filtered.map((t) => (t as unknown as DummyTool).name)).toEqual(["exec"]);
  });
});

describe("pipeline invariants", () => {
  const allTools: DummyTool[] = [
    { name: "read" },
    { name: "write" },
    { name: "exec" },
    { name: "message" },
    { name: "session_status" },
    { name: "web_search" },
    { name: "grep" },
  ];

  test("deny wins: a tool in both allow and deny is excluded", () => {
    const filtered = applyToolPolicyPipeline({
      tools: asTools(allTools),
      toolMeta: noMeta,
      warn: () => {},
      steps: [
        { policy: { allow: ["read", "exec", "message"], deny: ["exec"] }, label: "test" },
      ],
    });
    const names = getNames(filtered);
    expect(names).toContain("read");
    expect(names).toContain("message");
    expect(names).not.toContain("exec");
  });

  test("narrow-only: session override cannot reintroduce tools removed by earlier steps", () => {
    const filtered = applyToolPolicyPipeline({
      tools: asTools(allTools),
      toolMeta: noMeta,
      warn: () => {},
      steps: [
        { policy: { allow: ["read", "exec"] }, label: "sandbox" },
        { policy: { allow: ["read", "exec", "write", "message"] }, label: "session override" },
      ],
    });
    const names = getNames(filtered);
    // Session step tried to add write and message but can't widen sandbox
    expect(names).toContain("read");
    expect(names).toContain("exec");
    expect(names).not.toContain("write");
    expect(names).not.toContain("message");
  });

  test("ordering: session override runs after sandbox and subagent steps", () => {
    const filtered = applyToolPolicyPipeline({
      tools: asTools(allTools),
      toolMeta: noMeta,
      warn: () => {},
      steps: [
        { policy: { allow: ["read", "exec", "message", "grep"] }, label: "sandbox tools.allow" },
        { policy: { allow: ["read", "exec", "message"] }, label: "subagent tools.allow" },
        { policy: { deny: ["exec"] }, label: "session override" },
      ],
    });
    const names = getNames(filtered);
    // sandbox narrows to 4 tools, subagent narrows further to 3, session denies exec
    expect(names).toEqual(["message", "read"]);
  });

  test("gateway deny: applies after all pipeline steps including session override", () => {
    const pipelineResult = applyToolPolicyPipeline({
      tools: asTools(allTools),
      toolMeta: noMeta,
      warn: () => {},
      steps: [
        { policy: { allow: ["read", "exec", "message"] }, label: "sandbox" },
        { policy: undefined, label: "session override" },
      ],
    });
    // Simulate gateway deny post-pipeline (same as tools-invoke-http.ts)
    const gatewayDenySet = new Set(["exec"]);
    const gatewayFiltered = pipelineResult.filter(
      (t) => !gatewayDenySet.has((t as unknown as DummyTool).name),
    );
    const names = getNames(gatewayFiltered);
    expect(names).toContain("read");
    expect(names).toContain("message");
    expect(names).not.toContain("exec");
  });

  test("default pipeline has exactly 7 steps", () => {
    const steps = buildDefaultToolPolicyPipelineSteps({});
    expect(steps).toHaveLength(7);
  });

  test("default pipeline step labels are ordered correctly", () => {
    const steps = buildDefaultToolPolicyPipelineSteps({
      profilePolicy: { allow: ["read"] },
      profile: "coding",
      providerProfilePolicy: { allow: ["read"] },
      providerProfile: "coding",
      globalPolicy: { allow: ["read"] },
      globalProviderPolicy: { allow: ["read"] },
      agentPolicy: { allow: ["read"] },
      agentProviderPolicy: { allow: ["read"] },
      groupPolicy: { allow: ["read"] },
      agentId: "test",
    });
    const labels = steps.map((s) => s.label);
    expect(labels).toEqual([
      "tools.profile (coding)",
      "tools.byProvider.profile (coding)",
      "tools.allow",
      "tools.byProvider.allow",
      "agents.test.tools.allow",
      "agents.test.tools.byProvider.allow",
      "group tools.allow",
    ]);
  });

  test("session deny cannot re-grant tools removed by sandbox", () => {
    const filtered = applyToolPolicyPipeline({
      tools: asTools(allTools),
      toolMeta: noMeta,
      warn: () => {},
      steps: [
        { policy: { deny: ["exec", "write"] }, label: "sandbox" },
        { policy: { allow: ["read", "exec", "write", "message"] }, label: "session override" },
      ],
    });
    const names = getNames(filtered);
    expect(names).not.toContain("exec");
    expect(names).not.toContain("write");
    expect(names).toContain("read");
    expect(names).toContain("message");
  });
});

describe("pipeline runtime warnings", () => {
  const tools: DummyTool[] = [
    { name: "read" },
    { name: "exec" },
    { name: "session_status" },
  ];

  test("warns when named profile results in zero tools", () => {
    const warnings: string[] = [];
    applyToolPolicyPipeline({
      tools: asTools(tools),
      toolMeta: noMeta,
      warn: (msg) => warnings.push(msg),
      steps: [{ policy: { allow: ["nonexistent"] }, label: "test" }],
      namedProfileContext: { profileName: "marketing", headlineTools: ["message"] },
    });
    expect(warnings.some((w) => w.includes("zero tools"))).toBe(true);
  });

  test("warns when named profile results in only session_status", () => {
    const warnings: string[] = [];
    applyToolPolicyPipeline({
      tools: asTools(tools),
      toolMeta: noMeta,
      warn: (msg) => warnings.push(msg),
      steps: [{ policy: { allow: ["session_status"] }, label: "test" }],
      namedProfileContext: { profileName: "marketing", headlineTools: ["message"] },
    });
    expect(warnings.some((w) => w.includes("only session_status"))).toBe(true);
  });

  test("warns when headline tools are all removed", () => {
    const warnings: string[] = [];
    applyToolPolicyPipeline({
      tools: asTools(tools),
      toolMeta: noMeta,
      warn: (msg) => warnings.push(msg),
      steps: [{ policy: { allow: ["read", "exec"] }, label: "test" }],
      namedProfileContext: { profileName: "marketing", headlineTools: ["message", "web_search"] },
    });
    expect(warnings.some((w) => w.includes("headline tools"))).toBe(true);
  });

  test("does not warn when headline tools are present", () => {
    const warnings: string[] = [];
    applyToolPolicyPipeline({
      tools: asTools(tools),
      toolMeta: noMeta,
      warn: (msg) => warnings.push(msg),
      steps: [],
      namedProfileContext: { profileName: "coding", headlineTools: ["read", "exec"] },
    });
    expect(warnings).toHaveLength(0);
  });
});
