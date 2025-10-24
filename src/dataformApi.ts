
import { DataformClient  } from '@google-cloud/dataform';
import * as fs from 'fs/promises'; 
import {getGitUserMeta, getGitBranchAndRepoName} from "./getGitMeta";
import {CompilationType, CreateCompilationResultResponse, InvocationConfig, ICompilationResult, ICodeCompilationConfig, DataformApiOptions} from "./types";

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

    async getWorkspace() {
        const request = {
            name: this.workspaceName
        };
        const workspace = await this.client.getWorkspace(request);
        return workspace;
    }

    async getRepository() {
        const request = {
            name: this.parent
        };
        const repository = await this.client.getRepository(request);
        return repository;
    }

    async createWorkspace() {
        const request = {
            parent: this.parent,
            workspaceId: this.workspaceId,
        };
        const [workspace] = await this.client.createWorkspace(request);
        return workspace;
    }

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
            await this.client.removeFile(request);
    }

    async createCompilationResult(compilationType:CompilationType, codeCompilationConfig?:ICodeCompilationConfig): CreateCompilationResultResponse{
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

        const createdCompilationResult = await this.client.createCompilationResult(createCompilationResultRequest);
        return createdCompilationResult;
    }

    async  getRemoteWorkspaceGitState() {
        const request = {
            name: this.workspaceName
        };
        return await this.client.fetchFileGitStatuses(request);
    }

    async getGitCommitsAheadAndBehind() {
        const request = {
            name: this.workspaceName,
            remoteBranch: this.gitBranch
        };
        return await this.client.fetchGitAheadBehind(request);
    }


    async resetWorkspaceChanges(clean:boolean){
        // NOTE: similar to `git restore . `
        const request = {
            name: this.workspaceName,
            clean: clean
        };
        await this.client.resetWorkspaceChanges(request);
    }

    async pushWorkspaceCommits(){
        const request = {
            name: this.workspaceName,
            remoteBranch: this.gitBranch
        };
        await this.client.pushGitCommits(request);
    }

    async createDataformWorkflowInvocation(invocationConfig: InvocationConfig, compilationResultName:string){
        /*
        const out = await obj.createCompilationResult();
        // NOTE: I think we are making an assumption here that only one compilation result invocation is being made by previous function call
        const compilationResultName = out[0].name;
        */
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
        //FIXME: pass the codeCompilationConfig dynamically
        const compilationResult = await this.createCompilationResult(compilationType, codeCompilationConfig);
        const fullCompilationResultName = compilationResult[0].name;
        if(fullCompilationResultName){
            return await this.createDataformWorkflowInvocation(invocationConfig, fullCompilationResultName);
        }
        return undefined;
    }
}