import type { WorkflowAction } from '../types';
import type { BigQueryJobMetadata } from './cliRunJobs';

/*
 * The BigQuery jobs of a `dbt build` sent to the terminal, so that a dbt run has the table of jobs a Dataform run has.
 * dbt cannot be told how to name its jobs, so a run's jobs are found by what dbt itself puts on them: both engines
 * label every job with the ID of the invocation (`dbt_invocation_id`), and open its query with a comment that names
 * the node it is for. The ID is read from dbt's log, where it is written when the run starts, and how the run ended
 * from `run_results.json`. Found against dbt-core 1.12.5 and dbt v2 2.0.6. No `vscode` import: the host's part is
 * src/cliRunJobs.ts.
 */

/** The label both engines put on every BigQuery job of an invocation */
export const INVOCATION_LABEL = 'dbt_invocation_id';
/** With no invocation in dbt's log for this long after a run was sent, `run_results.json` is asked instead */
export const HEADER_WAIT_MS = 15_000;

// dbt-core: "============================== 15:51:48.981236 | 2636e9ed-… ==============================".
// dbt v2: "==================== 2026-10-12T14:44:19.684293Z | 01a13092-… ===================="
const HEADER = /^={5,} [^|\n]+ \| ([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}) ={5,}\s*$/gm;

/** The IDs of the invocations whose starts are in `log`, a part of dbt's `dbt.log`, oldest first */
export function invocationsStarted(log: string): string[] {
    return [...log.matchAll(HEADER)].map((match) => match[1]);
}

/** The start of an invocation in `log`: its ID, and where the lines of the invocation begin. Undefined when the log has none */
export function firstInvocation(log: string): { id: string; after: number } | undefined {
    const match = new RegExp(HEADER.source, 'm').exec(log);
    return match ? { id: match[1], after: match.index + match[0].length } : undefined;
}

/**
 * What a line of dbt's log tells of a node: that dbt began on it, or how it ended. dbt may be long at a node before it
 * sends BigQuery a query, and a node may send none, so the log tells of a run what its jobs do not. dbt v2 names a
 * node by its relation ("analytics.orders"), dbt-core by its ID ("model.shop.orders"), and does not say in that line
 * how it ended: `ended` is then left to the node's jobs and to `run_results.json`.
 */
export interface NodeEvent { relation?: string; nodeId?: string; state: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'ENDED' }

const V2_STARTED = /\]: Started running [a-z_ ]+? (\S+)\s*$/;
const V2_FINISHED = /\]: Finished running \[[^\]]*\] [a-z_ ]+? (\S+) \[([a-z_ -]+)\]\s*$/;
const V2_SKIPPED = /\]:\s+Skipped [a-z_ ]+? (\S+) /;
const CORE_BEGAN = /\]: Began running node (\S+)\s*$/;
const CORE_FINISHED = /\]: Finished running node (\S+)\s*$/;

/** The events of nodes in `lines`, whole lines of dbt's log, in order */
export function nodeEvents(lines: string): NodeEvent[] {
    const events: NodeEvent[] = [];
    for (const line of lines.split('\n')) {
        if (!line.includes('unning') && !line.includes('Skipped')) {
            continue;
        }
        let match: RegExpExecArray | null;
        if ((match = V2_STARTED.exec(line))) {
            events.push({ relation: match[1], state: 'RUNNING' });
        } else if ((match = V2_FINISHED.exec(line))) {
            events.push({ relation: match[1], state: stateOf(match[2]) as NodeEvent['state'] });
        } else if ((match = V2_SKIPPED.exec(line))) {
            events.push({ relation: match[1], state: 'SKIPPED' });
        } else if ((match = CORE_BEGAN.exec(line))) {
            events.push({ nodeId: match[1], state: 'RUNNING' });
        } else if ((match = CORE_FINISHED.exec(line))) {
            events.push({ nodeId: match[1], state: 'ENDED' });
        }
    }
    return events;
}

/** A node the log told of: how it stands, and when dbt was first seen to be on it (epoch ms) */
export interface NodeProgress { state: string; since: number }

/**
 * The rows of a run that is going, with a row for each node dbt is on, or has ended, that no job was found for:
 * a node dbt is still preparing, or one that needs no query. `nodes` is by the name a row for the node has.
 */
export function withNodeProgress(jobRows: WorkflowAction[], nodes: Map<string, NodeProgress>): WorkflowAction[] {
    const named = new Set(jobRows.map((row) => row.target));
    const rows = [...jobRows];
    for (const [target, { state, since }] of nodes) {
        if (!named.has(target) && state !== 'ENDED') {
            rows.push({ target, state, ...(state === 'RUNNING' ? { startTime: since } : {}) });
        }
    }
    return rows;
}

/** Where dbt writes `dbt.log` and `run_results.json` for a run from `root`: as its environment says, else in the Project */
export function dbtRunFiles(root: string, env: Record<string, string | undefined>, resolve: (...parts: string[]) => string): { log: string; results: string } {
    return {
        log: resolve(root, env.DBT_LOG_PATH?.trim() || 'logs', 'dbt.log'),
        results: resolve(root, env.DBT_TARGET_PATH?.trim() || 'target', 'run_results.json'),
    };
}

/** Whether a job is of the invocation */
export function ofInvocation(invocationId: string): (job: BigQueryJobMetadata) => boolean {
    return (job) => job.configuration?.labels?.[INVOCATION_LABEL] === invocationId;
}

const QUERY_COMMENT = /^\s*\/\*\s*(\{[\s\S]*?\})\s*\*\//;

/** The node a query is for, as dbt's comment at its start says: "model.shop.orders". Undefined where a Project has turned the comment off or changed it */
export function nodeOfQuery(query: string | undefined): string | undefined {
    const comment = QUERY_COMMENT.exec(query ?? '')?.[1];
    if (!comment) {
        return undefined;
    }
    try {
        const said: unknown = JSON.parse(comment);
        const node = (said as { node_id?: unknown } | null)?.node_id;
        return typeof node === 'string' && node ? node : undefined;
    } catch {
        return undefined;
    }
}

/** An action of the Project as a node is matched to it: what dbt calls it, and what a row for it is named */
export interface NamedNode { package: string; name: string; version?: string; target: string }

/**
 * Names a node for its row: after the action it is, of `nodes`, else by its own name. A node's ID is its type, its
 * package and its name, then the version of a versioned model or the hash of a generic test.
 */
export function nodeNamer(nodes: NamedNode[]): (nodeId: string) => string {
    const byName = new Map<string, string>();
    for (const node of nodes) {
        const key = `${node.package}.${node.name}`;
        byName.set(node.version ? `${key}.v${node.version}` : key, node.target);
    }
    return (nodeId) => {
        const [, pack, name, ...rest] = nodeId.split('.');
        if (!pack || !name) {
            return nodeId;
        }
        return byName.get(`${pack}.${name}.${rest.join('.')}`) ?? byName.get(`${pack}.${name}`) ?? name;
    };
}

/**
 * Names the job of a dbt run: after the node its query's comment names, else as `otherwise` does, which is given the
 * job where the comment is not there.
 */
export function dbtJobNamer(nameOfNode: (nodeId: string) => string, otherwise: (job: BigQueryJobMetadata) => string | undefined): (job: BigQueryJobMetadata) => string | undefined {
    return (job) => {
        const node = nodeOfQuery(job.configuration?.query?.query);
        return node ? nameOfNode(node) : otherwise(job);
    };
}

/** How one node ended, as `run_results.json` says */
export interface DbtNodeResult {
    nodeId: string;
    /** dbt's own word: success, pass, warn, error, fail, skipped, no-op and others */
    status: string;
    message?: string;
    /** The last BigQuery job the node ran, where the adapter said */
    jobId?: string;
    projectId?: string;
}

export interface DbtRunResults {
    invocationId: string;
    /** Epoch ms. NaN when the file does not say */
    generatedAt: number;
    nodes: DbtNodeResult[];
}

const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

/** What a `run_results.json` says. Undefined when the text is not one */
export function readRunResults(json: string): DbtRunResults | undefined {
    let parsed: { metadata?: { invocation_id?: unknown; generated_at?: unknown }; results?: unknown };
    try {
        parsed = JSON.parse(json);
    } catch {
        return undefined;
    }
    const invocationId = text(parsed?.metadata?.invocation_id);
    if (!invocationId || !Array.isArray(parsed.results)) {
        return undefined;
    }
    const nodes: DbtNodeResult[] = [];
    for (const result of parsed.results as Array<{ unique_id?: unknown; status?: unknown; message?: unknown; adapter_response?: { job_id?: unknown; project_id?: unknown } | null }>) {
        const nodeId = text(result?.unique_id);
        if (nodeId) {
            nodes.push({ nodeId, status: text(result.status) ?? 'unknown', message: text(result.message), jobId: text(result.adapter_response?.job_id), projectId: text(result.adapter_response?.project_id) });
        }
    }
    return { invocationId, generatedAt: Date.parse(text(parsed.metadata?.generated_at) ?? ''), nodes };
}

/** The state of a row for a node dbt gave this status. A test that fails has a job that succeeded, so the node tells */
function stateOf(status: string): string {
    switch (status.toLowerCase()) {
        case 'success':
        case 'pass':
        case 'warn':
            return 'SUCCEEDED';
        case 'error':
        case 'fail':
        case 'runtime error':
        case 'partial success':
            return 'FAILED';
        default:
            return 'SKIPPED';
    }
}

/** The ID of a job without its project and location, which a row's has in front: "proj:EU.id" */
function bareJobId(jobId: string): string {
    return jobId.replace(/^[^:]+:[^.]+\./, '');
}

/**
 * The rows of a run that has ended, with what `run_results.json` says of its nodes: a node that failed has its row
 * failed with dbt's reason, though its job succeeded, as a test's does; and a node that ran no job that was found, as
 * one dbt skipped, is given a row. A node's row is the one of its last job, else the last named as it is.
 */
export function withNodeResults(rows: WorkflowAction[], results: DbtRunResults, nameOfNode: (nodeId: string) => string): WorkflowAction[] {
    const next = rows.map((row) => ({ ...row }));
    for (const node of results.nodes) {
        const state = stateOf(node.status);
        const name = nameOfNode(node.nodeId);
        const row = (node.jobId ? next.find((each) => each.jobId && bareJobId(each.jobId) === node.jobId) : undefined)
            ?? next.filter((each) => each.target === name).pop();
        if (!row) {
            next.push({ target: name, state, ...(state === 'FAILED' && node.message ? { failureReason: node.message } : {}) });
        } else if (state === 'FAILED' && row.state === 'SUCCEEDED') {
            row.state = 'FAILED';
            row.failureReason = node.message ?? row.failureReason;
        }
    }
    return next;
}
