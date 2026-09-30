import * as vscode from 'vscode';
import type { API, GitExtension, Repository } from './api/git';
import { logger } from './logger';

/*
 * Notices when the checked-out branch or commit changes (checkout, commit, pull, rebase, reset), which
 * VS Code does not report as a file save, so views built from the previous compilation can refresh.
 * Also notices any repository state change, such as a push, for views that show the git state itself.
 * Uses the built-in git extension; when it is disabled nothing is watched.
 */

const DEBOUNCE_MS = 500;

/** HEAD as a comparable key: a branch switch changes the name, a commit/pull/reset changes the commit. */
export function headKey(repository: Pick<Repository, 'state'>): string {
    const head = repository.state.HEAD;
    return `${head?.name ?? ''}@${head?.commit ?? ''}`;
}

/** Calls `onChange` with the repository root after its HEAD settles on a new branch or commit. */
export function watchGitHead(context: vscode.ExtensionContext, onChange: (repositoryRoot: string) => void) {
    forEachGitRepository(context, (repository) => {
        let lastKey = headKey(repository);
        let timer: ReturnType<typeof setTimeout> | undefined;
        context.subscriptions.push(
            repository.state.onDidChange(() => {
                // Fires for every status change; only HEAD moving matters. Mid-rebase HEAD moves per commit.
                if (repository.state.rebaseCommit || headKey(repository) === lastKey) {
                    return;
                }
                clearTimeout(timer);
                timer = setTimeout(() => {
                    const key = headKey(repository);
                    if (key === lastKey || repository.state.rebaseCommit) {
                        return;
                    }
                    logger.debug(`Git HEAD changed in ${repository.rootUri.fsPath}: ${lastKey} -> ${key}`);
                    lastKey = key;
                    onChange(repository.rootUri.fsPath);
                }, DEBOUNCE_MS);
            }),
            { dispose: () => clearTimeout(timer) },
        );
    });
}

/**
 * Calls `onChange` with the repository root once its state settles after any change the git extension
 * notices: edits in the working tree, staging, commits, checkouts, pushes and fetches.
 */
export function watchGitState(context: vscode.ExtensionContext, onChange: (repositoryRoot: string) => void) {
    forEachGitRepository(context, (repository) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        context.subscriptions.push(
            repository.state.onDidChange(() => {
                clearTimeout(timer);
                timer = setTimeout(() => onChange(repository.rootUri.fsPath), DEBOUNCE_MS);
            }),
            { dispose: () => clearTimeout(timer) },
        );
    });
}

/** Calls `watch` once for every repository the built-in git extension opens; when it is disabled nothing is watched. */
function forEachGitRepository(context: vscode.ExtensionContext, watch: (repository: Repository) => void) {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
        return;
    }

    const watched = new Set<Repository>();
    const watchOnce = (repository: Repository) => {
        if (!watched.has(repository)) {
            watched.add(repository);
            watch(repository);
        }
    };

    const start = (api: API) => {
        api.repositories.forEach(watchOnce);
        context.subscriptions.push(api.onDidOpenRepository(watchOnce));
    };

    const init = async () => {
        try {
            const git = extension.isActive ? extension.exports : await extension.activate();
            if (git.enabled) {
                start(git.getAPI(1));
                return;
            }
            const enablement = git.onDidChangeEnablement((enabled) => {
                if (enabled) {
                    enablement.dispose();
                    start(git.getAPI(1));
                }
            });
            context.subscriptions.push(enablement);
        } catch (error) {
            logger.debug(`Git watcher unavailable: ${error}`);
        }
    };
    void init();
}
