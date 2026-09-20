export type ShellTokenKind =
  | "plain"
  | "command"
  | "flag"
  | "operator"
  | "string"
  | "variable"
  | "number";

export interface ShellToken {
  readonly text: string;
  readonly kind: ShellTokenKind;
}

const commandWrappers = new Set(["builtin", "command", "env", "exec", "nohup", "sudo", "time"]);
const operators = new Set(["&&", "||", ">>", "<<", "|", ";", "&", ">", "<"]);

/** Colors shell command previews without starting a parser for each visible row. */
export function shellHighlightTokens(line: string): readonly ShellToken[] {
  const tokens: ShellToken[] = [];
  let index = 0;
  let expectsCommand = true;
  const status = /^\[[^\]]+\]\s*/u.exec(line);
  if (status) {
    tokens.push({ text: status[0], kind: "plain" });
    index = status[0].length;
  }

  while (index < line.length) {
    const rest = line.slice(index);
    const whitespace = /^\s+/u.exec(rest)?.[0];
    if (whitespace) {
      tokens.push({ text: whitespace, kind: "plain" });
      index += whitespace.length;
      continue;
    }
    if (rest.startsWith("#")) {
      tokens.push({ text: rest, kind: "plain" });
      break;
    }
    const quoted = /^(?:"(?:\\.|[^"\\])*"|'[^']*')/u.exec(rest)?.[0];
    if (quoted) {
      tokens.push({ text: quoted, kind: "string" });
      index += quoted.length;
      continue;
    }
    const variable = /^\$(?:\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*|[?#@*!$0-9-])/u.exec(rest)?.[0];
    if (variable) {
      tokens.push({ text: variable, kind: "variable" });
      index += variable.length;
      continue;
    }
    const operator = [...operators].find((candidate) => rest.startsWith(candidate));
    if (operator) {
      tokens.push({ text: operator, kind: "operator" });
      index += operator.length;
      if (operator === "&&" || operator === "||" || operator === "|" || operator === ";") {
        expectsCommand = true;
      }
      continue;
    }
    const word = /^[^\s|;&<>]+/u.exec(rest)?.[0] ?? rest[0]!;
    let kind: ShellTokenKind = "plain";
    if (/^--?[^-]/u.test(word)) kind = "flag";
    else if (/^\d+(?:\.\d+)?$/u.test(word)) kind = "number";
    else if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(word)) kind = "variable";
    else if (expectsCommand) kind = "command";
    tokens.push({ text: word, kind });
    index += word.length;
    if (kind === "command" && !commandWrappers.has(word)) expectsCommand = false;
  }

  return tokens;
}
