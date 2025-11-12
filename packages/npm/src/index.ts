import { DataformClient } from '@google-cloud/dataform';
import { protos } from '@google-cloud/dataform';
import logger from "./logger.js";

type Target = {
    database?: (string|null);
    schema?: (string|null);
    name?: (string|null);
};

type CodeCompilationConfig = {
    assertionSchema: string,  
    databaseSuffix: string,            
    builtinAssertionNamePrefix: string,
    defaultLocation: string,           
    tablePrefix: string,               
    vars: { [k: string]: string; },                      
    schemaSuffix: string,              
    defaultSchema: string,             
    defaultDatabase: string,           
    defaultNotebookRuntimeOption:string
} | {};

type InvocationConfig = {
    includedTargets?: Target[];
    includedTags?: string[];
    transitiveDependenciesIncluded: boolean;
    transitiveDependentsIncluded: boolean;
    fullyRefreshIncrementalTablesEnabled: boolean;
    serviceAccount?: string;
};


// By exporting the class, you make it available for other packages to import.
export class DataformTools {
    gcpProjectId: string;
    gcpLocation: string;
    client: DataformClient;

    /**
     * Creates an instance of the DataformTools.
     * @param gcpProjectId The Google Cloud Project ID.
     * @param gcpLocation The location of the Dataform repository (e.g., "europe-west2").
     */
    constructor(gcpProjectId: string, gcpLocation: string) {
        if (!gcpProjectId || !gcpLocation) {
            throw new Error("gcpProjectId and gcpLocation must be provided.");
        }
        this.gcpProjectId = gcpProjectId;
        this.gcpLocation = gcpLocation;
        //TODO: ability to use service account
        this.client = new DataformClient();
    }

    /**
     * Lists all repositories in a GCP project and location.
     * @returns A promise that resolves to an array of repositories. {@link protos.google.cloud.dataform.v1beta1.Repository|Repository}
     */
    async listRepositories() {
        const parent = `projects/${this.gcpProjectId}/locations/${this.gcpLocation}`;
        const [repositories] = await this.client.listRepositories({
            parent: parent
        });
        return repositories;
    }


    /**
     * Get Dataform repository from Google Cloud Platform (GCP).
     * @param repositoryName The name of the Dataform repository.
     * @returns A promise that resolves to an object representing repository. {@link protos.google.cloud.dataform.v1beta1.Repository|Repository}
     */
    async getRepository(repositoryName:string) {
        if (!repositoryName) {
            throw new Error("Dataform repository name (repositoryName) must be provided.");
        }

        const repositoryPath = `projects/${this.gcpProjectId}/locations/${this.gcpLocation}/repositories/${repositoryName}`;
        const [repository] = await this.client.getRepository({
            name: repositoryPath
        });
        return repository;
    }


    /**
     * Lists all workspaces within a specific repository.
     * @param repositoryName The name of the Dataform repository.
     * @returns A promise that resolves to an array of workspace objects. {@link protos.google.cloud.dataform.v1beta1.Workspace|Workspace}
     */
    async listWorkspaces(repositoryName: string) {
        if (!repositoryName) {
            throw new Error("Dataform repository name (repositoryName) must be provided.");
        }
        const parent = `projects/${this.gcpProjectId}/locations/${this.gcpLocation}/repositories/${repositoryName}`;
        const [workspaces] = await this.client.listWorkspaces({
            parent: parent
        });
        return workspaces;
    }

    /**
     * Get Dataform workspace inside a repository from Google Cloud Platform (GCP).
     * @param workspaceName The name of the Dataform workspace.
     * @returns A promise that resolves to a workspace object. {@link protos.google.cloud.dataform.v1beta1.Workspace|Workspace}
     */
    async getWorkspace(repositoryName:string, workspaceName:string) {
        if (!repositoryName) {
            throw new Error("dataformRepositoryName must be provided.");
        }else if (!workspaceName){
            throw new Error("workspaceName must be provided.");
        }

        const workspacePath = `projects/${this.gcpProjectId}/locations/${this.gcpLocation}/repositories/${repositoryName}/workspaces/${workspaceName}`;
        const [workspace] = await this.client.getWorkspace({
            name: workspacePath
        });
        return workspace;
    }

    /**
     * Creates a workspace in a Dataform repository 
     * @param repositoryName The name of the Dataform repository.
     * @param workspaceName The name of the Dataform workspace
     * @returns A promise that resolves to a workspace object. {@link protos.google.cloud.dataform.v1beta1.Workspace|Workspace}
     */
    async createWorkspace(repositoryName:string, workspaceName:string){
        if (!repositoryName) {
            throw new Error("dataformRepositoryName must be provided.");
        }else if (!workspaceName){
            throw new Error("workspaceName must be provided.");
        }

        const parent = `projects/${this.gcpProjectId}/locations/${this.gcpLocation}/repositories/${repositoryName}`;
        try {
            const [workspace] = await this.client.createWorkspace({
                parent: parent,
                workspaceId: workspaceName
            });
            return workspace;
        } catch (error:any) {
            if(error.code === 6){
                logger.warn(error.details);
                return await this.getWorkspace(repositoryName, workspaceName);
            }
        }
    }

    /**
   * Creates a compilation result using either a workspace or git commitish.
   * @param repositoryName - Name of the Dataform repository
   * @param codeCompilationConfig {@link CodeCompilationConfig} compilation overides
   * @param workspaceName - name of the Dataform workspace in GCP the compilation should be triggered for 
   * @param gitCommitish - git branch, tag or commit sha that should be used for compilation
   * @returns compilation result  {@link protos.google.cloud.dataform.v1beta1.ICompilationResult|ICompilationResult}
   * @throws {Error} If both or neither workspaceName and gitCommitish are provided
   */
    async createCompilationResult(repositoryName:string, codeCompilationConfig: CodeCompilationConfig, workspaceName?:string, gitCommitish?: string){
        const parent = `projects/${this.gcpProjectId}/locations/${this.gcpLocation}/repositories/${repositoryName}`;

        if(gitCommitish && workspaceName){
            throw new Error("Compilation can either be done using a gitCommitIsh, e.g. branch name OR name of the workspace in Dataform repository in GCP but not both");
        }

        if(!(gitCommitish || workspaceName)){
            throw new Error("Compilation should be done either using gitCommitish, e.g. branch name OR name of the workspace in Dataform repository in GCP");
        }

        const [compilationResult] = await this.client.createCompilationResult({
        parent: parent,
        compilationResult: {
            codeCompilationConfig: codeCompilationConfig,
            ...(gitCommitish ? {gitCommitish} : { 
                    workspace : `projects/${this.gcpProjectId}/locations/${this.gcpLocation}/repositories/${repositoryName}/workspaces/${workspaceName}`
                }
            )
        }
        });
        return compilationResult;

    }


    /**
     * List all the actions from the compilation that can be used for workflow invocation
     * @param compilationResultName The `name` attribute from compilation result  {@link protos.google.cloud.dataform.v1beta1.ICompilationResult|ICompilationResult}
     * @returns A promise that resolves to an array of actions {@link protos.google.cloud.dataform.v1beta1.ICompilationResultAction|ICompilationResultAction[]}.
     */
    async queryCompilationResultActions(compilationResultName: string) {
        if (!compilationResultName) {
            throw new Error("required name attribute from the compilation result (compilationResultName). Compilation result can be obtained by calling createCompilationResult method in this class");
        }
        const [actions] = await this.client.queryCompilationResultActions({
            name: compilationResultName
        });
        return actions;
    }


    /**
     * Create workflow invocation using compilation result
     * @param repositoryName - Name of the Dataform repository
     * @param compilationResultName The `name` attribute from compilation result  {@link protos.google.cloud.dataform.v1beta1.ICompilationResult|ICompilationResult}
     * @param {InvocationConfig} object representing {@link InvocationConfig}
     * @returns A promise that resolves to workflow invocation object {@link protos.google.cloud.dataform.v1beta1.IWorkflowInvocation|IWorkflowInvocation}.
     */
    async createWorkflowInvocation(repositoryName:string, compilationResultName:string, invocationConfig: InvocationConfig) {
        const parent = `projects/${this.gcpProjectId}/locations/${this.gcpLocation}/repositories/${repositoryName}`;
        const [workflowInvocation] = await this.client.createWorkflowInvocation({
            parent: parent,
            workflowInvocation: {
                compilationResult: compilationResultName,
                invocationConfig: invocationConfig
            }
        });
        return workflowInvocation;
    }
}