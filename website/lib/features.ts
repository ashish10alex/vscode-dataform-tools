// Single source of truth for the features listed on the landing page and /features: words only, so that a
// change to the product's look leaves nothing here to retake. When you ship something worth showing off, add it
// here in the same PR.

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
    id: "dbt",
    theme: "compile",
    title: "dbt projects on BigQuery",
    summary:
      "Open a dbt™ project and get the panel a Dataform file has, row for row: Target with the dry-run size and cost, Compile with the dbt target, Lineage, Run and Last run, then the compiled SQL, with the model's tests on one line. Schema, preview and `dbt build` runs work the same way. In the editor: go to definition, hover and completions for `ref()`, `source()` and column names, and BigQuery's dry-run errors. Works with dbt Core 1.8 or later and dbt v2.",
    links: [{ label: "Set-up and what works", href: "https://github.com/ashish10alex/vscode-dataform-tools#dbt-projects" }],
  },
  {
    id: "compilation",
    theme: "compile",
    title: "Compiled query & dry run",
    summary:
      "Compiled SQL side by side with your .sqlx, with bytes processed and cost for every target, including incremental and non-incremental variants.",
  },
  {
    id: "assertion_badges",
    theme: "compile",
    title: "Built-in assertion kind badges",
    summary:
      "Built-in assertions in the compiled query panel are distinctly labeled by kind (`uniqueKey`, `nonNull`, `rowConditions`) for fast visual triage.",
  },
  {
    id: "session_cache",
    theme: "compile",
    title: "Session-persistent compilation cache",
    summary:
      "Fingerprints and persists CLI compilations across VS Code sessions, slashing cold-start compilation delays down to sub-second speeds.",
  },
  {
    id: "diagnostics",
    theme: "compile",
    title: "Inline diagnostics",
    summary:
      "Compilation and dry-run errors land directly on the .sqlx line — and in the compiled query code block — like a native language server.",
  },
  {
    id: "compile_errors",
    theme: "compile",
    title: "Structured compilation errors",
    summary:
      "Dataform compilation failures are rendered as readable, clickable errors instead of a wall of CLI output.",
  },
  {
    id: "preview_query_results",
    theme: "compile",
    title: "Preview query results",
    summary:
      "Run the file and browse results in a searchable table, with pre_operations skipped so previews stay side-effect free.",
  },
  {
    id: "workflow_invocations",
    theme: "compile",
    title: "Workflow executions",
    summary:
      "See the latest Dataform API run for a file, query the actions in a workflow invocation, and jump to the last execution in the browser.",
  },
  {
    id: "property_graphs",
    theme: "compile",
    title: "Property graphs",
    summary:
      "BigQuery property graphs render as a diagram in the webview, with a starter GQL query explained in the graph's own terms.",
  },
  {
    id: "codeactions",
    theme: "compile",
    title: "Code actions",
    summary: "Apply dry-run suggestions as quick fixes at the speed of thought.",
  },

  // ── graph ──────────────────────────────────────────────────
  {
    id: "column_lineage",
    theme: "graph",
    title: "Column-level lineage & change impact",
    summary:
      "Inspect column lineage and downstream impact directly from the compiled view. Flags dropped or retyped columns against production and maps downstream consumers via Google Cloud Dataplex Lineage, with PR markdown export.",
    links: [
      {
        label: "Google Cloud Dataplex Lineage API",
        href: "https://cloud.google.com/data-catalog/docs/concepts/about-data-lineage",
      },
    ],
  },
  {
    id: "depgraph",
    theme: "graph",
    title: "Dependency graph",
    summary:
      "An interactive graph of your whole project — including orphan nodes — with external sources highlighted, focus on a node, and export to PNG.",
  },
  {
    id: "dependency_inspector",
    theme: "graph",
    title: "Dependency inspector",
    summary:
      "Pick a model, apply a filter to it and every upstream dependency, then dry-run or run them all. Save filters as JSON to share with your team.",
  },
  {
    id: "graph_cli",
    theme: "graph",
    title: "Graph in the browser",
    summary:
      "Open the dependency graph in a web browser from the CLI — handy for big projects and for sharing a view with someone who doesn't use VS Code.",
  },

  // ── editing ────────────────────────────────────────────────
  {
    id: "hover",
    theme: "editing",
    title: "Schema-aware hover",
    summary:
      "Hover a table or column to see types, descriptions and nested STRUCT/ARRAY fields — works with ref() and full table names, plus common BigQuery functions.",
  },
  {
    id: "column_search",
    theme: "editing",
    title: "Column search",
    summary: "Search a table's columns — nested ones included — from a quick pick without leaving the editor.",
  },
  {
    id: "autocomplete",
    theme: "editing",
    title: "Auto-completion",
    summary:
      'Completion for column names, dependencies and declarations in ${ref("…")} and the config block.',
  },
  {
    id: "definition",
    theme: "editing",
    title: "Go to definition",
    summary:
      'Jump from ${ref("my_source")} and JavaScript blocks to where they are defined.',
  },
  {
    id: "outline",
    theme: "editing",
    title: "CTEs in outline & breadcrumbs",
    summary:
      "Navigate long queries by CTE from the outline view and breadcrumbs; document symbols include full table names.",
  },
  {
    id: "formatting",
    theme: "editing",
    title: "Formatting",
    summary: "Format .sqlx files with sqlfluff.",
    links: [{ label: "sqlfluff", href: "https://github.com/sqlfluff/sqlfluff" }],
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
    id: "defer_to_prod",
    theme: "run",
    title: "Defer to production",
    summary:
      "Develop in dev without rebuilding upstream tables. Like dbt's `--defer`, automatically resolves unbuilt dependencies against production tables/views in dry runs, previews, and runs (via proxy views), with inline `${ref()}` decorations.",
    links: [
      {
        label: "ADR: Defer via SQL Rewrite & Proxy Views",
        href: "https://github.com/ashish10alex/vscode-dataform-tools/blob/main/docs/adr/0001-defer-via-sql-rewrite-and-proxy-views.md",
      },
    ],
  },
  {
    id: "run_changed_actions",
    theme: "run",
    title: "Interactive run changed actions",
    summary:
      "Run only the actions whose compiled SQL or materialization changed vs default branch (`state:modified`), with interactive file selection and daily-cached merge-base compiles.",
  },
  {
    id: "cost_estimator",
    theme: "run",
    title: "Cost estimator",
    summary:
      "Estimate the cost of one or more tags, optionally including their dependencies and dependents, before you run anything.",
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
  },
];

export function featuresByTheme(theme: FeatureTheme) {
  return features.filter((feature) => feature.theme === theme);
}
