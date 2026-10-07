# dbt example

The dbt twin of `../dataform`: the same sources, staging views and marts
under the same names, so the two compiled graphs can be compared. It ships
its own `profiles.yml`, which builds in `alex-personal-dev-01` (set
`XF_GCP_PROJECT` for another project). `../data/load.sh` loads the raw
tables it reads.

```bash
dbt compile             # from this directory
xf                      # or: xf --dir examples/dbt
```

Shared with the Dataform example: `raw.customers|orders|payments` (sources),
`stg_customers|stg_orders|stg_payments` (views), `dim_customers` (table,
partitioned and clustered), `fct_orders` (incremental, merged on
`order_id`), the audit log (the `record_run_in_audit_log` macro, run with
`dbt run-operation`) and the checks.

dbt only: a seed, a snapshot, an ephemeral model, a materialized view,
macros, an analysis, an exposure, a docs block, a versioned model with a
contract, a unit test, and a model with its own schema and alias.

Project hooks (`on-run-start`, `on-run-end`) are in `../dbt-hooks`: dbt v2
runs them when it compiles, so xf only parses projects that have them.
