import fs from "fs";
import path from 'path';
import * as vscode from 'vscode';
import { GitFileChange, GitFileChangeRaw, GitStatusCode, GitStatusCodeHumanReadable } from './types';
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

export function getGitBranchAndRepoName() {
  const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
  if (!gitExtension) {
    vscode.window.showErrorMessage('Git extension not found.');
    return;
  }

  // Activate the Git extension if not already activated
  const git = gitExtension.getAPI(1);
  if (!git.repositories.length) {
    vscode.window.showErrorMessage('No Git repositories found.');
    return;
  }

  const repo = git.repositories[0];
  const gitBranch = repo.state.HEAD?.name ?? 'No branch';
  const gitRepoName = getActualRepoName(repo.rootUri.fsPath);

  return { gitBranch, gitRepoName };
}

function gitStatusToHumanReadable(statusCode: GitStatusCode): GitStatusCodeHumanReadable{
    switch (statusCode) {
        case "M":
            return "MODIFIED";
        case "A":
            return "ADDED";
        case "??":
            return "ADDED";
        case "D":
            return "DELETED";
    }
}

export async function getLocalGitState(): Promise<GitFileChange[]> {
    let workspaceFolders = vscode.workspace?.workspaceFolders;
    let projectRoot = "";
    if(workspaceFolders){
        projectRoot = workspaceFolders[0].uri?.fsPath;
    }
    try {
        const { stdout } = await execPromise('git status --porcelain', { cwd: projectRoot });
        const files = stdout.split('\n').filter((line:any) => line.trim()).map((line:any) => {
            const [status, filePath] = line.trim().split(/\s+/);
            return { status, filePath: filePath.replace(/\\/g, '/') };
        });
        return files.filter((file:any) => 
        ['.sqlx', '.js', '.json', '.yaml'].some(ext => file.filePath.endsWith(ext))
        ).map((file:any) => ({
            state: gitStatusToHumanReadable(file.status),
            path: file.filePath,
            fullPath: path.join(projectRoot, file.filePath),
            commitIndex: 0 // used to know this is the latest status of the file when comparing with already commited changes locally
        }));
    } catch (error:any) {
        console.error('Error running git status:', error);
        vscode.window.showErrorMessage(`Error running git status: ${error.message}`);
        throw error;
    }
}


export async function getGitStatusCommitedFiles(gitBranchName: string): Promise<GitFileChange[]> {
    const gitCommand = `git show --name-status --pretty="format:commit_hash: %H" origin/${gitBranchName}..HEAD`;
    let workspaceFolders = vscode.workspace?.workspaceFolders;
    let projectRoot = "";
    if(workspaceFolders){
        projectRoot = workspaceFolders[0].uri?.fsPath;
    }
    try {
        const { stdout } = await execPromise(gitCommand, { cwd: projectRoot });
        const lines = stdout.split("\n").filter((line:string) => line.trim());
        const committedFiles: GitFileChangeRaw[] = [];
        let currentCommitIndex = 1; // Start with 1 for the most recent commit
        for (const line of lines) {
            if(line.startsWith("commit_hash:")){
                continue;
            }
            const [status, filePath] = line.trim().split(/\s+/);
            committedFiles.push({
                 state: status,
                 path: filePath.replace(/\\/g, '/') ,
                 commitIndex: currentCommitIndex
            }); 
            currentCommitIndex+=1;
        }
        return committedFiles.filter((file:GitFileChangeRaw) => 
            (file.path.endsWith('.sqlx') || file.path.endsWith('.js'))
        ).map((file:GitFileChangeRaw) => ({
            state: gitStatusToHumanReadable(file.state),
            path: file.path,
            fullPath: path.join(projectRoot, file.path),
            commitIndex: file.commitIndex
        }));
    } catch (error:any) {
        console.error('Error running git status:', error);
        vscode.window.showErrorMessage(`Error running git status: ${error.message}`);
        throw error;
    }
}


export async function getGitUserMeta(): Promise<{name: string | undefined, email: string | undefined}  | undefined> {
    let workspaceFolders = vscode.workspace?.workspaceFolders;
    let projectRoot = "";
    if(workspaceFolders){
        projectRoot = workspaceFolders[0].uri?.fsPath;
    }
    try {
        const { stdout } = await execPromise('git config --get-regexp "^user\.(name|email)$"', { cwd: projectRoot });
        const lines = stdout.trim("").split("\n");
        let name = "";
        let email = "";
        for (const line of lines) {
            if(line.startsWith("user.name")){
                name = line.split(" ")[1];
            }
            if(line.startsWith("user.email")){
                email = line.split(" ")[1];
            }
        }
        return {
                name:  name, email: email
        };
    } catch(error:any){
        console.error('Error getting git user metadata:', error);
        vscode.window.showErrorMessage(`${error.message}`);
        return undefined;
    }
}

export async function gitRemoteBranchExsists(gitBranchName:string): Promise<boolean> {
    const gitCommand = "git branch -r";
    let workspaceFolders = vscode.workspace?.workspaceFolders;
    let projectRoot = "";
    if(workspaceFolders){
        projectRoot = workspaceFolders[0].uri?.fsPath;
    }

    const { stdout } = await execPromise(gitCommand, { cwd: projectRoot });
    const lines = stdout.trim("").split("\n");
    for (const line of lines) {
        if(line.trim("") === `origin/${gitBranchName}`){
            return true;
        }
    }
    return false;
}

function getActualRepoName(repoPath: string): string {
  try {
    const gitDirPath = path.join(repoPath, '.git');
    
    // Check if .git is a file (worktree) or directory (main repo)
    if (fs.existsSync(gitDirPath)) {
      const stats = fs.statSync(gitDirPath);
      
      if (stats.isFile()) {
        const gitFileContent = fs.readFileSync(gitDirPath, 'utf8');
        const match = gitFileContent.match(/gitdir:\s*(.+)/);
        
        if (match) {
          const worktreeGitDir = match[1].trim();
          
          const mainRepoGitDir = worktreeGitDir.split(path.sep)
            .slice(0, -2) // Remove 'worktrees' and branch name
            .join(path.sep);
          
          const mainRepoPath = path.dirname(mainRepoGitDir);
          return path.basename(mainRepoPath);
        }
      }
    }
    
    // If not a worktree or couldn't parse, fall back to current directory name
    return path.basename(repoPath);
  } catch (error) {
    console.error('Error getting repository name:', error);
    return path.basename(repoPath);
  }
}