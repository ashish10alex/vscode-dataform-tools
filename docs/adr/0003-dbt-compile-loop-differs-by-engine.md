---
status: accepted
---

# A save compiles the whole dbt Project on dbt v2 and only the open file's actions on dbt-core

The compiled-query panel recompiles when a file is saved. For Dataform that is one whole-project compile. dbt has two engines with very different costs, so the dbt Backend compiles differently for each: the whole Project on dbt v2, and only the open file's actions (`--select`) on dbt-core. Measured after one edit on synthetic Projects of 300 / 1,000 / 3,000 models: dbt-core takes 10.7 / 28.2 / 79.0 s for a whole compile and 3.9 / 5.4 / 11.0 s with `--select`; dbt v2 takes 1.15 / 3.09 / 9.05 s for a whole compile, and `--select` saves it only a quarter to a third while leaving stale SQL for every other action in the manifest.

- **dbt v2: whole compile on every save.** Every action's SQL is fresh and switching files reads the Compiled Graph already in memory.
- **dbt-core: `--select` the open file's actions**, on save and when a file whose actions have no compiled SQL is viewed. dbt re-reads the Project first, so the graph's structure is current after every compile; only the SQL is partial.
- **On dbt-core any save discards every other action's compiled SQL.** A macro, a YAML config or an upstream ephemeral model can change what another model compiles to, and fresh feedback matters more than speed. So what the panel shows was always compiled after the last change.
- **On dbt-core, saving a file with no SQL of its own** (YAML, a macro, `dbt_project.yml`) runs `dbt parse`, which refreshes the graph and reports YAML and Jinja errors straight away.
- **dbt-core never compiles the whole Project.** Nothing the panel offers needs every action's SQL at once.
- **A dbt v2 Project with on-run hooks is only parsed**, because v2 runs those hooks against the warehouse on every compile, `--select` included, and no flag stops it. The panel shows the graph without compiled SQL, says why, and offers to compile with hooks, stating that they will run on every save. The answer is remembered for the workspace and backed by a setting.
- **Compiles never write to the Project's `target/`.** Artifacts and logs go under the extension's per-workspace storage, one directory per dbt binary and dbt target, so the user's own runs and `--state` comparisons are untouched and each engine keeps its own partial-parse state. Directories unused for 30 days are deleted at activation; a command clears them.
- **One compile per Project at a time; the latest request wins.** A newer save or file switch kills the running dbt process tree and starts again. The previous manifest is deleted before each run, so a failed or cancelled compile never shows the last result.
- **While a compile runs** the panel keeps the previous SQL marked outdated, with elapsed time and the dbt command. Dry run, cost and run wait for the fresh compile.
- **dbt-core 1.8 and later.** It and dbt v2 write the same manifest schema (v12), so there is one reader. Older versions get a message naming the version found and the minimum.

## Considered Options

- **Whole compile on both engines, as xf does.** One path and instant file switches, but dbt-core takes 28 s per save at 1,000 models. A whole dbt-core compile also runs any `run_query()` inside a hook macro, which would need its own guard.
- **`--select` on both engines.** One path, but on dbt v2 it saves little and every file switch would then cost a compile.
- **Selected first, then whole in the background.** On dbt-core the background compile rarely finishes before the next save and doubles the load.
- **Keep other actions' SQL after a save**, either unless a shared file changed or marked as possibly outdated. Fewer recompiles, but stale SQL on screen, or silently stale after an edit to an ephemeral model.
- **Compile dbt v2 Projects with hooks anyway.** DDL and inserts in hooks would run on every save without the user having asked.
- **Artifacts in a hidden folder in the Project, or the OS cache directory as xf.** The first needs a `.gitignore` entry in every Project; the second outlives the extension.

## Consequences

- On dbt-core the first view of each file after any save costs a compile of 4 to 11 s.
- The Compiled Graph must say, per action, whether its SQL is present, so every surface can tell "not compiled yet" from "has no SQL".
- A dbt-core Project and a dbt v2 Project behave differently in the same panel. The difference is deliberate and is the engines', not the extension's.
- A change made outside VS Code is picked up on the next save or view; there is no file watcher, as for Dataform.
- A later feature that needs every action's SQL on dbt-core (a cost estimate across a tag, for example) has to bring a whole-compile command and the hook guard with it.
- `--no-version-check` is passed so dbt-core does not call PyPI on each compile. Usage statistics are left to the user's dbt configuration.
