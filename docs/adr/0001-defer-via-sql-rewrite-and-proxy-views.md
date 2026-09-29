---
status: accepted
---

# Defer to prod by rewriting compiled SQL for reads and creating Proxy Views for runs

Dataform has no equivalent of dbt's `--defer`, and neither the Dataform CLI nor the Dataform API will run a compiled graph we have edited. So we emulate it at the application layer in two ways. For read paths the extension executes itself (dry run, preview, cost estimate, compiled query view), we rewrite the compiled SQL, swapping each Deferred Action's backtick-quoted Dev Target for its Prod Target. For runs (`dataform run`, API and workspace invocations), we create a labelled **Proxy View** (`SELECT * FROM <Prod Target>`) at each missing Dev Target before dispatching, so Dataform's own runner reads prod through dev names.

## Considered Options

- **Zero-copy clones** instead of views: rejected because they are stale snapshots and need clone permission on prod.
- **Our own executor** (`dataform build`, then rewrite each task, then run through the BigQuery client): rejected because it bypasses workflow invocations and would make us responsible for incremental and assertion semantics.
- **A user-side `ref` helper driven by `--vars`**: rejected because every project would have to add code, and it fits the API workspace path poorly.

## Consequences

- Views are resolved with the querying principal's permissions, so the identity running the workflow (e.g. a dev service account) needs read access on the prod datasets it defers to. The extension checks this before a run and never changes IAM.
- Proxy Views stay in dev datasets, labelled so they can be found and removed. They still count as missing when deciding what to defer, and the next real dev build of that action replaces them.
- The extension never creates dev datasets. A run fails if a Deferred Action's dev dataset is missing.
