---
status: accepted
---

# Dataform and dbt Projects compile to one Compiled Graph behind a VS Code-free Backend seam

The extension only knew Dataform, and Dataform's raw compile result was its data model: one window-wide global read from 37 files. To support dbt with the same compiled-query webview, each Backend now compiles its Project into one plain, serialisable **Compiled Graph** of actions, and everything that is not specific to a Backend reads only that. The shape is a port of xf's `project.Graph` (xf ADR 0002), widened where the extension shows more than xf does.

- **One plain structure.** The Compiled Graph and its actions are data with helper functions beside them, not interfaces a Backend implements. An action has an ID, a Target, a Kind from one flat list shared by both Backends, its file, its SQL as titled sections in execution order, its dependencies and what a run needs.
- **An action's ID is its Target**, `database.schema.name`. An action that builds nothing (exposure, unit test, analysis) gets a made-up Target named after its Kind, which is never shown as a BigQuery link.
- **Unit tests are actions of one Kind, "unit test", in both Backends**, each pointing at the action it tests. They are distinct from dbt's data tests ("test") and Dataform's assertions.
- **Backend-only data stays private to its Backend.** The Compiled Graph holds what both Backends share and what Backend-neutral surfaces show. The Dataform Backend keeps its raw compile result, and Dataform-only features (defer, column lineage, config block, Dataform API runs) read it through that Backend. They move onto the Compiled Graph only when they come to dbt.
- **Backends never import `vscode`.** A Backend takes plain data and returns plain data, asynchronously. The host resolves each Backend's options (Dataform's compiler options and Compilation Mode; dbt's binary and dbt target) and passes them in with the Project root, a logger and a cancellation signal. This keeps Backends testable in plain Node against recorded tool output, and leaves room for a Backend whose work happens in another process.
- **A small required core, optional parts by presence.** Every Backend can compile and can say which files affect a compile. Running and listing Changed Actions are optional parts; an absent part means unsupported. The host turns presence into context keys so commands and webview controls hide themselves.
- **A compile returns the graph and its errors together**, with a notice when the Project was only parsed (dbt v2 with hooks). It fails outright only when there is no graph at all.
- **State is per Project.** The window-wide global is replaced by one object per Project holding its root, its Backend and its latest Compiled Graph, found from a file.
- **BigQuery is outside the seam.** One Backend-neutral service does dry runs, cost, schema and previews from the SQL sections an action carries. Defer's rewrite (ADR 0001) is a host step applied to those sections before the service sees them; neither the service nor the Backend knows about it.
- **The dbt manifest is read in a worker thread** that posts back only the Compiled Graph. The manifest is never held in the extension host; a feature that later needs more of it reads it from disk.

## Considered Options

- **Map dbt onto Dataform's types.** The smallest change, but dbt's Kinds have nowhere to go and Dataform's names leak into everything. xf rejected it for the same reason.
- **Graph and action as interfaces each Backend implements.** Flexible, but not serialisable, harder to test, and it closes the door on another process.
- **Per-Backend blocks on the graph, or flat optional fields as in xf, with the raw result dropped.** One object for everything, but every Dataform-only feature would be rewritten now for no gain to dbt, and with flat fields nothing stops neutral code leaning on a Dataform-only one.
- **A declared capability list, or a full interface with no-ops.** Flags and methods can disagree; no-ops leave dbt users with controls that do nothing.
- **Keep one window-wide current graph.** Least churn, but a window could then never hold two Projects, and it decides that question by accident.
- **BigQuery behind the Backend, or a Backend hook to rewrite SQL before it runs.** Duplicates orchestration and gives every dry run a second path; a remote Backend would have to own BigQuery access.
- **Let Backends read settings themselves.** Less plumbing, but a Backend then needs VS Code to run.
- **Parse the manifest on the main thread.** Simplest, but it blocks the editor thread on every compile: about 125 ms at 3,000 synthetic models against about 15 ms with a worker, and real manifests are larger.
- **An ID separate from an optional Target** (dbt's `unique_id`). Cleaner types, but everything keyed on Target is re-keyed, and the two Backends' graphs stop being comparable.

## Consequences

- Two models exist side by side for Dataform until its own features are moved: the Compiled Graph and the Dataform Backend's raw result. A Backend-neutral surface that reaches for the raw result is a bug.
- Settings reads leave the compile code. The host owns resolving options and deciding when a change to them means a recompile.
- The extension gains a worker entry point to bundle.
- The made-up Targets must be recognisable, so no surface offers a console link, schema or preview for them.
- Differs from xf in three places: unit tests have their own Kind, Dataform's unit tests are in the graph, and there is no `Parse`, serialised graph or engine variant, which exist in xf only to move a graph between processes.
