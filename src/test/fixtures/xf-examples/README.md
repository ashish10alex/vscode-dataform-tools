# Fixtures from xf

Copied from xf (`ashish10alex/xf`, private), the reference implementation in Go, and used unchanged. Do not edit them here: change them in xf (`just fixtures-examples` there) and copy again.

| File | What it is |
|---|---|
| `dataform*.json` | `dataform compile --json` of xf's Dataform example, and of the one with a bad `ref` |
| `dbt-core*.json`, `dbt-v2*.json` | The manifest dbt-core 1.x and dbt v2 wrote for `projects/dbt`, cut down to the fields xf reads |
| `dbt-*-broken*.json` | The same for `projects/dbt-broken`, with the errors xf read from dbt's log in `xf_errors` |
| `*-windows.json` | The same output as Windows gives it: backslashes in file paths |
| `projects/dbt` | The example dbt Project: seeds, a snapshot, an ephemeral model, a materialized view, tests, a unit test, an analysis, an exposure, a versioned model |
| `projects/dbt-broken` | One bad `ref`, to see compile errors |
| `projects/dbt-hooks` | `on-run-start` and `on-run-end` hooks, which dbt v2 runs when it compiles. It has no recording: xf only tests it against a real dbt |

`src/backend/dbt/fixtures.ts` reads the dbt ones for the dbt Backend's tests, which run in plain Node: `just test-node`.

The Projects name the GCP project `alex-personal-dev-01` in `profiles.yml`; set `XF_GCP_PROJECT` to compile them against another. Not copied: xf's `examples/data` (the CSVs and the script that load the raw tables into BigQuery), which only a real run needs.
