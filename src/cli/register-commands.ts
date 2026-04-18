import type { Command } from "commander";

import { registerAdoptCommand } from "../commands/adopt.ts";
import { registerConfigCommand } from "../commands/config.ts";
import { registerInitCommand } from "../commands/init.ts";
import { registerMaintainCommand } from "../commands/maintain.ts";
import { registerNewCommand } from "../commands/new.ts";
import { registerPauseCommand } from "../commands/pause.ts";
import { registerUnmaintainCommand } from "../commands/unmaintain.ts";
import { registerUnpauseCommand } from "../commands/unpause.ts";
import type { CommandContext } from "./command-types.ts";

export const registerCommands = (
  program: Command,
  ctx: CommandContext,
): void => {
  registerConfigCommand(program, ctx);
  registerInitCommand(program, ctx);
  registerNewCommand(program, ctx);
  registerAdoptCommand(program, ctx);
  registerPauseCommand(program, ctx);
  registerUnpauseCommand(program, ctx);
  registerMaintainCommand(program, ctx);
  registerUnmaintainCommand(program, ctx);
};
