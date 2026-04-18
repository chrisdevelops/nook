import type { Command } from "commander";

import { registerAdoptCommand } from "../commands/adopt.ts";
import { registerArchiveCommand } from "../commands/archive.ts";
import { registerConfigCommand } from "../commands/config.ts";
import { registerDeleteCommand } from "../commands/delete.ts";
import { registerInitCommand } from "../commands/init.ts";
import { registerMaintainCommand } from "../commands/maintain.ts";
import { registerNewCommand } from "../commands/new.ts";
import { registerPauseCommand } from "../commands/pause.ts";
import { registerPromoteCommand } from "../commands/promote.ts";
import { registerRenameCommand } from "../commands/rename.ts";
import { registerShipCommand } from "../commands/ship.ts";
import { registerUnarchiveCommand } from "../commands/unarchive.ts";
import { registerUnmaintainCommand } from "../commands/unmaintain.ts";
import { registerUnpauseCommand } from "../commands/unpause.ts";
import { registerUnshipCommand } from "../commands/unship.ts";
import type { CommandContext } from "./command-types.ts";

export const registerCommands = (
  program: Command,
  ctx: CommandContext,
): void => {
  registerConfigCommand(program, ctx);
  registerInitCommand(program, ctx);
  registerNewCommand(program, ctx);
  registerAdoptCommand(program, ctx);
  registerPromoteCommand(program, ctx);
  registerPauseCommand(program, ctx);
  registerUnpauseCommand(program, ctx);
  registerMaintainCommand(program, ctx);
  registerUnmaintainCommand(program, ctx);
  registerShipCommand(program, ctx);
  registerUnshipCommand(program, ctx);
  registerArchiveCommand(program, ctx);
  registerUnarchiveCommand(program, ctx);
  registerRenameCommand(program, ctx);
  registerDeleteCommand(program, ctx);
};
