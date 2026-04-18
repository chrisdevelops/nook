import { ValidationError } from "../errors/validation-error.ts";
import { err, ok, type Result } from "./result.ts";

export const parseKeyPath = (
  key: string,
): Result<readonly string[], ValidationError> => {
  if (key.length === 0) {
    return err(
      new ValidationError("Key is empty.", [{ path: "", message: "Key is empty." }]),
    );
  }
  const segments = key.split(".");
  for (const segment of segments) {
    if (segment.length === 0) {
      return err(
        new ValidationError(`Key '${key}' has an empty segment.`, [
          { path: key, message: "Empty segment in key path." },
        ]),
      );
    }
  }
  return ok(segments);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const getAtPath = (
  value: unknown,
  path: readonly string[],
): unknown | undefined => {
  if (path.length === 0) {
    return undefined;
  }
  let current: unknown = value;
  for (const segment of path) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

export type SetAtPathOptions = {
  readonly autoCreate: boolean;
};

export const setAtPath = <T>(
  value: T,
  path: readonly string[],
  newValue: unknown,
  options: SetAtPathOptions,
): Result<T, ValidationError> => {
  if (path.length === 0) {
    return err(
      new ValidationError("Key path is empty; cannot set a value.", [
        { path: "", message: "Key path is empty." },
      ]),
    );
  }
  if (!isPlainObject(value)) {
    return err(
      new ValidationError("Cannot set a path on a non-object value.", [
        { path: path.join("."), message: "Root value is not an object." },
      ]),
    );
  }

  const root: Record<string, unknown> = { ...value };
  let cursor: Record<string, unknown> = root;

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index] as string;
    const existing = cursor[segment];
    if (isPlainObject(existing)) {
      const cloned = { ...existing };
      cursor[segment] = cloned;
      cursor = cloned;
      continue;
    }
    if (existing !== undefined) {
      const prefix = path.slice(0, index + 1).join(".");
      return err(
        new ValidationError(
          `Path '${prefix}' crosses a non-object value.`,
          [{ path: prefix, message: "Crosses a non-object value." }],
        ),
      );
    }
    if (!options.autoCreate) {
      const prefix = path.slice(0, index + 1).join(".");
      return err(
        new ValidationError(
          `Key '${prefix}' does not exist.`,
          [{ path: prefix, message: "Missing parent key." }],
        ),
      );
    }
    const fresh: Record<string, unknown> = {};
    cursor[segment] = fresh;
    cursor = fresh;
  }

  const leaf = path[path.length - 1] as string;
  cursor[leaf] = newValue;
  return ok(root as T);
};
