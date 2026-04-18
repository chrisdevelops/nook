import type { Command } from "commander";

import { registerConfigCommand } from "../commands/config.ts";
import { registerInitCommand } from "../commands/init.ts";
import type { CommandContext } from "./command-types.ts";

export const registerCommands = (
  program: Command,
  ctx: CommandContext,
): void => {
  registerConfigCommand(program, ctx);
  registerInitCommand(program, ctx);
};
