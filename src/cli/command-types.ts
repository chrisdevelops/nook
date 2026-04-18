import type { GlobalConfig } from "../core/project-types.ts";
import type { Result } from "../core/result.ts";
import type { CommandError } from "../errors/command-error.ts";
import type { AppPaths } from "../platform/app-paths.ts";
import type { detectBinaryOnPath } from "../platform/detect-binary-on-path.ts";
import type { launchEditor } from "../platform/launch-editor.ts";
import type { detectShell } from "../shell/detect-shell.ts";
import type { installRcIntegration } from "../shell/install-rc-integration.ts";
import type { findProject } from "../storage/find-project.ts";
import type { readGlobalConfig, writeGlobalConfig } from "../storage/global-config.ts";
import type { openIndex } from "../storage/project-index.ts";
import type { readHistoryEvents } from "../storage/project-history.ts";
import type { appendHistoryEvent } from "../storage/project-history.ts";
import type {
  readProjectMetadata,
  writeProjectMetadata,
} from "../storage/project-metadata.ts";
import type { Logger } from "../ui/logger.ts";
import type { promptConfirm } from "../ui/prompt-confirm.ts";
import type { promptInput } from "../ui/prompt-input.ts";
import type { promptSelect } from "../ui/prompt-select.ts";
import type { renderProjectList } from "../ui/render-project-list.ts";
import type { renderStatus } from "../ui/render-status.ts";
import type { createSpinner } from "../ui/spinner.ts";

export type Clock = {
  readonly now: () => number;
};

export type StorageFacade = {
  readonly readProjectMetadata: typeof readProjectMetadata;
  readonly writeProjectMetadata: typeof writeProjectMetadata;
  readonly appendHistoryEvent: typeof appendHistoryEvent;
  readonly readHistoryEvents: typeof readHistoryEvents;
  readonly readGlobalConfig: typeof readGlobalConfig;
  readonly writeGlobalConfig: typeof writeGlobalConfig;
  readonly openIndex: typeof openIndex;
  readonly findProject: typeof findProject;
};

export type UI = {
  readonly logger: Logger;
  readonly createSpinner: typeof createSpinner;
  readonly promptSelect: typeof promptSelect;
  readonly promptConfirm: typeof promptConfirm;
  readonly promptInput: typeof promptInput;
  readonly renderProjectList: typeof renderProjectList;
  readonly renderStatus: typeof renderStatus;
  readonly launchEditor: typeof launchEditor;
  readonly detectBinaryOnPath: typeof detectBinaryOnPath;
  readonly detectShell: typeof detectShell;
  readonly installRcIntegration: typeof installRcIntegration;
};

export type CommandContext = {
  readonly config: GlobalConfig;
  readonly storage: StorageFacade;
  readonly ui: UI;
  readonly clock: Clock;
  readonly cwd: string;
  readonly appPaths: AppPaths;
  readonly runResult: (result: Result<unknown, CommandError>) => void;
};

export type CommandHandler<Args> = (
  args: Args,
  ctx: CommandContext,
) => Promise<Result<void, CommandError>>;
