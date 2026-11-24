# Dataform projects

Set-up is in the [README](../README.md#installation). Every feature is described at [dataformtools.com/features](https://dataformtools.com/features). Answers to common problems are in the [FAQ](../FAQ.md).

## BigQuery jobs of a CLI run

A `dataform run` sent to the terminal is listed with the API runs, in the Runs view at the bottom and the Last run row of the compiled query, tagged `cli`. It has a row for each BigQuery job, live while the run goes: state, duration, slot time, bytes billed, estimated cost, the failure reason and a link to the job in the Cloud console. "Stop run" cancels the run's jobs.

The run is given `--job-prefix vscode-<id>`, so the IDs of its jobs start with `dataform-vscode-<id>-`, and your jobs are listed for the ones that have it. It needs Dataform CLI 3.0.70 or later, the first to accept `--job-prefix`, and the `bigquery.jobs.list` permission. An older CLI is sent the command without the prefix. Before CLI 3.1.4, the job that creates the dataset is not given the prefix, so it is not listed. The extension asks the CLI whether it has `--job-prefix` again once the CLI's `bundle.js` changes, as an install changes it. Behind a version manager's shim (mise, asdf, Volta), which stays the same when the CLI behind it changes, it asks before every run. Either way, a new version is seen without a reload. A job is named after the table it writes to; one that writes to none goes by the end of its ID. Turn it off with `vscode-dataform-tools.trackCliRunJobs`.

## Run changed actions from a keybinding

The commands `vscode-dataform-tools.runChangedActions` and `vscode-dataform-tools.runChangedActionsApi` show the changed actions, then ask how to run them. In a keybinding, pass arguments to skip the questions:

```json
{
  "key": "ctrl+alt+r",
  "command": "vscode-dataform-tools.runChangedActions",
  "args": { "includeDependents": true, "includeDependencies": false, "fullRefresh": false }
}
```
