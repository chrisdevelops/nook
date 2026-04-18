import { select, Separator } from "@inquirer/prompts";

export type SelectChoice<Value> = {
  readonly value: Value;
  readonly name?: string;
  readonly description?: string;
  readonly short?: string;
  readonly disabled?: boolean | string;
};

export type SelectPromptOptions<Value> = {
  readonly message: string;
  readonly choices: readonly (Separator | Value | SelectChoice<Value>)[];
  readonly default?: NoInfer<Value>;
  readonly pageSize?: number;
  readonly loop?: boolean;
};

export const promptSelect = async <Value>(
  options: SelectPromptOptions<Value>,
): Promise<Value> => select<Value>(options);

export { Separator };
