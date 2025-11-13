import logging
from typing_extensions import TypedDict, List, Optional, Dict, Any, Union, NotRequired
from google.cloud import dataform_v1beta1
from google.cloud.dataform_v1beta1.types import CompilationResult
from google.cloud.dataform_v1beta1.types import CodeCompilationConfig
from google.cloud.dataform_v1beta1.types import WorkflowInvocation
from google.cloud.dataform_v1beta1.types import InvocationConfig
from google.cloud.dataform_v1beta1.types import Workspace, Repository
from google.api_core.exceptions import AlreadyExists, GoogleAPICallError, NotFound

logger = logging.getLogger(__name__)

class Target(TypedDict, total=False):
    database: Optional[str]
    schema: Optional[str]
    name: Optional[str]

class CodeCompilationConfigType(TypedDict, total=False):
    # The default database (Google Cloud project ID).
    default_database: Optional[str]
    # The default schema (BigQuery dataset ID).
    default_schema:	Optional[str]
    # The default BigQuery location to use. Defaults to "US". See the BigQuery docs for a full list of locations: https://cloud.google.com/bigquery/docs/locations.
    default_location: Optional[str]
    # The default schema (BigQuery dataset ID) for assertions.
    assertion_schema: Optional[str]
    #User-defined variables that are made available to project code during compilation.
    vars:	Optional[Dict[str, str]]
    # The suffix that should be appended to all database (Google Cloud project ID) names.
    database_suffix:	Optional[str]
    # The suffix that should be appended to all schema (BigQuery dataset ID) names.
    schema_suffix:	Optional[str]
    # The prefix that should be prepended to all table names.
    table_prefix:	Optional[str]
    # The prefix to prepend to built-in assertion names.
    builtin_assertion_name_prefix:	Optional[str]
    # NOTE: not supporting this yet
    # The default notebook runtime options. 
    # default_notebook_runtime_options	Optional[google.cloud.dataform_v1.types.NotebookRuntimeOptions]

class InvocationConfigType(TypedDict, total=True):
    included_targets: NotRequired[Optional[List[Target]]]
    included_tags: NotRequired[Optional[List[str]]]
    transitive_dependencies_included: bool
    transitive_dependents_included: bool
    fully_refresh_incremental_tables_enabled: bool
    service_account: NotRequired[str]

class CompilationResultType(TypedDict, total=False):
    workspace: Optional[str]
    git_commitish: Optional[str]
    code_compilation_config: CodeCompilationConfig

class DataformTools():
    def __init__(self, gcp_project_id:str, gcp_location:str):
        """Initializes the DataformTools class.
        Args:
            gcp_project_id (str): The GCP project ID.
            gcp_location (str): The GCP location.
        """
        self.gcp_project_id = gcp_project_id
        self.gcp_location = gcp_location
        self.client = dataform_v1beta1.DataformClient()
    
    def list_repositories(self):
        """Lists repositories in Dataform.
        Returns:
            ListRepositoriesResponse: list of repository objects
        """
        parent = f"projects/{self.gcp_project_id}/locations/{self.gcp_location}"
        request = dataform_v1beta1.ListRepositoriesRequest(
            parent  = parent,
        )
        repositories = self.client.list_repositories(request)
        return repositories

    def get_repository(self, repository_name:str) -> Repository:
        """Gets a repository in Dataform.
        Args:
            repository_name (str): The name of the repository.
        Returns:
            Repository: repository object
        """
        request = dataform_v1beta1.GetRepositoryRequest(
            name  = repository_name,
        )
        repositories = self.client.get_repository(request)
        return repositories

    def list_workspaces(self, repository_name:str):
        parent = f"projects/{self.gcp_project_id}/locations/{self.gcp_location}/repositories/{repository_name}"
        request = dataform_v1beta1.ListWorkspacesRequest(
            parent  = parent,
        )
        workspaces = self.client.list_workspaces(request)
        return workspaces

    def get_workspace(self, repository_name:str, workspace_name:str) -> Workspace:
        """Gets a workspace in Dataform.
        Args:
            repository_name (str): The name of the repository.
            workspace_name (str): The name of the workspace.
        Returns:
            Workspace: workspace object
        """
        workspace_path = f"projects/{self.gcp_project_id}/locations/{self.gcp_location}/repositories/{repository_name}/workspaces/{workspace_name}"
        request = dataform_v1beta1.GetWorkspaceRequest(
            name  = workspace_path,
        )
        workspace = self.client.get_workspace(request)
        return workspace

    def create_workspace(self, repository_name:str, workspace_name:str) -> Workspace:
        """Creates a workspace in Dataform.
        Args:
            repository_name (str): The name of the repository.
            workspace_name (str): The name of the workspace.
        Returns:
            Workspace: workspace object
        """
        parent = f"projects/{self.gcp_project_id}/locations/{self.gcp_location}/repositories/{repository_name}"
        request = dataform_v1beta1.CreateWorkspaceRequest(
            parent = parent,
            workspace_id = workspace_name
        )
        try:
            return self.client.create_workspace(request)
        except AlreadyExists:
            logger.info(f"workspace: {parent}/workspaces/{workspace_name} already exsists. Fetching ...")
            return self.get_workspace(repository_name, workspace_name)
        except Exception as e:
            logger.error(f"Failed to create workspace: {e}")
            raise

    def delete_workspace(self, repository_name:str, workspace_name:str):
        """Deletes a workspace in Dataform.
        Args:
            repository_name (str): The name of the repository.
            workspace_name (str): The name of the workspace.
        """
        workspace_path = f"projects/{self.gcp_project_id}/locations/{self.gcp_location}/repositories/{repository_name}/workspaces/{workspace_name}"
        request = dataform_v1beta1.DeleteWorkspaceRequest(
            name  = workspace_path,
        )
        try:
            self.client.delete_workspace(request)
            logger.info(f"Deleted workspace: {workspace_path}")
        except NotFound:
            logger.error(f"Workspace: {workspace_path} not found")
        except Exception as e:
            logger.error(f"Failed to delte workspace: {e}")
            raise
    
    def create_compilation_request(self, repository_name:str, git_commitish:str|None, workspace_name:str|None, code_compilation_config:CodeCompilationConfigType) -> CompilationResult | None:
        """Creates a compilation request in Dataform.
        Args:
            repository_name (str): The name of the repository.
            git_commitish (str|None): The git commitish to compile from. E.g., a branch, tag, or commit SHA.
            workspace_name (str|None): The workspace name to compile from.
            code_compilation_config (CodeCompilationConfigType): The code compilation configuration.
        Returns:
            CompilationResult: The created compilation result.
        """

        if(workspace_name  is not None and git_commitish is not None):
            logger.error("Compilation request can only be created of one of workspace or git_commitish")
            return

        parent = f"projects/{self.gcp_project_id}/locations/{self.gcp_location}/repositories/{repository_name}"

        compilation_result_dict: CompilationResultType = {
            "code_compilation_config": dataform_v1beta1.CodeCompilationConfig(**code_compilation_config)
        }

        if(workspace_name):
            workspace_path = f"projects/{self.gcp_project_id}/locations/{self.gcp_location}/repositories/{repository_name}/workspaces/{workspace_name}"
            compilation_result_dict["workspace"] = workspace_path
        elif(git_commitish):
            compilation_result_dict["git_commitish"] = git_commitish

        compilation_result = dataform_v1beta1.CompilationResult(**compilation_result_dict)

        request = dataform_v1beta1.CreateCompilationResultRequest(
            parent=parent,
            compilation_result = compilation_result
        )
        return self.client.create_compilation_result(request)
    
    def query_compilation_result_actions(self, compilation_result_name:str):
        """Queries compilation result actions in Dataform.
        Args:
            compilation_result_name (str): The name of the compilation result.
        Returns:
            The compilation result actions.
        """
        request = dataform_v1beta1.QueryCompilationResultActionsRequest(
            name = compilation_result_name
        )
        compilation_result_actions = self.client.query_compilation_result_actions(request)
        return compilation_result_actions       

    def create_workflow_invocation(self, repository_name:str, compilation_result_name:str, invocation_config:InvocationConfigType) -> WorkflowInvocation:
        """Creates a workflow invocation in Dataform.
        Args:
            repository_name (str): The name of the repository.
            compilation_result_name (str): The name of the compilation result.
            invocation_config (InvocationConfigType): The invocation configuration.
        Returns:
            WorkflowInvocation: The created workflow invocation.
        """
        parent = f"projects/{self.gcp_project_id}/locations/{self.gcp_location}/repositories/{repository_name}"
        workflow_invocation = dataform_v1beta1.WorkflowInvocation(
            compilation_result = compilation_result_name,
            invocation_config = dataform_v1beta1.InvocationConfig(**invocation_config)
        )
        request = dataform_v1beta1.CreateWorkflowInvocationRequest(
            parent = parent,
            workflow_invocation = workflow_invocation
        )
        created_workflow_invocation = self.client.create_workflow_invocation(request)
        return created_workflow_invocation


    def write_file(self, repository_name:str, workspace_name:str, relative_path:str, contents:str|bytes)-> None:
        """Writes a file to a workspace in Dataform.
        Args:
            repository_name (str): The name of the repository.
            workspace_name (str): The name of the workspace.
            relative_path (str): The relative path of the file to write.
            contents (str|bytes): The contents of the file to write.
        Returns:
            None
        """
        workspace_path = f"projects/{self.gcp_project_id}/locations/{self.gcp_location}/repositories/{repository_name}/workspaces/{workspace_name}"
        request = dataform_v1beta1.WriteFileRequest(workspace=workspace_path,  path=relative_path, contents=contents)

        if isinstance(contents, str):
            buffer_contents = contents.encode(encoding="utf-8")
        else: buffer_contents = contents

        self.client.write_file(request)

    def get_workflow_invocation_url(self, repository_name: str, workflow_invocation_id: str) -> str:
        return f"https://console.cloud.google.com/bigquery/dataform/locations/{self.gcp_location}/repositories/{repository_name}/workflows/{workflow_invocation_id}?project={self.gcp_project_id}"