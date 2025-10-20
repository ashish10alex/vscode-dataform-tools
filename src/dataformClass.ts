
import { DataformClient  } from '@google-cloud/dataform';
import * as fs from 'fs/promises'; 
import { protos } from '@google-cloud/dataform';
import {getLocalGitState, getGitStatusCommitedFiles, getGitUserMeta, getGitBranchAndRepoName} from "./getGitMeta";

type CreateCompilationResultResponse = Promise<
[
    protos.google.cloud.dataform.v1beta1.ICompilationResult,
    protos.google.cloud.dataform.v1beta1.ICreateCompilationResultRequest | undefined,
    {} | undefined
]
>;

type InvocationConfig = protos.google.cloud.dataform.v1beta1.IInvocationConfig;

class DataformApi {

    gcpProjectId:string;
    gcpProjectLocation:string;
    workspaceId:string;
    workspaceName:string;
    parent:string;
    client: DataformClient;
    gitRepoName:string;
    repositoryName:string;
    gitBranch:string;

    constructor (gcpProjectId:string, gcpLocation:string, workspaceId:string, options?:any){
        this.gcpProjectId = gcpProjectId;
        this.gcpProjectLocation = gcpLocation;
        this.workspaceId = workspaceId;
        ({ gitRepoName: this.gitRepoName, gitBranch: this.gitBranch } = getGitBranchAndRepoName() || {});
        this.repositoryName = this.gitRepoName;
        this.client = new DataformClient(options);
        this.parent =  `projects/${this.gcpProjectId}/locations/${this.gcpProjectLocation}/repositories/${this.repositoryName}`;
        this.workspaceName = `projects/${this.gcpProjectId}/locations/${this.gcpProjectLocation}/repositories/${this.repositoryName}/workspaces/${this.workspaceId}`;
    }

    getWorkflowInvocationUrl(workflowInvocationId:string) {
        return `https://console.cloud.google.com/bigquery/dataform/locations/${this.gcpProjectLocation}/repositories/${this.repositoryName}/workflows/${workflowInvocationId}?project=${this.gcpProjectId}`;
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
            const ERROR_CODE_FILE_NOT_FOUND = 5;
            if (error.code === ERROR_CODE_FILE_NOT_FOUND) { 
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


    async getCompilationResult(): CreateCompilationResultResponse{
        const compilationResult = {
            gitCommitish: this.gitBranch,
        };

        const createCompilationResultRequest = {
            parent: this.parent,
            compilationResult: compilationResult,
        };

        const createdCompilationResult = await this.client.createCompilationResult(createCompilationResultRequest);
        return createdCompilationResult;
    }


}