import type { Command } from "commander";

import { registerAdoptCommand } from "../commands/adopt.ts";
import { registerAiCommand } from "../commands/ai.ts";
import {
  registerAliasCommand,
  registerConfiguredAliases,
} from "../commands/alias.ts";
import { registerArchiveCommand } from "../commands/archive.ts";
import { registerCdCommand } from "../commands/cd.ts";
import { registerCodeCommand } from "../commands/code.ts";
import { registerConfigCommand } from "../commands/config.ts";
import { registerDeleteCommand } from "../commands/delete.ts";
import { registerDoctorCommand } from "../commands/doctor.ts";
import { registerEditCommand } from "../commands/edit.ts";
import { registerInfoCommand } from "../commands/info.ts";
import { registerInitCommand } from "../commands/init.ts";
import { registerLsCommand } from "../commands/ls.ts";
import { registerMaintainCommand } from "../commands/maintain.ts";
import { registerNewCommand } from "../commands/new.ts";
import { registerOpenCommand } from "../commands/open.ts";
import { registerPauseCommand } from "../commands/pause.ts";
import { registerPromoteCommand } from "../commands/promote.ts";
import { registerReindexCommand } from "../commands/reindex.ts";
import { registerRenameCommand } from "../commands/rename.ts";
import { registerScanCommand } from "../commands/scan.ts";
import { registerShipCommand } from "../commands/ship.ts";
import { registerStaleCommand } from "../commands/stale.ts";
import { registerStatusCommand } from "../commands/status.ts";
import { registerUnarchiveCommand } from "../commands/unarchive.ts";
import { registerUnmaintainCommand } from "../commands/unmaintain.ts";
import { registerUnpauseCommand } from "../commands/unpause.ts";
import { registerUnshipCommand } from "../commands/unship.ts";
import type { CommandContext } from "./command-types.ts";
import { applyHelpGroups } from "./help-groups.ts";

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
  registerEditCommand(program, ctx);
  registerDeleteCommand(program, ctx);
  registerLsCommand(program, ctx);
  registerInfoCommand(program, ctx);
  registerStatusCommand(program, ctx);
  registerStaleCommand(program, ctx);
  registerOpenCommand(program, ctx);
  registerCodeCommand(program, ctx);
  registerAiCommand(program, ctx);
  registerCdCommand(program, ctx);
  registerAliasCommand(program, ctx);
  registerScanCommand(program, ctx);
  registerReindexCommand(program, ctx);
  registerDoctorCommand(program, ctx);
  applyHelpGroups(program);
  registerConfiguredAliases(program, ctx, ctx.config);
};
