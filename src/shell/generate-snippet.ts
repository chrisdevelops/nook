import type { Shell } from "./detect-shell.ts";

export const BEGIN_MARKER = "# >>> nook shell integration >>>";
export const END_MARKER = "# <<< nook shell integration <<<";

const posixBody = [
  'nook-cd() { cd "$(nook cd "$1")"; }',
  'nook-ai() { cd "$(nook cd "$1")" && $(nook config get ai.default); }',
].join("\n");

const fishBody = [
  "function nook-cd",
  "    cd (nook cd $argv[1])",
  "end",
  "",
  "function nook-ai",
  "    cd (nook cd $argv[1]); and eval (nook config get ai.default)",
  "end",
].join("\n");

const powershellBody = [
  "function nook-cd { Set-Location (nook cd $args[0]) }",
  "function nook-ai { Set-Location (nook cd $args[0]); & (nook config get ai.default) }",
].join("\n");

const bodyFor = (shell: Shell): string => {
  switch (shell) {
    case "bash":
    case "zsh":
      return posixBody;
    case "fish":
      return fishBody;
    case "powershell":
      return powershellBody;
  }
};

export const generateSnippet = (shell: Shell): string =>
  `${BEGIN_MARKER}\n${bodyFor(shell)}\n${END_MARKER}\n`;
