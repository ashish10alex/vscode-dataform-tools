# Dataform projects

Set-up is in the [README](../README.md#installation). Every feature is described at [dataformtools.com/features](https://dataformtools.com/features). Answers to common problems are in the [FAQ](../FAQ.md).

## BigQuery jobs of a CLI run

A `dataform run` sent to the terminal is listed with the API runs, in the Executions tab and the latest-run banner, tagged `cli`. It has a row for each BigQuery job, live while the run goes: state, duration, slot time, bytes billed, estimated cost, the failure reason and a link to the job in the Cloud console. "Stop run" cancels the run's jobs.

The run is given `--job-prefix vscode-<id>`, so the IDs of its jobs start with `dataform-vscode-<id>-`, and your jobs are listed for the ones that have it. It needs a Dataform CLI with `--job-prefix` and the `bigquery.jobs.list` permission. A job is named after the table it writes to; one that writes to none goes by the end of its ID. Turn it off with `vscode-dataform-tools.trackCliRunJobs`.

## Run changed actions from a keybinding

The commands `vscode-dataform-tools.runChangedActions` and `vscode-dataform-tools.runChangedActionsApi` show the changed actions, then ask how to run them. In a keybinding, pass arguments to skip the questions:

```json
{
  "key": "ctrl+alt+r",
  "command": "vscode-dataform-tools.runChangedActions",
  "args": { "includeDependents": true, "includeDependencies": false, "fullRefresh": false }
}
```
