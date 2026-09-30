import { execFile } from 'child_process';
import util from 'util';
import { logger } from './logger';
import { ApiRunGitState, DATAFORM_PROJECT_PATHSPECS, parseNameStatusZ, parseStatusPorcelainZ } from './shared/apiRunGitState';

const execFilePromise = util.promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFilePromise('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
}

async function tryGit(cwd: string, args: string[]): Promise<string | undefined> {
    try {
        return (await git(cwd, args)).trim();
    } catch {
        return undefined;
    }
}

/**
 * The ref a Dataform API run uses: the branch's upstream, else `origin/<branch>` for a branch pushed
 * without setting one. Only reads refs as last fetched.
 */
async function resolveUpstream(cwd: string, branch: string): Promise<string | undefined> {
    const upstream = await tryGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    if (upstream) {
        return upstream;
    }
    return (await tryGit(cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`])) ? `origin/${branch}` : undefined;
}

/** What a Dataform API run of `workspaceFolder`'s current branch would leave out. */
export async function computeApiRunGitState(workspaceFolder: string): Promise<ApiRunGitState> {
    const prefix = await tryGit(workspaceFolder, ['rev-parse', '--show-prefix']);
    if (prefix === undefined) {
        return { kind: 'unavailable' };
    }
    const branch = await tryGit(workspaceFolder, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (!branch) {
        return { kind: 'noUpstream' };
    }
    const upstream = await resolveUpstream(workspaceFolder, branch);
    if (!upstream) {
        return { kind: 'noUpstream', branch };
    }

    try {
        const pathspecs = ['--', ...DATAFORM_PROJECT_PATHSPECS];
        const [status, diff, aheadCount, behindCount] = await Promise.all([
            git(workspaceFolder, ['status', '--porcelain', '-z', '--no-renames', '--untracked-files=all', ...pathspecs]),
            git(workspaceFolder, ['diff', '--name-status', '-z', '--no-renames', '--relative', `${upstream}...HEAD`, ...pathspecs]),
            git(workspaceFolder, ['rev-list', '--count', `${upstream}..HEAD`, ...pathspecs]),
            git(workspaceFolder, ['rev-list', '--count', `HEAD..${upstream}`]),
        ]);
        return {
            kind: 'tracking',
            branch,
            upstream,
            uncommitted: parseStatusPorcelainZ(status, prefix),
            unpushedFiles: parseNameStatusZ(diff),
            unpushedCommits: Number(aheadCount.trim()) || 0,
            behind: Number(behindCount.trim()) || 0,
        };
    } catch (error) {
        logger.debug(`Could not determine what a Dataform API run leaves out: ${error}`);
        return { kind: 'unavailable' };
    }
}
