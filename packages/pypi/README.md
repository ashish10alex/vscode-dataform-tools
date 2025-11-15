# Dataform Tools for Google Cloud Platform

>Wrapper for the Google Cloud Dataform Python Package (google-cloud-dataform) that simplifies common operations such as listing repositories, managing workspaces, creating compilation results, and triggering workflow invocations.

## Installation

Required `python >=3.10`

```bash
pip install dataform-tools
```

## Usage


### List Repositories
```py
from dataform_tools import DataformTools
client = DataformTools("your-gcp-project-id", "europe-west2")
repositories = client.list_repositories()
print(repositories)
```

### List Workspaces
```py
from dataform_tools import DataformTools
client = DataformTools("your-gcp-project-id", "europe-west2")
workspaces = client.list_workspaces("repository_name")
print(workspaces)
```

### Create Workspace
```py
from dataform_tools import DataformTools
client = DataformTools("your-gcp-project-id", "europe-west2")
workspace = client.create_workspace("repository_name", "workspace_name")
print(workspace)
```

### Get repository
```py
from dataform_tools import DataformTools
client = DataformTools("your-gcp-project-id", "europe-west2")
repository = client.get_repository("repository_name")
print(repository)
```

### Create Compilation Result

Creates a compilation object from Dataform Pipeline using either the code from a specific git_commitish or workspace.

```py
from dataform_tools import DataformTools
client = DataformTools("your-gcp-project-id", "europe-west2")
compilation_result = client.create_compilation_result("repository_name", "git_branch_name", None, code_compilation_config={"table_prefix": "aa"})
print(compilation_result)
```

### Compilation Result Actions

Quries a list of actions that will be created by a compilation object from Dataform Pipeline using either the code from a specific git_commitish or workspace.

```py
from dataform_tools import DataformTools
client = DataformTools("your-gcp-project-id", "europe-west2")
compilation_result = client.create_compilation_result("repository_name", "git_branch_name", None, code_compilation_config={"table_prefix": "aa"})
if(compilation_result and compilation_result.name):
    actions = client.query_compilation_result_actions(compilation_result.name)
    print(actions)
```

### Create Workflow Invocation

Creates a execution of Dataform Pipeline using either the code from a specific git_commitish or workspace.

```py
from dataform_tools import DataformTools
from dataform_tools import InvocationConfigType
client = DataformTools("your-gcp-project-id", "europe-west2")

repository_name = "repository_name"
compilation_result = client.create_compilation_request(repository_name, "git_branch_name", None, code_compilation_config={"table_prefix": "aa"})
if(compilation_result and compilation_result.name):
    invocation_config: InvocationConfigType = {
        "included_tags" : ["your-tag"],
        "transitive_dependencies_included" : False,
        "transitive_dependents_included" : False,
        "fully_refresh_incremental_tables_enabled" : False,
    }
    workflow_invocation = client.create_workflow_invocation(repository_name, compilation_result.name, invocation_config)
    workflow_invocation_id = workflow_invocation.name.split("/").pop()
    if(workflow_invocation_id):
        workflow_invocation_url = client.get_workflow_invocation_url(repository_name, workflow_invocation_id)
        print(workflow_invocation_url)
```



### Write content to a file in workspace

```py
from dataform_tools import DataformTools
client = DataformTools("your-gcp-project-id", "europe-west2")
client.write_file("repository_name", "workspace_name", "relative/path/to/file/in/workspace.sql", "select 1 as a")
```

### Installs NPM packages in a Dataform workspace.

```py
from dataform_tools import DataformTools
client = DataformTools("your-gcp-project-id", "europe-west2")
client.install_npm_packages("repository-name", "my-workspace");
```

### Pull git commits from remote repository to workspace

```py
from dataform_tools import DataformTools
client = DataformTools("your-gcp-project-id", "europe-west2")
client.pull_git_commits("repository-name", "workspace-name", {"remote-git-branch", "git-user-name", "git-user-email"});
```

### Get git status of the remote workspace

```py
from dataform_tools import DataformTools
client = DataformTools("your-gcp-project-id", "europe-west2")

client.get_workspace_git_state("repository-name", "workspace-name")
```


### Reset changes in workspace

```py
from dataform_tools import DataformTools
client = DataformTools("your-gcp-project-id", "europe-west2")
const paths = [];  # array of file paths to reset. If empty, all changes will be reset.
const clean = true; # If true, untracked files will be removed. Defaults to true.
client.reset_workspace_changes("repository-name", "workspace-name", paths, clean)
```

### Fetch Git ahead/behind against a remote branch for a workspace

```py
from dataform_tools import DataformTools
client = DataformTools("your-gcp-project-id", "europe-west2")
client.fetch_git_ahead_behind("repository-name", "workspace-name", "remote-git-branch")
```

### Push workspace commits to git remote repository

```py
from dataform_tools import DataformTools
client = DataformTools("your-gcp-project-id", "europe-west2")
client.push_workspace_commits("repository-name", "my-worksapce", "remote_git_branch") 
```


### Run Dataform workflow in GCP

```py
from dataform_tools import DataformTools

code_compilation_config = {} # overrides such as table prefix
invocation_config = {
    included_tags: [tagToRun],
    fully_refresh_incremental_tables_enabled: false,
    transitive_dependents_included: false,
    transitive_dependencies_included:false
}

repository_name = "repository_name"
workspace_name = undefined  # use workspace name if you want to compile a workspace.
git_commitish = "branch_name" # branch name, tag, commit sha

client = DataformTools("your-gcp-project-id", "europe-west2")
output = client.run_dataform_remotely(repository_name, code_compilation_config, invocation_config, workspace_name, git_commitish)
print(output)
```