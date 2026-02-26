import {
  CORE_TOOL_GROUPS,
  resolveCoreToolProfilePolicy,
  resolveNamedToolProfilePolicy,
  type ToolProfileId,
} from "./tool-catalog.js";
import type { NamedToolProfile } from "../config/types.tools.js";

type ToolProfilePolicy = {
  allow?: string[];
  deny?: string[];
};

const TOOL_NAME_ALIASES: Record<string, string> = {
  bash: "exec",
  "apply-patch": "apply_patch",
};

export const TOOL_GROUPS: Record<string, string[]> = { ...CORE_TOOL_GROUPS };

export function normalizeToolName(name: string) {
  const normalized = name.trim().toLowerCase();
  return TOOL_NAME_ALIASES[normalized] ?? normalized;
}

export function normalizeToolList(list?: string[]) {
  if (!list) {
    return [];
  }
  return list.map(normalizeToolName).filter(Boolean);
}

export function expandToolGroups(list?: string[]) {
  const normalized = normalizeToolList(list);
  const expanded: string[] = [];
  for (const value of normalized) {
    const group = TOOL_GROUPS[value];
    if (group) {
      expanded.push(...group);
      continue;
    }
    expanded.push(value);
  }
  return Array.from(new Set(expanded));
}

export function resolveToolProfilePolicy(
  profile?: string,
  namedProfiles?: Record<string, NamedToolProfile>,
): ToolProfilePolicy | undefined {
  const coreResult = resolveCoreToolProfilePolicy(profile);
  if (coreResult) return coreResult;

  if (profile && namedProfiles) {
    const namedResult = resolveNamedToolProfilePolicy(profile, namedProfiles);
    if (namedResult) return namedResult.policy;
  }

  return undefined;
}

export type { ToolProfileId };
