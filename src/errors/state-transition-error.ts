import type { ProjectState } from "../core/project-types.ts";
import { CommandError } from "./command-error.ts";

export class StateTransitionError extends CommandError {
  readonly from: ProjectState;
  readonly to: ProjectState;

  constructor(from: ProjectState, to: ProjectState) {
    super(
      "state_transition",
      `Cannot transition from '${from}' to '${to}'.`,
    );
    this.name = "StateTransitionError";
    this.from = from;
    this.to = to;
  }
}
