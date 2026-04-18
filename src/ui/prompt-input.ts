import { input } from "@inquirer/prompts";

export type InputPromptOptions = {
  readonly message: string;
  readonly default?: string;
  readonly required?: boolean;
  readonly validate?: (
    value: string,
  ) => boolean | string | Promise<boolean | string>;
  readonly transformer?: (
    value: string,
    context: { readonly isFinal: boolean },
  ) => string;
};

export const promptInput = async (
  options: InputPromptOptions,
): Promise<string> => input(options);
