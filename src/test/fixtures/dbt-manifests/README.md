# Whole dbt manifests

The `manifest.json` a real dbt wrote for the example Projects in `../xf-examples/projects`, for the dbt Backend's manifest reader. The recordings in `../xf-examples` are xf's cut-down manifests; these have every field dbt writes, so the reader is tested against what it will meet.

| File | What it is |
|---|---|
| `dbt-core.json`, `dbt-v2.json` | `dbt compile` of `projects/dbt`, by dbt-core 1.x and by dbt v2 |
| `dbt-core-hooks-parsed.json`, `dbt-v2-hooks-parsed.json` | `dbt parse` of `projects/dbt-hooks`: nothing is compiled, and the Project's on-run hooks are there as actions |

Each is as dbt wrote it but for three cuts: the SQL of dbt's own macros (nine tenths of the file), the absolute path of the Project, and the anonymous user id.

To record them again, with a dbt-core 1.x and a dbt v2:

```bash
just record-dbt-manifests ~/.local/bin/dbt-core dbt
```

The compile connects to BigQuery as your Application Default Credentials, in the GCP project the Project's `profiles.yml` names (`XF_GCP_PROJECT` changes it). It builds nothing. The parse of `dbt-hooks` connects to nothing and runs no hook.
