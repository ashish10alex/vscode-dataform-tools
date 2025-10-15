import path from 'path';
import * as vscode from 'vscode';
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

export async function getGitBranchAndRepoName() {
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
  const gitRepoName = repo.state.remotes[0].fetchUrl.split("/").pop().split(".")[0];

  return { gitBranch, gitRepoName };
}

function gitStatusToHumanReadable(statusCode:string){
    switch (statusCode) {
        case "M":
            return "MODIFIED";
        case "??":
            return "ADDED";
        case "D":
            return "DELETED";
        default:
            return statusCode;
    }
}

export async function getGitStatusFiles() {
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
        // Filter for .sqlx files in definitions/
        return files.filter((file:any) => 
            (file.filePath.endsWith('.sqlx') || file.filePath.endsWith('.js'))
        ).map((file:any) => ({
            state: gitStatusToHumanReadable(file.status),
            path: file.filePath,
            fullPath: path.join(projectRoot, file.filePath)
        }));
    } catch (error:any) {
        console.error('Error running git status:', error);
        vscode.window.showErrorMessage(`Error running git status: ${error.message}`);
        throw error;
    }
}
