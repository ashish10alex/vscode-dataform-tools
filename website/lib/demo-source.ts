import fs from "node:fs";
import path from "node:path";

/*
 * The source files the live demo of the landing page shows beside the panel. They are read from the demo Projects
 * (website/demo), the ones the panel's states were recorded from, so the code on show is the code that compiled.
 */

export type TokenKind = "plain" | "keyword" | "string" | "number" | "comment" | "template" | "function";

export interface SourceToken {
  text: string;
  kind: TokenKind;
}

export interface DemoSource {
  backend: "dataform" | "dbt";
  /** As the editor tab names it */
  fileName: string;
  /** Relative to the Project root */
  path: string;
  lines: SourceToken[][];
}

const KEYWORDS = new Set(
  "select from where with as and or not qualify over partition by order desc asc group having join left right inner on using limit union all distinct case when then else end in is null true false config type description tags columns".split(" ")
);

// In order: the first that matches at a position wins
const RULES: Array<[TokenKind, RegExp]> = [
  ["comment", /^(--[^\n]*|\{#[\s\S]*?#\})/],
  ["template", /^(\$\{[^}]*\}|\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/],
  ["string", /^("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`\n]*`)/],
  ["number", /^\d+(?:\.\d+)?\b/],
  ["function", /^[A-Za-z_]\w*(?=\()/],
  ["plain", /^[A-Za-z_]\w*/],
  ["plain", /^\s+/],
  ["plain", /^[^\sA-Za-z_]/],
];

function tokenise(code: string): SourceToken[][] {
  const lines: SourceToken[][] = [[]];
  let rest = code.replace(/\s+$/, "");
  while (rest) {
    const [kind, match] = RULES.map(([kind, rule]) => [kind, rule.exec(rest)?.[0]] as const).find(([, text]) => text)!;
    const text = match!;
    rest = rest.slice(text.length);
    const tokenKind: TokenKind = kind === "plain" && KEYWORDS.has(text.toLowerCase()) ? "keyword" : kind;
    // A token that runs over lines is cut at each line end, so that every line can be drawn with its number
    text.split("\n").forEach((part, index) => {
      if (index > 0) {
        lines.push([]);
      }
      if (part) {
        lines[lines.length - 1].push({ text: part, kind: tokenKind });
      }
    });
  }
  return lines;
}

function source(backend: DemoSource["backend"], relativePath: string): DemoSource {
  const code = fs.readFileSync(path.join(process.cwd(), "demo", backend, relativePath), "utf8");
  return { backend, fileName: path.basename(relativePath), path: relativePath, lines: tokenise(code) };
}

export function demoSources(): DemoSource[] {
  return [source("dataform", "definitions/fct_player_transfers.sqlx"), source("dbt", "models/fct_player_transfers.sql")];
}
