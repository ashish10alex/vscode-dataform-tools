// Single source of truth for the features shown on the landing page and /features.
// When you ship something worth showing off, add it here in the same PR.

export type FeatureTheme = "compile" | "graph" | "editing" | "run";

export interface FeatureMedia {
  light?: string;
  dark?: string;
  video?: string;
}

export interface Feature {
  /** Also the anchor on /features, so keep existing ids stable. */
  id: string;
  title: string;
  summary: string;
  theme: FeatureTheme;
  links?: { label: string; href: string }[];
  media?: FeatureMedia;
  /** Describes the recording still needed; rendered as a placeholder until `media` is set. */
  mediaTodo?: string;
}

export const themes: Record<FeatureTheme, { label: string; eyebrow: string; blurb: string }> = {
  compile: {
    label: "Compiled query webview",
    eyebrow: "compile",
    blurb:
      "See exactly what Dataform will run: compiled SQL, dry-run cost, errors and past executions for the file you are editing.",
  },
  graph: {
    label: "Dependency graph & inspector",
    eyebrow: "lineage",
    blurb:
      "Understand how a model fits into your project, then debug it by running filtered queries across its whole dependency chain.",
  },
  editing: {
    label: "Schema-aware editing",
    eyebrow: "edit",
    blurb:
      "Language-server comforts for .sqlx: hover, completion, navigation and formatting that know your BigQuery schemas.",
  },
  run: {
    label: "Cost & execution",
    eyebrow: "run",
    blurb: "Estimate what a tag will cost, then run it with the scope and safety rails you want.",
  },
};

export const features: Feature[] = [
  // ── compile ────────────────────────────────────────────────
  {
    id: "compilation",
    theme: "compile",
    title: "Compiled query & dry run",
    summary:
      "Compiled SQL side by side with your .sqlx, with bytes processed and cost for every target, including incremental and non-incremental variants.",
    media: { light: "/compiled_query_preview_light.png", dark: "/compiled_query_preview_dark.png" },
  },
  {
    id: "diagnostics",
    theme: "compile",
    title: "Inline diagnostics",
    summary:
      "Compilation and dry-run errors land directly on the .sqlx line — and in the compiled query code block — like a native language server.",
    media: { light: "/diagnostics_light.png", dark: "/diagnostics_dark.png" },
  },
  {
    id: "compile_errors",
    theme: "compile",
    title: "Structured compilation errors",
    summary:
      "Dataform compilation failures are rendered as readable, clickable errors instead of a wall of CLI output.",
    mediaTodo: "Webview showing a structured compilation error",
  },
  {
    id: "preview_query_results",
    theme: "compile",
    title: "Preview query results",
    summary:
      "Run the file and browse results in a searchable table, with pre_operations skipped so previews stay side-effect free.",
    media: { light: "/preview_query_results_light.png", dark: "/preview_query_results_dark.png" },
  },
  {
    id: "workflow_invocations",
    theme: "compile",
    title: "Workflow executions",
    summary:
      "See the latest Dataform API run for a file, query the actions in a workflow invocation, and jump to the last execution in the browser.",
    mediaTodo: "Workflow Executions tab in the compiled query webview",
  },
  {
    id: "property_graphs",
    theme: "compile",
    title: "Property graphs",
    summary:
      "BigQuery property graphs render as a diagram in the webview, with a starter GQL query explained in the graph's own terms.",
    mediaTodo: "Property graph diagram with starter GQL query",
  },
  {
    id: "codeactions",
    theme: "compile",
    title: "Code actions",
    summary: "Apply dry-run suggestions as quick fixes at the speed of thought.",
    media: { light: "/quick_fix.png", dark: "/quick_fix.png" },
  },

  // ── graph ──────────────────────────────────────────────────
  {
    id: "depgraph",
    theme: "graph",
    title: "Dependency graph",
    summary:
      "An interactive graph of your whole project — including orphan nodes — with external sources highlighted, focus on a node, and export to PNG.",
    media: { light: "/dependancy_tree_light.png", dark: "/dependancy_tree_dark.png" },
  },
  {
    id: "dependency_inspector",
    theme: "graph",
    title: "Dependency inspector",
    summary:
      "Pick a model, apply a filter to it and every upstream dependency, then dry-run or run them all. Save filters as JSON to share with your team.",
    media: { light: "/dependency_inspector_one.png", dark: "/dependency_inspector_one.png" },
  },
  {
    id: "graph_cli",
    theme: "graph",
    title: "Graph in the browser",
    summary:
      "Open the dependency graph in a web browser from the CLI — handy for big projects and for sharing a view with someone who doesn't use VS Code.",
    mediaTodo: "Dependency graph opened in the browser from the CLI",
  },

  // ── editing ────────────────────────────────────────────────
  {
    id: "hover",
    theme: "editing",
    title: "Schema-aware hover",
    summary:
      "Hover a table or column to see types, descriptions and nested STRUCT/ARRAY fields — works with ref() and full table names, plus common BigQuery functions.",
    media: { light: "/table_hover_light.png", dark: "/table_hover_dark.png" },
  },
  {
    id: "column_search",
    theme: "editing",
    title: "Column search",
    summary: "Search a table's columns — nested ones included — from a quick pick without leaving the editor.",
    mediaTodo: "Column search quick pick",
  },
  {
    id: "autocomplete",
    theme: "editing",
    title: "Auto-completion",
    summary:
      'Completion for column names, dependencies and declarations in ${ref("…")} and the config block.',
    media: { light: "/sources_autocompletion.gif", dark: "/sources_autocompletion.gif" },
  },
  {
    id: "definition",
    theme: "editing",
    title: "Go to definition",
    summary:
      'Jump from ${ref("my_source")} and JavaScript blocks to where they are defined.',
    media: { light: "/go_to_definition.gif", dark: "/go_to_definition.gif" },
  },
  {
    id: "outline",
    theme: "editing",
    title: "CTEs in outline & breadcrumbs",
    summary:
      "Navigate long queries by CTE from the outline view and breadcrumbs; document symbols include full table names.",
    mediaTodo: "Outline view listing the CTEs of a .sqlx file",
  },
  {
    id: "formatting",
    theme: "editing",
    title: "Formatting",
    summary: "Format .sqlx files with sqlfluff.",
    links: [{ label: "sqlfluff", href: "https://github.com/sqlfluff/sqlfluff" }],
    media: { light: "/formatting.gif", dark: "/formatting.gif" },
  },
  {
    id: "snippets",
    theme: "editing",
    title: "Snippets",
    summary:
      "Snippets for Dataform configs and unit tests, plus generic BigQuery functions from vscode-language-sql-bigquery.",
    links: [
      {
        label: "vscode-language-sql-bigquery",
        href: "https://github.com/shinichi-takii/vscode-language-sql-bigquery",
      },
    ],
  },

  // ── run ────────────────────────────────────────────────────
  {
    id: "cost_estimator",
    theme: "run",
    title: "Cost estimator",
    summary:
      "Estimate the cost of one or more tags, optionally including their dependencies and dependents, before you run anything.",
    media: { light: "/tag_cost_estimator_light.png", dark: "/tag_cost_estimator_dark.png" },
  },
  {
    id: "filetagruns",
    theme: "run",
    title: "Run files & tags",
    summary:
      "Run files or tags — with dependencies, dependents or full refresh — through the Dataform CLI or the Dataform API, straight from the webview.",
    links: [
      {
        label: "Dataform API",
        href: "https://cloud.google.com/nodejs/docs/reference/dataform/latest/dataform/v1beta1.dataformclient",
      },
    ],
    mediaTodo: "Run tags from the compiled query webview",
  },
  {
    id: "test_actions",
    theme: "run",
    title: "Unit tests",
    summary: "First-class support for Dataform `test` actions, with a snippet to scaffold new ones.",
  },
  {
    id: "snooze",
    theme: "run",
    title: "Snooze compilation",
    summary:
      "Pause compile-on-save for five minutes while you make sweeping edits, with controls in the webview.",
    mediaTodo: "Snooze controls in the compiled query webview",
  },
];

export function featuresByTheme(theme: FeatureTheme) {
  return features.filter((feature) => feature.theme === theme);
}
