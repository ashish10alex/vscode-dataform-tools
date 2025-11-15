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
const gitCommitish = "branch_name" // branch name, tag, commit sha
const compilationResult = await client.createCompilationResult("repository-name", codeCompilationConfig, workspaceName, gitCommitish)
console.log(compilationResult)
```

### Compilation Result Actions
```js
import {DataformTools} from "@ashishalex/dataform-tools"

const client = new DataformTools("your-gcp-project-id", "europe-west2")

const codeCompilationConfig = {} // overrides such as table prefix
const workspaceName = undefined  // use workspace name if you want to compile a workspace.
const gitCommitish = "branch_name" // branch name, tag, commit sha
const compilationResult = await client.createCompilationResult("repository-name", codeCompilationConfig, workspaceName, gitCommitish)
const actions = await client.queryCompilationResultActions(compilationResult.name)
console.log(actions)
```

### Create Workflow Invocation
```js
import {DataformTools} from "@ashishalex/dataform-tools"

const client = new DataformTools("your-gcp-project-id", "europe-west2")

const codeCompilationConfig = {} // overrides such as table prefix
const workspaceName = undefined  // use workspace name if you want to compile a workspace.
const gitCommitish = "branch_name" // branch name, tag, commit sha
const compilationResult = await client.createCompilationResult("repository-name", codeCompilationConfig, workspaceName, gitCommitish)
if(compilationResult.name){
    const invocationConfig = {
        includedTags: [tagToRun],
        fullyRefreshIncrementalTablesEnabled: false,
        transitiveDependentsIncluded: false,
        transitiveDependenciesIncluded:false
    }
    const workflowInvocation = client.createWorkflowInvocation(repositoryName, compilationResult.name, invocationConfig)
    console.log(workflowInvocation)
    const workflowInvocationId = workflowInvocation.name?.split("/").pop()
    if(workflowInvocationId){
    const workflowInvocationUrl = client.getWorkflowInvocationUrl(repositoryName, workflowInvocationId)
    console.log(workflowInvocationUrl)
}
```

### Write content to a file in workspace

```js
import {DataformTools} from "@ashishalex/dataform-tools"

const client = new DataformTools("your-gcp-project-id", "europe-west2")
client.writeFile("repository-name", "workspace-name", "relative/path/to/file/in/workspace.sql", "select 1 as a");
```

### Installs NPM packages in a Dataform workspace.

```js
import {DataformTools} from "@ashishalex/dataform-tools"

const client = new DataformTools("your-gcp-project-id", "europe-west2")
client.installNpmPackages("repository-name", "workspace-name");
```

### Pull git commits from remote repository to workspace

```js
import {DataformTools} from "@ashishalex/dataform-tools"

const client = new DataformTools("your-gcp-project-id", "europe-west2")
client.pullGitCommits("repository-name", "workspace-name", gitOptions:{"remote-git-branch", "git-user-name", "git-user-email"});
```

### Get git status of the remote workspace

```js
import {DataformTools} from "@ashishalex/dataform-tools"
const client = new DataformTools("your-gcp-project-id", "europe-west2")
client.getWorkspaceGitState("repository-name", "workspace-name")
```

### Reset changes in workspace

```js
import {DataformTools} from "@ashishalex/dataform-tools"
const client = new DataformTools("your-gcp-project-id", "europe-west2")
const paths = [];  // array of file paths to reset. If empty, all changes will be reset.
const clean = true; // If true, untracked files will be removed. Defaults to true.
client.resetWorkspaceChanges("repository-name", "workspace-name", paths, clean)
```

### Fetch Git ahead/behind against a remote branch for a workspace

```js
import {DataformTools} from "@ashishalex/dataform-tools"
const client = new DataformTools("your-gcp-project-id", "europe-west2")
client.fetchGitAheadBehind("repository-name", "workspace-name")
```

### Push workspace commits to git remote repository

```js
import {DataformTools} from "@ashishalex/dataform-tools"
const client = new DataformTools("your-gcp-project-id", "europe-west2")
client.pushWorkspaceCommits("repository-name", "my-worksapce", "workspace-name") 
```

     
### Run Dataform workflow in GCP

Compilation followed by workflow invocation

```js
import {DataformTools} from "@ashishalex/dataform-tools"
const client = new DataformTools("your-gcp-project-id", "europe-west2")

const codeCompilationConfig = {} // overrides such as table prefix
const invocationConfig = {
    includedTags: [tagToRun],
    fullyRefreshIncrementalTablesEnabled: false,
    transitiveDependentsIncluded: false,
    transitiveDependenciesIncluded:false
}
const workspaceName = undefined  // use workspace name if you want to compile a workspace.
const gitCommitish = "branch_name" // branch name, tag, commit sha
client.runDataformRemotely("repository-name", codeCompilationConfig, invocationConfig, workspaceName, gitCommitish)
```
