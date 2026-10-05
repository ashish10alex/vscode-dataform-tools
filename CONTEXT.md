# Dataform Tools

A VS Code extension for developing, compiling, previewing and running Dataform projects on BigQuery.

## Language

### Projects and backends

**Backend**:
The tool a project is written for and compiled with: Dataform or dbt.
_Avoid_: tool, engine, compilation backend

**Project**:
A directory tree that one Backend compiles as a unit, identified by that Backend's settings file at its root. A directory holding the settings files of two Backends is two Projects that share a root.

**Compilation Mode**:
How a Dataform Project is compiled: CLI compiles the working tree with the Dataform CLI, API compiles the pushed commit with the Dataform API. dbt Projects have no Compilation Mode.
_Avoid_: compilation backend, backend (for this choice)

**Compiled Graph**:
The Backend-neutral result of compiling a Project: its actions, their Targets, their compiled SQL and the dependencies between them.
_Avoid_: graph (unqualified), compiled JSON, manifest

**Action**:
One thing a Project defines in its Compiled Graph, whichever Backend it comes from: a Dataform table, assertion or declaration, a dbt model, seed, test or source. User-facing text names a single action by its Kind ("this model", "this assertion") and says "actions" for several.
_Avoid_: node, resource, model (as the general word)

**Kind**:
What sort of thing an action is, from one list shared by both Backends, e.g. table, view, incremental, assertion, declaration, seed, snapshot, test, unit test, source. Each Backend's own word is kept where two Kinds play the same part: assertion and test, declaration and source. A unit test is one Kind in both Backends.
_Avoid_: type, action type, resource type, materialization

**Target**:
The table or view an action builds or stands for, written `database.schema.name`.
_Avoid_: relation

**dbt target**:
An entry in a dbt profile that says where and how dbt builds. Always written with "dbt"; never a bare "target".
_Avoid_: target (unqualified), profile target

### Environments

**Dev Overrides**:
Dataform only for now. Compiler options layered on the project defaults to send actions to development locations, e.g. a schema suffix, table prefix, database suffix or vars.
_Avoid_: dev config, dev environment settings

**Prod Options**:
Dataform only for now. The compiler options that describe where production builds of actions live, e.g. `--default-database=<prod project> --vars=env=prod`. When not set explicitly, the project defaults with the Dev Overrides removed.
_Avoid_: prod overrides, prod config

**Dev Target**:
The Target an action resolves to in the compile the extension develops against. For Dataform that is the project defaults plus any Dev Overrides; in many projects the defaults already point at dev.

**Prod Target**:
Dataform only for now. The Target an action resolves to under the Prod Options.
_Avoid_: prod manifest, prod state

### Change detection

**Changed Action**:
An action whose compiled output differs from its compiled output at the merge-base with the default branch.
_Avoid_: modified model, dirty action

### Defer

**Selected Action**:
An action a run, preview or dry run executes: the ones the user picked, plus any dependencies or dependents the run includes. Its other upstream actions are the ones that can be deferred.

**Deferral**:
Reading an upstream action from its Prod Target instead of its Dev Target, because it is not a Selected Action, its Dev Target does not exist, and its Prod Target exists and is readable.
_Avoid_: fallback, prod redirect

**Deferred Action**:
An upstream action that a Deferral applies to for a given run or preview.

**Stale Deferral**:
A Deferred Action that is also a Changed Action, so its Prod Target does not reflect the branch's code.

**Proxy View**:
A view at a Deferred Action's Dev Target that selects everything from its Prod Target, so a Dataform run reads prod data through dev names.
_Avoid_: stub, shim, placeholder table
