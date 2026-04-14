import fs from "fs";
import path from 'path';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import util from 'util';
import { GitFileChange, GitFileChangeRaw, GitStatusCode, GitStatusCodeHumanReadable } from './types';
import { logger } from "./logger";

const execPromise = util.promisify(exec);

export class GitService {
    private projectRoot: string;

    constructor() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
            throw new Error("No workspace folder open.");
        }
        this.projectRoot = workspaceFolders ? workspaceFolders[0].uri.fsPath : "";
    }

    private async execCmd(command: string): Promise<string> {
        if (!this.projectRoot) {
            throw new Error("No project root found (no workspace open).");
        }

        try {
            const { stdout } = await execPromise(command, { cwd: this.projectRoot });
            return stdout.trim();
        } catch (error: any) {
            throw error;
        }
    }

    public async getGitBranchAndRepoName() {
        try {
            // git rev-parse --abbrev-ref HEAD works correctly in worktrees
            const gitBranch = await this.execCmd('git rev-parse --abbrev-ref HEAD') || undefined;

            const overrideRepoName = vscode.workspace
                .getConfiguration('vscode-dataform-tools')
                .get<string>('gitRepoName')
                ?.trim();
            if (overrideRepoName) {
                logger.info(`Git branch: ${gitBranch}`);
                logger.info(`Git repo name (override): ${overrideRepoName}`);
                return { gitBranch, gitRepoName: overrideRepoName };
            }

            let gitRepoName: string | undefined;
            try {
                const remoteUrl = await this.execCmd('git config --get remote.origin.url');
                if (remoteUrl) {
                    const match = remoteUrl.trim().match(/([^\/:]+?)(?:\.git)?$/);
                    if (match) {
                        gitRepoName = match[1];
                    }
                }
            } catch (e:any) {
                vscode.window.showErrorMessage(e.message);
            }

            if (!gitRepoName) {
                try {
                    // git rev-parse --git-common-dir returns the main repo's .git dir.
                    const gitCommonDir = await this.execCmd('git rev-parse --git-common-dir');
                    const absoluteGitCommonDir = path.resolve(this.projectRoot, gitCommonDir);
                    const mainRepoPath = path.resolve(absoluteGitCommonDir, '..');
                    gitRepoName = path.basename(mainRepoPath);
                } catch (e) {
                    gitRepoName = path.basename(this.projectRoot);
                }
            }

            logger.info(`Git branch: ${gitBranch}`);
            logger.info(`Git repo name: ${gitRepoName}`);

            return { gitBranch, gitRepoName };
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error getting git info: ${error.message}`);
            return undefined;
        }
    }

    public async triggerGitPull(gitBranchName: string): Promise<void> {
        try {
            await this.execCmd(`git branch --set-upstream-to=origin/${gitBranchName}`);
            await this.execCmd('git pull');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error running git pull: ${error.message}`);
            throw error;
        }
    }

    public async getLocalGitState(): Promise<GitFileChange[]> {
        try {
            const stdout = await this.execCmd('git status --porcelain');
            
            const files = stdout.split('\n')
                .filter(line => line.trim())
                .map(line => {
                    const [status, filePath] = line.trim().split(/\s+/);
                    return { status: status as GitStatusCode, filePath: filePath.replace(/\\/g, '/') };
                });

            let output : GitFileChange[] = [];
            const rootFiles = ["dataform.json", "workflow_settings.yaml"];
            const fileExtensionsToSync = ['.sqlx', '.js', '.ipynb'];
            files.forEach((file) =>{
                const isRootFile = rootFiles.includes(file.filePath);
                if(fileExtensionsToSync.some(ext => file.filePath.endsWith(ext)) || isRootFile){
                    output.push({
                        state: this.gitStatusToHumanReadable(file.status), 
                        path: file.filePath,
                        fullPath: path.join(this.projectRoot, file.filePath),
                        commitIndex: 0
                    });
                }

                if(fs.existsSync(path.join(this.projectRoot, file.filePath)) && fs.lstatSync(path.join(this.projectRoot, file.filePath)).isDirectory()){
                    const dirFiles = fs.readdirSync(path.join(this.projectRoot, file.filePath));
                    dirFiles.forEach((dirFile) =>{
                        if(fileExtensionsToSync.some(ext => dirFile.endsWith(ext))){
                            output.push({
                                state: this.gitStatusToHumanReadable(file.status),
                                path: path.posix.join(file.filePath, dirFile),
                                fullPath: path.join(this.projectRoot, file.filePath, dirFile),
                                commitIndex: 0
                            });
                        }
                    });
                }
            });

            return output;
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error running git status: ${error.message}`);
            throw error;
        }
    }

    public async getGitStatusCommitedFiles(gitBranchName: string): Promise<GitFileChange[]> {
        const gitCommand = `git show --name-status --pretty="format:commit_hash: %H" origin/${gitBranchName}..HEAD`;

        try {
            const stdout = await this.execCmd(gitCommand);
            const lines = stdout.split("\n").filter(line => line.trim());
            
            const committedFiles: GitFileChangeRaw[] = [];
            let currentCommitIndex = 1;

            for (const line of lines) {
                if (line.startsWith("commit_hash:")) {
                    continue;
                }
                const [status, filePath] = line.trim().split(/\s+/);
                committedFiles.push({
                    state: status as GitStatusCode,
                    path: filePath.replace(/\\/g, '/'),
                    commitIndex: currentCommitIndex
                });
                currentCommitIndex += 1;
            }

            return committedFiles.filter((file) =>
                (file.path.endsWith('.sqlx') || file.path.endsWith('.js'))
            ).map((file) => ({
                state: this.gitStatusToHumanReadable(file.state as GitStatusCode),
                path: file.path,
                fullPath: path.join(this.projectRoot, file.path),
                commitIndex: file.commitIndex
            }));

        } catch (error: any) {
            vscode.window.showErrorMessage(`Error running git status: ${error.message}`);
            throw error;
        }
    }

    public async getGitUserMeta(): Promise<{ name: string | undefined, email: string | undefined } | undefined> {
        try {
            const stdout = await this.execCmd('git config --get-regexp "^user\.(name|email)$"');
            const lines = stdout.split("\n");
            
            let name = "";
            let email = "";

            for (const line of lines) {
                if (line.startsWith("user.name")) {
                    name = line.split(" ")[1];
                }
                if (line.startsWith("user.email")) {
                    email = line.split(" ")[1];
                }
            }
            return { name, email };
        } catch (error: any) {
            vscode.window.showErrorMessage(`${error.message}`);
            return undefined;
        }
    }

    public async gitRemoteBranchExsists(gitBranchName: string): Promise<boolean> {
        try {
            const stdout = await this.execCmd("git branch -r");
            const lines = stdout.split("\n");
            
            for (const line of lines) {
                if (line.trim() === `origin/${gitBranchName}`) {
                    return true;
                }
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    public async localBranchBehindRemote(gitBranchName: string): Promise<boolean> {
        // FIXME: Assumes remote name is 'origin'
        const gitCommand = `git diff --name-only ${gitBranchName} origin/${gitBranchName}`;
        
        try {
            const stdout = await this.execCmd(gitCommand);
            const lines = stdout.split("\n");
            return lines.length > 0 && lines[0] !== "";
        } catch (error) {
            return false;
        }
    }

    private gitStatusToHumanReadable(statusCode: GitStatusCode): GitStatusCodeHumanReadable {
        switch (statusCode) {
            case "M": return "MODIFIED";
            case "A": return "ADDED";
            case "??": return "ADDED";
            case "D": return "DELETED";
            default: return "MODIFIED"; 
        }
    }
}