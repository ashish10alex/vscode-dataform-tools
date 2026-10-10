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

/** What BigQuery's dry run said of a line of the file, as the editor shows it there */
export interface SourceProblem {
  /** 1-based, in the source file */
  line: number;
  /** The text of that line the error is about */
  text: string;
  message: string;
}

export interface DemoSource {
  /** Which recorded states the panel beside it shows (public/demo/states) */
  backend: "dataform" | "dbt" | "diagnostics";
  problem?: SourceProblem;
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

function source(backend: DemoSource["backend"], project: "dataform" | "dbt", relativePath: string): DemoSource {
  const code = fs.readFileSync(path.join(process.cwd(), "demo", project, relativePath), "utf8");
  return { backend, fileName: path.basename(relativePath), path: relativePath, lines: tokenise(code) };
}

export function demoSources(): DemoSource[] {
  return [source("dataform", "dataform", "definitions/fct_player_transfers.sqlx"), source("dbt", "dbt", "models/fct_player_transfers.sql")];
}

/**
 * The file with an error, and the error as the recorded dry run gave it. BigQuery places it in the compiled SQL;
 * the extension moves it to the line of the file it came from, which here is the line that holds the same text.
 */
export function diagnosticsSource(): DemoSource {
  const file = source("diagnostics", "dataform", "definitions/fct_club_spend.sqlx");
  const state = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "demo", "states", "diagnostics.json"), "utf8"));
  const results: Array<{ sql?: string; error?: { message: string; line: number; column: number } }> = state.initial
    .filter((message: { slice: string }) => message.slice === "bigquery")
    .pop().value.results;
  const failed = results.find((result) => result.error);
  if (!failed?.error || !failed.sql) {
    throw new Error("The recorded dry run of fct_club_spend.sqlx has no error: record the demo again (just website-demo-capture)");
  }
  // What stands at the error's place in the compiled SQL, up to the end of its name
  const text = /^\w+/.exec(failed.sql.split("\n")[failed.error.line - 1].slice(failed.error.column - 1))?.[0] ?? "";
  const line = file.lines.findIndex((tokens) => tokens.some((token) => token.text === text)) + 1;
  if (!text || !line) {
    throw new Error(`The error of the recorded dry run is not on a line of fct_club_spend.sqlx: ${failed.error.message}`);
  }
  return { ...file, problem: { line, text, message: failed.error.message.replace(/ at \[\d+:\d+\]$/, "") } };
}
