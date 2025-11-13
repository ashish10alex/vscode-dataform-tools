# Dataform Tools for Google Cloud Platform

>wrapper of the Google Cloud Dataform Python Package (google-cloud-dataform) that simplifies common operations such as listing repositories, managing workspaces, creating compilation results, and triggering workflow invocations.

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
client = DataformTools("your-gcp-project-id", "europe-west2")
repository_name = "repository_name"
compilation_result = client.create_compilation_result(repository_name, "git_branch_name", None, code_compilation_config={"table_prefix": "aa"})
if(compilation_result and compilation_result.name):
    invocation_config = {
        "included_tags" : ["your-tag"]
        "transitive_dependencies_included" : False
        "transitive_dependents_included" : False
        "fully_refresh_incremental_tables_enabled" : False
    }
    workflow_invocation = client.create_workflow_invocation(repository_name, compilation_result.name, invocation_config)
    print(workflow_invocation)
```
