
import { protos } from '@google-cloud/dataform';
import { DataformClient  } from '@google-cloud/dataform';
import * as fs from 'fs/promises'; 
import {getGitUserMeta, getGitBranchAndRepoName} from "./getGitMeta";
import {CompilationType, InvocationConfig, ICompilationResult, ICodeCompilationConfig, DataformApiOptions} from "./types";

export class DataformApi {

    gcpProjectId:string;
    gcpProjectLocation:string;
    workspaceId:string;
    workspaceName:string;
    parent:string;
    client: DataformClient;
    gitRepoName:string;
    repositoryName:string;
    gitBranch:string;

    constructor (gcpProjectId:string, gcpLocation:string, options?:DataformApiOptions){
        this.gcpProjectId = gcpProjectId;
        this.gcpProjectLocation = gcpLocation;
        if(options?.gitMeta && options.gitMeta.gitRepoName && options.gitMeta.gitBranch){
            this.gitBranch = options.gitMeta.gitBranch;
            this.gitRepoName = options.gitMeta.gitRepoName;
        }else{
            const gitInfo = getGitBranchAndRepoName();
            if(!gitInfo || !gitInfo?.gitBranch || !gitInfo.gitRepoName){
                throw new Error("Error determining git repository and or branch name");
            } 
            this.gitBranch = gitInfo.gitBranch;
            this.gitRepoName = gitInfo.gitRepoName;
        }

        this.repositoryName = this.gitRepoName;
        this.workspaceId = this.gitBranch;
        this.client = new DataformClient(options?.clientOptions);
        this.parent =  `projects/${this.gcpProjectId}/locations/${this.gcpProjectLocation}/repositories/${this.repositoryName}`;
        this.workspaceName = `projects/${this.gcpProjectId}/locations/${this.gcpProjectLocation}/repositories/${this.repositoryName}/workspaces/${this.workspaceId}`;
    }

    getWorkflowInvocationUrl(workflowInvocationId:string) {
        return `https://console.cloud.google.com/bigquery/dataform/locations/${this.gcpProjectLocation}/repositories/${this.repositoryName}/workflows/${workflowInvocationId}?project=${this.gcpProjectId}`;
    }

    /**
     * Gets the workspace object
     *
     * @returns {Promise} - The promise which resolves to an object representing {@link protos.google.cloud.dataform.v1beta1.Workspace|Workspace}.
    */
    async getWorkspace() {
        const request = {
            name: this.workspaceName
        };
        const [workspace] = await this.client.getWorkspace(request);
        return workspace;
    }

    /**
     * Gets the repository object
     *
     * @returns {Promise} - The promise which resolves to an object representing {@link protos.google.cloud.dataform.v1beta1.Repository|Repository}.
    */
    async getRepository() {
        const request = {
            name: this.parent
        };
        const [repository] = await this.client.getRepository(request);
        return repository;
    }

    /**
     * Gets the repository
     *
     * @returns {Promise} - Create workspace and returns promise which resolves an object representing {@link protos.google.cloud.dataform.v1beta1.Workspace|Workspace}.
    */
    async createWorkspace() {
        const request = {
            parent: this.parent,
            workspaceId: this.workspaceId,
        };
        const [workspace] = await this.client.createWorkspace(request);
        return workspace;
    }

    /**
     * Pull commits from the remote git branch of the workspace. Git username and email are determined by git cli to set The author of any merge commit which may be created as a result of merging fetched Git commits into this workspace..
     *
     * @returns {Promise} - Create workspace and reuturn promise which resolves an object representing {@link protos.google.cloud.dataform.v1beta1.PullGitCommitsResponse|PullGitCommitsResponse}.
    */
    async pullGitCommits(){
        const gitUser = await getGitUserMeta() || {name: "", email: ""};

        if(gitUser && gitUser.name && gitUser.email){
            await this.client.pullGitCommits({ 
                name: this.workspaceName,
                author: {
                    name: gitUser.name,
                    emailAddress: gitUser.email
                },
                remoteBranch: this.workspaceId
            });
        }
    }

    //TODO: can we somehow avoid passing both full and relative paths ?
    async writeFileToWorkspace(fullPath:string, relativePath:string) {
        const data = await fs.readFile(fullPath, 'utf8');
        const request = {
            workspace: this.workspaceName,
            path: relativePath,
            contents: Buffer.from(data),
        };
        await this.client.writeFile(request);
    }

    async fileExistsInWorkspace(relativePath:string) {
        try {
            await this.client.readFile({
                workspace: this.workspaceName,
                path: relativePath
            });
            return true;
        } catch (error: any) {
            const FILE_NOT_FOUND_IN_WORKSPACE_ERROR_CODE = 5;
            if (error.code === FILE_NOT_FOUND_IN_WORKSPACE_ERROR_CODE) { 
                return false;
            }
            throw error;
        }
    }

    async deleteFileInWorkspace(relativePath:string) {
            const request = {
                workspace: this.workspaceName,
                path: relativePath,
            };
            const [removedFileResponse] = await this.client.removeFile(request);
            return removedFileResponse;
    }

    /**
     * create compilation result
     * 
     * @returns {Promise} - The promise which resolves an object representing {{@link protos.google.cloud.dataform.v1beta1.CompilationResult|CompilationResult}}
    */
    async createCompilationResult(compilationType:CompilationType, codeCompilationConfig?:ICodeCompilationConfig){
        let compilationResult: ICompilationResult;
        if(compilationType === "workspace"){
            compilationResult = {
                workspace: this.workspaceName,
                codeCompilationConfig: codeCompilationConfig
            };
        } else {
            compilationResult = {
                gitCommitish: this.gitBranch,
                codeCompilationConfig: codeCompilationConfig
            };
        }

        const createCompilationResultRequest = {
            parent: this.parent,
            compilationResult: compilationResult,
        };

        const [createdCompilationResult] = await this.client.createCompilationResult(createCompilationResultRequest);
        return createdCompilationResult;
    }

    /**
     * Get `git status` of remote Dataform workspace
     * 
     * @returns {Promise} - The promise which resolves an object representing {@link protos.google.cloud.dataform.v1beta1.FetchFileGitStatusesResponse|FetchFileGitStatusesResponse}
    */
    async getRemoteWorkspaceGitState() {
        const request = {
            name: this.workspaceName
        };
        const [remoteWorkspaceGitState] = await this.client.fetchFileGitStatuses(request);
        return remoteWorkspaceGitState
    }

    /**
     * Gets number of commits the Dataform workspace is ahead and behind its remote
     *
     * @returns {Promise} - The promise which resolves to an object representing {@link protos.google.cloud.dataform.v1beta1.FetchGitAheadBehindResponse|FetchGitAheadBehindResponse}.
    */
    async getGitCommitsAheadAndBehind() {
        const request = {
            name: this.workspaceName,
            remoteBranch: this.gitBranch
        };
        const [gitCommitsAheadBehind] = await this.client.fetchGitAheadBehind(request);
        return gitCommitsAheadBehind;
    }

    /**
     * Performs equivalent of `git restore .` on Dataform workspace
     * 
     * @param {boolean} [request.clean]
     *  If set to true, untracked files will be deleted.
     *
     * @returns {Promise} - The promise which resolves to an array. The first element of the array is an object representing {@link protos.google.cloud.dataform.v1beta1.ResetWorkspaceChangesResponse|ResetWorkspaceChangesResponse}
    */
    async resetWorkspaceChanges(clean:boolean){
        // NOTE: similar to `git restore . `
        const request = {
            name: this.workspaceName,
            clean: clean
        };
        await this.client.resetWorkspaceChanges(request);
    }


    /**
     * Pushes commits in Dataform worksapce to remote git repository. Creates remote repository if it does not exsists
     *
     * @returns {Promise} - The promise which resolves to an array. The first element of the array is an object representing {@link protos.google.cloud.dataform.v1beta1.PushGitCommitsResponse|PushGitCommitsResponse}
    */
    async pushWorkspaceCommits(){
        const request = {
            name: this.workspaceName,
            remoteBranch: this.gitBranch
        };
        await this.client.pushGitCommits(request);
    }

    async createDataformWorkflowInvocation(invocationConfig: InvocationConfig, compilationResultName:string){
        const workflowInvocation = {
            compilationResult: compilationResultName,
            invocationConfig: invocationConfig
        };

        const createWorkflowInvocationRequest = {
            parent: this.parent,
            workflowInvocation: workflowInvocation,
        };

        // NOTE: I think we are making an assumption here that only one workflow invocation is being made by this call
        const createdWorkflowInvocation = await this.client.createWorkflowInvocation(createWorkflowInvocationRequest);
        const createdWorkflowInvocationName = createdWorkflowInvocation[0]?.name;

        let workflowInvocationUrlGCP = undefined;
        let workflowInvocationId = undefined;

        if(createdWorkflowInvocationName){
            const workflowInvocationId = createdWorkflowInvocationName.split("/").pop();
            if(workflowInvocationId){
            workflowInvocationUrlGCP = this.getWorkflowInvocationUrl(workflowInvocationId);
            }
        }
        return {name: createdWorkflowInvocationName, url: workflowInvocationUrlGCP, id: workflowInvocationId};
    }

    async runDataformRemotely(invocationConfig: InvocationConfig, compilationType:CompilationType, codeCompilationConfig?:ICodeCompilationConfig){
        const compilationResult = await this.createCompilationResult(compilationType, codeCompilationConfig);
        const fullCompilationResultName = compilationResult.name;
        if(fullCompilationResultName){
            return await this.createDataformWorkflowInvocation(invocationConfig, fullCompilationResultName);
        }
        return undefined;
    }
}