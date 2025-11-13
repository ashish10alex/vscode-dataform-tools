# Dataform Tools for Google Cloud Platform

> Wrapper for Google Cloud Dataform npm pacakge @google-cloud/dataform that simplifies common operations such as listing repositories, managing workspaces, creating compilation results, and triggering workflow invocations.

---

## Installation

```bash
npm install @ashishalex/dataform-tools
```


## Usage


### List Repositories
```js
import {DataformTools} from "@ashishalex/dataform-tools"

const client = new DataformTools("your-gcp-project-id", "europe-west2")
const repositories = await client.listRepositories()
```

### List Workspaces
```js
import {DataformTools} from "@ashishalex/dataform-tools"

const client = new DataformTools("your-gcp-project-id", "europe-west2")
const workspaces  = await client.listWorkspaces("repository-name")
console.log(workspaces)
```

### Create Workspace
```js
import {DataformTools} from "@ashishalex/dataform-tools"

const client = new DataformTools("your-gcp-project-id", "europe-west2")
const workspace = await client.createWorkspace("repository-name", "workspace-name")
console.log(workspace)
```

### Get repository
```js
import {DataformTools} from "@ashishalex/dataform-tools"

const client = new DataformTools("your-gcp-project-id", "europe-west2")
const repository = await client.getRepository("repository-name")
console.log(repository)
```

### Create Compilation Result
```js
import {DataformTools} from "@ashishalex/dataform-tools"

const client = new DataformTools("your-gcp-project-id", "europe-west2")

const codeCompilationConfig = {} // overrides such as table prefix
const workspaceName = undefined  // use workspace name if you want to compile a workspace.
const gitCommitIsh = "branch_name" // branch name, tag, commit sha
const compilationResult = await client.createCompilationResult("repository-name", codeCompilationConfig, workspaceName, gitCommitIsh)
console.log(compilationResult)
```

### Compilation Result Actions
```js
import {DataformTools} from "@ashishalex/dataform-tools"

const client = new DataformTools("your-gcp-project-id", "europe-west2")

const codeCompilationConfig = {} // overrides such as table prefix
const workspaceName = undefined  // use workspace name if you want to compile a workspace.
const gitCommitIsh = "branch_name" // branch name, tag, commit sha
const compilationResult = await client.createCompilationResult("repository-name", codeCompilationConfig, workspaceName, gitCommitIsh)
const actions = await client.queryCompilationResultActions(compilationResult.name)
console.log(actions)
```

### Create Workflow Invocation
```js
import {DataformTools} from "@ashishalex/dataform-tools"

const client = new DataformTools("your-gcp-project-id", "europe-west2")

const codeCompilationConfig = {} // overrides such as table prefix
const workspaceName = undefined  // use workspace name if you want to compile a workspace.
const gitCommitIsh = "branch_name" // branch name, tag, commit sha
const compilationResult = await client.createCompilationResult("repository-name", codeCompilationConfig, workspaceName, gitCommitIsh)
if(compilationResult.name){
    const workflowInvocation = client.createWorkflowInvocation(repositoryName, compilationResult.name, {
        includedTags: [tagToRun],
        fullyRefreshIncrementalTablesEnabled: false,
        transitiveDependentsIncluded: false,
        transitiveDependenciesIncluded:false
    })
    console.log(workflowInvocation)
    const workflowInvocationId = workflowInvocation.name?.split("/").pop()
    if(workflowInvocationId){
    const workflowInvocationUrl = client.getWorkflowInvocationUrl(repositoryName, workflowInvocationId)
    console.log(workflowInvocationUrl)
}
```
