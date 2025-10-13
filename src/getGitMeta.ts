import * as vscode from 'vscode';

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
