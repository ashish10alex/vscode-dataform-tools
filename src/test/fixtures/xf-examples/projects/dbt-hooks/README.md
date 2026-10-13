# dbt project with hooks

dbt v2 runs a project's `on-run-start` and `on-run-end` hooks when it
compiles, so compiling on every save would create the UDF and insert into
the audit log each time. For a project like this one xf runs `dbt parse`
instead: the graph and lineage are complete, the SQL is shown uncompiled,
and the UI says why. Set `dbtCompileWithHooks` to compile anyway. dbt-core
1.x doesn't run hooks when it compiles, so xf compiles with it as usual.
