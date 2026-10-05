import { parseMermaid, renderMermaidASCII } from "beautiful-mermaid";
import stringWidth from "string-width";

type Diagram =
  | { readonly lines: readonly string[]; readonly columns: number }
  | { readonly reason: string };

// History and live turns share completed diagrams. Bound both work and retained output so
// a large diagram cannot dominate rendering every time a conversation updates.
const cache = new Map<string, Diagram>();
const cacheLimit = 32;
const maxSourceLength = 8_000;
const maxStatements = 100;

export function closedMermaidFence(raw: string): boolean {
  const lines = raw.trimEnd().split("\n");
  const opening = /^ {0,3}(`{3,}|~{3,})/u.exec(lines[0] ?? "")?.[1];
  const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(lines.at(-1) ?? "")?.[1];
  return (
    lines.length > 1 &&
    !!opening &&
    !!closing &&
    opening[0] === closing[0] &&
    closing.length >= opening.length
  );
}

export function mermaidDiagram(source: string, unicode = true): Diagram {
  if (source.length > maxSourceLength || source.split(/[\n;]/u).length > maxStatements)
    return { reason: "diagram too large; showing source" };
  const key = `${unicode ? "unicode" : "ascii"}:${source}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let diagram: Diagram;
  try {
    // The renderer expects the header on its own line, including for semicolon syntax.
    const text = source.replace(/^(\s*(?:graph|flowchart)\s+(?:TD|TB|LR|BT|RL))\s*;/iu, "$1\n");
    if (/^\s*(?:graph|flowchart|stateDiagram)/iu.test(text)) {
      const graph = parseMermaid(text);
      if (
        graph.nodes.size > 40 ||
        graph.edges.length > 60 ||
        [...graph.nodes.values()].some((node) => stringWidth(node.label) > 120)
      ) {
        return { reason: "diagram too large; showing source" };
      }
      if (!graph.nodes.size) return { reason: "diagram unavailable; showing source" };
    }
    const rendered = renderMermaidASCII(text, {
      useAscii: !unicode,
      colorMode: "none",
      paddingX: 2,
      paddingY: 1,
      boxBorderPadding: 0,
    });
    const lines = rendered.split("\n").map((line) => line.trimEnd());
    diagram =
      !rendered.trim() || rendered.length > 100_000
        ? { reason: "diagram unavailable; showing source" }
        : { lines, columns: Math.max(...lines.map((line) => stringWidth(line))) };
  } catch {
    diagram = { reason: "diagram unavailable; showing source" };
  }
  if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value!);
  cache.set(key, diagram);
  return diagram;
}
