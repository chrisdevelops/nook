export const parseJsonc = (text: string): unknown =>
  JSON.parse(stripTrailingCommas(stripComments(text)));

const stripComments = (text: string): string => {
  let out = "";
  let i = 0;
  const length = text.length;

  while (i < length) {
    const char = text[i]!;

    if (char === '"') {
      out += char;
      i++;
      while (i < length) {
        const inner = text[i]!;
        out += inner;
        if (inner === "\\" && i + 1 < length) {
          out += text[i + 1];
          i += 2;
          continue;
        }
        i++;
        if (inner === '"') break;
      }
      continue;
    }

    if (char === "/" && text[i + 1] === "/") {
      while (i < length && text[i] !== "\n") i++;
      continue;
    }

    if (char === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    out += char;
    i++;
  }

  return out;
};

const stripTrailingCommas = (text: string): string => {
  let out = "";
  let i = 0;
  const length = text.length;

  while (i < length) {
    const char = text[i]!;

    if (char === '"') {
      out += char;
      i++;
      while (i < length) {
        const inner = text[i]!;
        out += inner;
        if (inner === "\\" && i + 1 < length) {
          out += text[i + 1];
          i += 2;
          continue;
        }
        i++;
        if (inner === '"') break;
      }
      continue;
    }

    if (char === ",") {
      let lookahead = i + 1;
      while (lookahead < length) {
        const next = text[lookahead]!;
        if (next === " " || next === "\t" || next === "\n" || next === "\r") {
          lookahead++;
          continue;
        }
        break;
      }
      if (lookahead < length && (text[lookahead] === "}" || text[lookahead] === "]")) {
        i++;
        continue;
      }
    }

    out += char;
    i++;
  }

  return out;
};
