# Dataform Tools

A VS Code extension for developing, compiling, previewing and running Dataform projects on BigQuery.

## Language

### Environments

**Dev Overrides**:
Compiler options layered on the project defaults to send actions to development locations, e.g. a schema suffix, table prefix, database suffix or vars.
_Avoid_: dev config, dev environment settings

**Prod Options**:
The compiler options that describe where production builds of actions live, e.g. `--default-database=<prod project> --vars=env=prod`. When not set explicitly, the project defaults with the Dev Overrides removed.
_Avoid_: prod overrides, prod config

**Dev Target**:
The table an action resolves to in the compile the extension develops against: the project defaults plus any Dev Overrides. In many projects the defaults already point at dev.

**Prod Target**:
The table an action resolves to under the Prod Options.
_Avoid_: prod manifest, prod state

### Change detection

**Changed Action**:
An action whose compiled output differs from its compiled output at the merge-base with the default branch.
_Avoid_: modified model, dirty action

### Defer

**Selected Action**:
An action a run, preview or dry run executes: the ones the user picked, plus any dependencies or dependents the run includes. Its other upstream actions are the ones that can be deferred.

**Deferral**:
Reading an upstream action or declaration from its Prod Target instead of its Dev Target, because it is not a Selected Action, its Dev Target does not exist, and its Prod Target exists and is readable.
_Avoid_: fallback, prod redirect

**Deferred Action**:
An upstream action or declaration that a Deferral applies to for a given run or preview.

**Stale Deferral**:
A Deferred Action that is also a Changed Action, so its Prod Target does not reflect the branch's code.

**Proxy View**:
A view at a Deferred Action's Dev Target that selects everything from its Prod Target, so a Dataform run reads prod data through dev names.
_Avoid_: stub, shim, placeholder table
