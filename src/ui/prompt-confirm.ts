import { confirm } from "@inquirer/prompts";

export type ConfirmPromptOptions = {
  readonly message: string;
  readonly default?: boolean;
};

export const promptConfirm = async (
  options: ConfirmPromptOptions,
): Promise<boolean> => confirm(options);
