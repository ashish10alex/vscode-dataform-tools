# Build plan: Dataform and dbt behind one Backend seam

This is the ordered list of pieces to build so the extension supports dbt Projects beside Dataform ones, with the compiled-query panel at parity. It assembles decisions already made; it decides nothing new. Words in capitals (Backend, Project, Compiled Graph, Action, Kind, Target) are defined in [CONTEXT.md](../CONTEXT.md).

## Where the decisions live

- [ADR 0002](adr/0002-one-compiled-graph-behind-a-backend-seam.md): the Compiled Graph and the Backend seam.
- [ADR 0003](adr/0003-dbt-compile-loop-differs-by-engine.md): the dbt compile loop.
- The planning map and its tickets: [ashish10alex/xf#39](https://github.com/ashish10alex/xf/issues/39). Each piece below names the ticket that decided it, as `xf#N`.
- The panel mock-up: [dbt-compiled-query-panel-prototype.html](https://github.com/ashish10alex/xf/blob/prototype/dbt-compiled-query-panel/prototype/dbt-compiled-query-panel-prototype.html).
- xf, the reference implementation, and its ADR 0002. Its dbt decisions stand unless a ticket says otherwise.

## Rules of the build

- **Branch.** Everything goes into the long-lived `multi_backend` branch as small pull requests, in the order below. Main is frozen while it is open. An emergency fix on main is merged into `multi_backend` straight away. (xf#55)
- **Merging.** Squash each piece into `multi_backend`. Bring `multi_backend` into main once, as a merge commit, so each piece stays bisectable.
- **Never tag on `multi_backend`.** The deploy workflow publishes on any tag.
- **Every piece must pass** the pull-request workflow (type-check, lint, tests including the recorded panel output) and a local `just bench` against the baseline from piece 0.3.
- **Dataform behaviour does not change** except where a piece says so. The deliberate changes are listed under "Behaviour changes for Dataform users".
- **Not rewritten:** defer, column lineage, config block and Dataform API runs. They keep reading the Dataform Backend's raw compile result. (xf#46)
- **Standing constraints:** no caching of dry runs or table schemas. Backends never import `vscode`.

## Step 0. Safety net, on main before the freeze

| Piece | What it does | Decided in |
|---|---|---|
| 0.1 Recorded panel output | For a chosen set of files in `src/test/test-workspace` (a table, an incremental table with pre-operations, a view, an assertion, an operation, a declaration, a JS file, a unit test, a file with a compile error), record what the panel is sent today and assert it in the test suite. | xf#55 |
| 0.2 Pull-request workflow | A workflow on pull requests into `main` and `multi_backend` running `npm run check-types`, `npm run lint` and `npm run test`. The repo has none today. | xf#55 |
| 0.3 Bench baseline | Run `just bench` on main and keep the report for `just bench-compare`. | xf#55 |

Then cut `multi_backend` from main.

## Step 1. Per-Project state

| Piece | What it does | Decided in |
|---|---|---|
| 1.1 Project detection | A pure module: a workspace-folder root with `workflow_settings.yaml` or `dataform.json` is a Dataform Project; with `dbt_project.yml`, a dbt Project. Roots only, no search. Both at one root make two Projects; a file's Backend is `.sqlx` to Dataform, `.sql`/`.csv`/`.py` to dbt, a shared type to whichever Compiled Graph lists it, else the `backend` setting, else ask once. | xf#47 |
| 1.2 The Project object | One object per Project (root, Backend, latest compile result and indexes), looked up from a file. The active editor's Project is the active one. Introduce it holding today's Dataform state. | xf#46, xf#47 |
| 1.3 Move the call sites | Replace `CACHED_COMPILED_DATAFORM_JSON` and its three indexes (81 references in 37 files) and the ten `workspaceFolders[0]` sites with lookups through the Project. Remove the globals. | xf#40, xf#46 |
| 1.4 Picker and silence | `selectWorkspaceFolder` becomes a Project picker, listed only when a window holds more than one Project. Remove the "Not a Dataform workspace" warning; a file outside every Project gets a plain message in the panel and no toast. | xf#47, xf#63 |
| 1.5 Tool gate and resolver | Only the Backend's own tool gates the panel; `gcloud` never blocks. Key the executable resolver's cache per Project and have it report which step found the binary. | xf#47, xf#49 |

## Step 2. Dataform Backend and Compiled Graph

| Piece | What it does | Decided in |
|---|---|---|
| 2.1 Compiled Graph | Plain serialisable types and helpers under `src/shared`, a port of xf's `internal/project`: actions by ID, Target, Kind (xf's seventeen plus "unit test"), file, tags, SQL as titled sections in execution order, whether SQL is present, dependencies, dependents, actions in a file, a model's tests, what a run needs. One path style for all platforms. | xf#41, xf#46 |
| 2.2 Backend interface | Required: compile, and which files affect a compile. Optional parts by presence: `runner`, `changes`. A compile takes the Project root, host-resolved options, a logger and a cancellation signal, and returns graph and errors together with an optional notice; it fails outright only with no graph. | xf#46 |
| 2.3 Options out of the compile code | The host resolves Dataform's compiler options and Compilation Mode from settings and passes them in. Settings reads leave `dataformCompiler.ts` and the remote compile code. | xf#46 |
| 2.4 Dataform Backend | Wraps the CLI and API compile paths, keeps the raw result privately, and builds the Compiled Graph from it, unit tests included. Test it in plain Node against xf's `testdata/examples/dataform.json` and its Windows variant. | xf#41, xf#46 |
| 2.5 Dataform-only features ask the Backend | Defer, column lineage, config block, Changed Actions and API runs read the raw result through the Dataform Backend instead of a global. No logic change. | xf#46 |
| 2.6 Dataform runner | The Dataform Backend's `runner` gives the CLI command line; the host sends it to the terminal as today. | xf#46, xf#54 |

## Step 3. Backend-neutral BigQuery service

| Piece | What it does | Decided in |
|---|---|---|
| 3.1 Dry run from sections | One service takes an action's SQL sections, runs the ones marked for dry run through the shared pool, and returns bytes, cost, schema or an error positioned within its section, keyed by action and section and tagged with the compile number. No caching. | xf#46, xf#51 |
| 3.2 Preview from sections | Preview runs the chosen section's query with a row limit, as today. | xf#53 |
| 3.3 Defer as a host step | Defer's rewrite (ADR 0001) is applied to the sections before the service sees them. The service knows nothing of defer or Backends. | xf#46 |
| 3.4 Job project rule | `gcpProjectId` and `gcpLocation` win when set. Unset: a dbt action's jobs run in its Target's project and BigQuery picks the location; Dataform keeps the credentials' default. | xf#53 |
| 3.5 Dataform editor diagnostics | Dry-run errors for `.sqlx` are still placed in the source by block offsets, now fed from section results. | xf#53 |

## Step 4. Panel contract

| Piece | What it does | Decided in |
|---|---|---|
| 4.1 Shared contract file | One type file imported by host and panel: the slices (project; file and actions; compile status; BigQuery results; run status; `dataform` or `dbt` block), the compile status as one of seven values, and the typed list of panel-to-host messages addressed by action Target. | xf#51 |
| 4.2 Slice builders | One function per slice on the host, each slice sent only when it changes and carrying its compile number. They replace `renderToView` and the five hand-built payloads. Only the open file's actions and their neighbours cross. | xf#51 |
| 4.3 Typed messages | The panel-to-host list replaces the 44-case switch. | xf#51 |
| 4.4 Panel components | The panel reads slices and sections. Dataform-only tabs (cost estimator, workflow URLs, project config) and cards read the `dataform` block. Translate the recordings from 0.1 once, here. | xf#51, xf#52 |
| 4.5 Clean-up | Remove the stale `WebviewMessage` type and fields with no consumer. Contract words follow the glossary (Compilation Mode, Kind). | xf#51 |

`just bench` should show the messaging share of save-to-preview falling after this step.

## Parallel track D. The dbt Backend, in plain Node

Starts once 2.1 and 2.2 have merged. Nothing here imports `vscode`.

| Piece | What it does | Decided in |
|---|---|---|
| D1 Fixtures | Copy xf's recorded tool output (`dbt-core.json`, `dbt-v2.json`, broken and hooks variants, Windows variants) and its paired example Projects. Set up a plain Node test run. | xf#41, xf#55 |
| D2 Manifest reader | Manifest schema v12 to Compiled Graph: Kinds, Targets, made-up Targets for actions that build nothing, tests attached to each model, hooks kept as written. Private to the Backend: each action's fully qualified name, package, version and source name, and the Project's and its packages' macros. Runs in a worker that posts back only the result; add the worker entry to the bundle. | xf#41, xf#46, xf#57 |
| D3 Running dbt | `--project-dir`, private `--target-path` and `--log-path`, `--log-format json`, `--target`, vars, profiles directory, `--no-version-check`. Delete the old manifest before each run. Stream stdout. Kill the process tree on cancel. | xf#42, xf#48 |
| D4 Errors | Read errors from the JSON log text for both engines, strip colour codes, parse positions; an unrecognised position form still yields the error, without a position. | xf#42, xf#65 |
| D5 Probe | One `dbt --version` per resolved binary gives flavour, version and whether the BigQuery adapter is present. Unrecognised output is treated as dbt v2. dbt-core below 1.8 is refused with a message. | xf#48, xf#49 |
| D6 Compile strategy | dbt v2: whole compile, but parse first and return a parsed-only graph with a notice when the Project has on-run hooks, unless compile-with-hooks is on. dbt-core: `--select` the given file's actions and their tests; a parse when the file has no SQL of its own; never a whole compile. | xf#48, ADR 0003 |
| D7 Runner | Command lines for `dbt build`: select by fully qualified name, `+` for dependencies and dependents, `--full-refresh`, `tag:<name>`, with shell quoting a user can paste. | xf#54 |
| D8 dbt targets | List names from the `outputs` keys of the Project's profile, looking in the profiles-directory option, `$DBT_PROFILES_DIR`, the Project root, `~/.dbt`. Read key names only. Report the active one from dbt's log. | xf#50 |
| D9 Files that matter | The list of files whose change affects a dbt compile, from xf's watch spec. | xf#41, xf#46 |

## Step 5. dbt in the panel

| Piece | What it does | Decided in |
|---|---|---|
| 5.1 Activation and context | Add `workspaceContains:dbt_project.yml`. Set a context key for the active Project's Backend and its optional parts. Claim no language for `.sql`. | xf#47 |
| 5.2 Finding dbt | Host-side order: `dbtExecutablePath`, `$DBT_BIN`, the Project's `.venv` then `venv`, the Python extension's environment (soft dependency), `PATH`, known directories. Probe in the background after activation. Re-resolve on setting change, environment change, or the file disappearing. | xf#49 |
| 5.3 Host compile loop | Compile when the panel is first opened, on save and on switching files. One compile per Project, latest request wins. On dbt-core, any save discards other actions' SQL. Artifacts under the extension's workspace storage, one directory per dbt binary and dbt target, pruned after 30 days unused; `clearExtensionCache` clears them. | xf#48 |
| 5.4 Panel states | Tabs: Compiled query, Schema, Project. A model with its tests stacked beneath, collapsed. Hooks as written. The incremental note. Cards for files with no SQL. Outdated-while-compiling and first-view states. The parsed-only notice with its offer. dbt not found. Not a BigQuery Project. As drawn in the mock-up. | xf#52 |
| 5.5 dbt target control | In the panel beside Run; a list of names or free text; a private per-workspace override of `dbtTarget` with a way back; `dbtVars` and `dbtProfilesDir` shown read-only. A change recompiles. | xf#50 |
| 5.6 BigQuery for dbt | Dry-run every shown section with a compiled SELECT automatically; preview by running it; nothing for seeds, sources, exposures and unit tests; errors in the panel only. | xf#53 |
| 5.7 Runs | The run menu without the API choice; `dbt build` in the extension's terminal; the dbt target named on the button; confirmation on the first run in a window against a non-default dbt target; the command and repeat-last-run in the run-status slice. | xf#54 |
| 5.8 Compile errors | The error card; on dbt v2 a collapsed count of errors elsewhere with the open file's SQL kept; on dbt-core the card alone. Editor markers only where the position is real. | xf#65 |
| 5.9 Commands and menus | Hide the 28 Dataform-only commands and the remote mode and defer status bar items in a dbt Project. Category "Dataform/dbt" on the 16 shared commands. Editor buttons and context menu gated by Backend. `runAssertions` builds a dbt model's tests. | xf#63 |
| 5.10 Dev container | One dev container holding a dbt Project, to try each release in. | xf#49 |

## Step 6. Rebrand and docs

| Piece | What it does | Decided in |
|---|---|---|
| 6.1 Listing | Display name "Dataform and dbt Tools for BigQuery" (final wording depends on [xf#68](https://github.com/ashish10alex/xf/issues/68)), description, keywords. "dbt™" on first mention and the trademark footer. | xf#56 |
| 6.2 Settings | Contribute `dbtExecutablePath`, `dbtTarget`, `dbtVars`, `dbtProfilesDir`, `dbtCompileWithHooks`, `backend`, all under `vscode-dataform-tools.`. No existing id moves. | xf#56 |
| 6.3 Names in the product | The bottom results panel becomes "BigQuery Results". Update the glossary's title and opening line. | xf#56 |
| 6.4 Docs | README: dbt support, opening a Project at its own folder, the two job-project rules, remote hosts supported. Website and changelog text for 2.0.0. | xf#47, xf#49, xf#53 |

## Release

1. Merge `multi_backend` into main with a merge commit once Step 6 is done and everything passes.
2. Publish as a 1.19.x pre-release. Try it in the dev container.
3. Re-run the `dataform`, `dbt` and `dbt bigquery` searches on the Marketplace and Open VSX against the baseline (2nd of 18 for `dataform`, 55th of 76 for `dbt`).
4. After a period of real use with no regressions, release 2.0.0.

## Behaviour changes for Dataform users

These are intended and belong in the 2.0.0 changelog.

- `gcloud` no longer blocks the panel; missing credentials show when a BigQuery call fails.
- The "Not a Dataform workspace" warning is gone.
- With several workspace folders, the Project follows the active editor instead of being picked once per window.
- "Select workspace folder" is a Project picker.
- The extension activates in workspaces with a `dbt_project.yml` at a folder root.
- Sixteen commands change category from "Dataform" to "Dataform/dbt".
- The bottom panel is named "BigQuery Results".

## To verify while building

Earlier tickets marked these as assumed or untested. Check each in the piece named.

| Check | Piece |
|---|---|
| dbt-core's `--select` can compile a model and its attached tests in one invocation | D6 |
| dbt-core's `--select` leaves unselected actions without compiled SQL (the discard rule holds either way) | D6 |
| Compile cost on a built Project with incremental models, where compile may query the warehouse per model | D6 |
| Whether a cheaper route to one model's SQL exists (dbt v2 `--dirty` / `--partial-load`; the compiled file or dbt-core's `CompiledNode` event) | D6 |
| dbt v2's `--log-format json` carries no stability guarantee; errors must degrade to plain text | D4 |
| `--version` output across older dbt v2 builds, and dbt v2 installed by `pip install dbt` in a venv | D5 |
| The Python extension's API still answers when the Python Environments extension manages environments | 5.2 |
| A path pattern on a selector does not change its priority against a language-only selector | 5.8 |
| Which of today's payload fields have no consumer (about 11 by a scripted scan) | 4.5 |
| The display name is unique on the Marketplace (only known at publish) | 6.1 |

## After 2.0.0

In this order, each its own effort. (xf#57)

1. A polish release: run results and progress in the panel, recompiling after a run, dbt v2's compile warnings, schema and preview for seeds and sources, a cost estimate across a tag, and `searchTableColumns` for dbt.
2. Editor features for dbt: go to definition, hover and completions, with a dbt v2 source map for dry-run error positions. Whether they stand down beside other dbt extensions is decided there.
3. Dependency graph for dbt.
4. Run Changed for dbt.
5. Defer for dbt.
6. Column lineage for dbt.
