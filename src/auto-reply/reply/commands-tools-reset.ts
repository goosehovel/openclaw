import { updateSessionStoreEntry } from "../../config/sessions/store.js";
import type { CommandHandler, CommandHandlerResult } from "./commands-types.js";

export const handleToolsResetCommand: CommandHandler = async (
  params,
  allowTextCommands,
): Promise<CommandHandlerResult | null> => {
  if (!allowTextCommands) return null;

  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/tools:reset") return null;

  if (!params.command.isAuthorizedSender) {
    return { shouldContinue: false };
  }

  if (!params.storePath || !params.sessionKey) {
    return {
      reply: { text: "Cannot reset tool overrides: no active session." },
      shouldContinue: false,
    };
  }

  const entry = params.sessionEntry;
  const hadOverrides = Boolean(
    entry?.toolsProfileOverride ||
    entry?.toolsAllowOverride?.length ||
    entry?.toolsDenyOverride?.length ||
    entry?.toolsPromptListingOverride,
  );

  await updateSessionStoreEntry({
    storePath: params.storePath,
    sessionKey: params.sessionKey,
    update: (existing) => ({
      ...existing,
      toolsProfileOverride: undefined,
      toolsAllowOverride: undefined,
      toolsDenyOverride: undefined,
      toolsPromptListingOverride: undefined,
    }),
  });

  if (params.sessionEntry) {
    params.sessionEntry.toolsProfileOverride = undefined;
    params.sessionEntry.toolsAllowOverride = undefined;
    params.sessionEntry.toolsDenyOverride = undefined;
    params.sessionEntry.toolsPromptListingOverride = undefined;
  }

  const message = hadOverrides
    ? "Tool overrides cleared. Tools restored to config baseline."
    : "No tool overrides were active.";

  return {
    reply: { text: message },
    shouldContinue: false,
  };
};
