---
status: accepted
---

# A save compiles only the open file's actions of a dbt Project, on either engine

The compiled-query panel recompiles when a file is saved. For Dataform that is one whole-project compile. For dbt the dbt Backend compiles only the open file's actions (`dbt compile --select path:<file>`), on dbt-core and on dbt v2 alike, and never the whole Project.

This replaces the first decision, in which dbt v2 compiled the whole Project on every save. That was measured on synthetic Projects of 300 / 1,000 / 3,000 models with no warehouse behind them: dbt-core took 10.7 / 28.2 / 79.0 s for a whole compile and 3.9 / 5.4 / 11.0 s with `--select`; dbt v2 took 1.15 / 3.09 / 9.05 s for a whole compile, and `--select` saved it only a quarter to a third. A real Project gave other numbers. On one of 240 models, 11 tests, 1 snapshot and 136 source tables, with dbt 2.0.6 on BigQuery:

| | Time |
|---|---|
| `dbt parse` | 0.5 to 0.7 s |
| `dbt compile --select path:<one model>` (1 model and its 6 tests) | 0.5 to 1.2 s |
| `dbt compile` of the whole Project | 50 to 121 s over several runs |

In the whole compile the parse is done after 0.5 s and the 252 nodes compile in 0.1 s. The rest is dbt v2 fetching the schema of every source table from the warehouse, which a selected compile does only for what the selected actions read. `--static-analysis off` does not make the whole compile faster. The synthetic Projects had no sources to fetch, so they did not show this cost.

- **`--select` the open file's actions**, on save and when a file whose actions have no compiled SQL is viewed. dbt re-reads the Project first, so the graph's structure is current after every compile; only the SQL is partial. On the real Project the manifest of a selected dbt v2 compile has the same nodes, sources, dependencies, relation names and parent and child maps as that of a parse. An action that was not compiled has no `compiled_code` (dbt v2 leaves out `compiled` and `compiled_path` as well), which is how the reader tells "not compiled yet" from compiled.
- **Any compile discards every other action's compiled SQL.** A macro, a YAML config or an upstream ephemeral model can change what another model compiles to, and fresh feedback matters more than speed. So what the panel shows was always compiled after the last change.
- **The `compiled` directory of the last run is deleted before each dbt command.** dbt v2 copies the files it finds there into the next manifest as the `compiled_code` of actions it did not compile this time, even when the action's source has changed since and even when the manifest itself was deleted. Without the deletion a selected compile would mark stale SQL as compiled. dbt-core writes only what it compiled.
- **Saving a file with no SQL of its own** (YAML, a macro, `dbt_project.yml`) selects nothing: dbt gives the parsed Project, which refreshes the graph and reports YAML and Jinja errors straight away. dbt v2 exits successfully with a "nothing to do" warning. With no file on show the Project is parsed.
- **The whole Project is never compiled.** Nothing the extension offers needs every action's SQL at once: the dry run, cost, schema and preview are of the file on show, and a run or a graph needs names and dependencies, which every manifest has in full.
- **A dbt v2 Project with on-run hooks is only parsed**, because v2 runs those hooks against the warehouse on every compile, `--select` included, and no flag stops it. So a dbt v2 Project is parsed before its first compile, and again when a `dbt_project.yml` of the Project or of a package changes. The panel shows the graph without compiled SQL, says why, and offers to compile with hooks, stating that they will run on every save. The answer is remembered for the workspace and backed by a setting. Such a Project is not compiled when another file is shown.
- **Compiles never write to the Project's `target/`.** Artifacts and logs go under the extension's per-workspace storage, one directory per dbt binary and dbt target, so the user's own runs and `--state` comparisons are untouched and each engine keeps its own partial-parse state. Directories unused for 30 days are deleted at activation; a command clears them.
- **One compile per Project at a time; the latest request wins.** A newer save or file switch kills the running dbt process tree and starts again. The previous manifest is deleted before each run, so a failed or cancelled compile never shows the last result.
- **While a compile runs** the panel keeps the previous SQL marked outdated, with elapsed time and the dbt command. A file whose actions have no compiled SQL yet shows placeholder lines instead. Dry run, cost and run wait for the fresh compile.
- **dbt-core 1.8 and later.** It and dbt v2 write the same manifest schema (v12), so there is one reader. Older versions get a message naming the version found and the minimum.

## Considered Options

- **Whole compile on dbt v2, `--select` on dbt-core.** The first decision. Every action's SQL is fresh and file switches are instant on dbt v2, but a save costs one to two minutes on a real BigQuery Project, against a second.
- **Whole compile on both engines, as xf does.** One path and instant file switches, but dbt-core takes 28 s per save at 1,000 models. A whole dbt-core compile also runs any `run_query()` inside a hook macro, which would need its own guard.
- **Selected first, then whole in the background.** The background compile rarely finishes before the next save and doubles the load on the warehouse.
- **Keep other actions' SQL after a save**, either unless a shared file changed or marked as possibly outdated. Fewer recompiles, but stale SQL on screen, or silently stale after an edit to an ephemeral model. It is what dbt v2 does by itself if its `compiled` directory is left alone.
- **Compile dbt v2 Projects with hooks anyway.** DDL and inserts in hooks would run on every save without the user having asked.
- **Artifacts in a hidden folder in the Project, or the OS cache directory as xf.** The first needs a `.gitignore` entry in every Project; the second outlives the extension.

## Consequences

- The first view of each file after any compile costs a compile of that file: about a second on dbt v2, 4 to 11 s on dbt-core.
- The Compiled Graph must say, per action, whether its SQL is present, so every surface can tell "not compiled yet" from "has no SQL".
- An error in another file is reported only when dbt finds it while it reads the Project (YAML, Jinja, a bad `ref()`). An error that shows only when that file's SQL is compiled is reported when that file is shown.
- A change made outside VS Code is picked up on the next save or view; there is no file watcher, as for Dataform.
- A later feature that needs every action's SQL (a cost estimate across a tag, for example) has to bring a whole-compile command with it, the hook guard for dbt-core, and on dbt v2 a wait of a minute or more.
- `--no-version-check` is passed so dbt-core does not call PyPI on each compile. Usage statistics are left to the user's dbt configuration.
