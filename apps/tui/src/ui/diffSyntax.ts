export type DiffTokenKind = "plain" | "keyword" | "string" | "comment" | "number";

export interface DiffToken {
  readonly text: string;
  readonly kind: DiffTokenKind;
}

interface Language {
  readonly comment: string;
  readonly keywords: ReadonlySet<string>;
}

const words = (text: string) => new Set(text.split(" "));
const C_LIKE = words(
  "if else for while do switch case default break continue return function class interface type enum const let var new delete try catch finally throw import export from as extends implements public private protected static async await yield this super null undefined true false void struct impl fn pub use mod match trait self package func go defer chan map range nil",
);
const SCRIPT = words(
  "if elif else for while in not and or is def class return import from as try except finally raise with lambda yield None True False pass break continue end do then fi done esac case function local module require unless elsif self nil true false",
);
const LANGUAGES: Readonly<Record<string, Language>> = Object.fromEntries([
  ...[
    "ts",
    "tsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "go",
    "rs",
    "java",
    "kt",
    "c",
    "h",
    "cc",
    "cpp",
    "cs",
    "swift",
  ].map((extension) => [extension, { comment: "//", keywords: C_LIKE }] as const),
  ...["py", "rb", "sh", "bash", "zsh", "toml", "yaml", "yml"].map(
    (extension) => [extension, { comment: "#", keywords: SCRIPT }] as const,
  ),
]);
const TOKEN =
  /("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d[\d_.]*\b)|([A-Za-z_][A-Za-z0-9_]*)/gu;

/**
 * Colors one line of code. A diff shows fragments, so this reads each line alone and cannot see
 * a block comment or string that started earlier. Files it has no language for stay plain.
 */
export function diffSyntaxTokens(code: string, path: string): readonly DiffToken[] {
  const language = LANGUAGES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
  if (!language) return [{ text: code, kind: "plain" }];
  const tokens: DiffToken[] = [];
  const push = (text: string, kind: DiffTokenKind) => {
    if (text) tokens.push({ text, kind });
  };
  let position = 0;
  for (const match of code.matchAll(TOKEN)) {
    const before = code.slice(position, match.index);
    const comment = before.indexOf(language.comment);
    if (comment >= 0) {
      position += comment;
      push(before.slice(0, comment), "plain");
      break;
    }
    push(before, "plain");
    const [text, string, number, word] = match;
    push(
      text,
      string
        ? "string"
        : number
          ? "number"
          : word && language.keywords.has(word)
            ? "keyword"
            : "plain",
    );
    position = match.index + text.length;
  }
  const rest = code.slice(position);
  const comment = rest.indexOf(language.comment);
  if (comment >= 0) {
    push(rest.slice(0, comment), "plain");
    push(rest.slice(comment), "comment");
  } else push(rest, "plain");
  return tokens;
}
