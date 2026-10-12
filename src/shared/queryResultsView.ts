import { formatDuration } from './jobTiming';

/*
 * What the query results view shows of a finished BigQuery job, shared by the extension and the webview
 * (no `vscode` import).
 */

/** The stats of a query job as the host sends them to the results view */
export interface JobStats {
    /** A `Date` on the host, an ISO string once it has crossed to the webview */
    bigQueryJobEndTime?: Date | string;
    /** `project:location.job_id` */
    bigQueryJobId?: string;
    /** Bytes billed, already formatted: "269.00 MiB" */
    jobCostMeta?: string;
    /** From the job's creation to its end */
    durationMs?: number;
    cacheHit?: boolean;
    /** Rows of the whole result */
    totalRows?: number;
}

/** The rows the host reads from BigQuery in one go. A result of no more rows than this is sent whole to the view. */
export const RESULT_CHUNK_ROWS = 1000;

export interface ResultSort {
    /** The column's field */
    id: string;
    desc: boolean;
}

export interface ResultFilter {
    id: string;
    value: string;
}

/** What the view asks of the host for a result it does not hold whole: a page of it, sorted and filtered */
export interface ResultViewRequest {
    /** Counts up, so that the answer to a request the view has since replaced can be told */
    requestId: number;
    pageIndex: number;
    pageSize: number;
    sorting: ResultSort[];
    filters: ResultFilter[];
}

/** Which rows of a result the view was sent. Absent when it was sent all of them. */
export interface ResultPaging {
    pageIndex: number;
    pageSize: number;
    /** Rows of the result once filtered */
    rowCount: number;
    sorting: ResultSort[];
    filters: ResultFilter[];
    /** Bytes billed, formatted, for the query that sorted and filtered */
    viewBilled?: string;
}

/**
 * The id of a job that was just created, in the form its stats give later: `project:location.job_id`. The client's
 * own `id` is the last part alone, which is not enough to link to the job.
 */
export function fullJobId(job: { id?: string, metadata?: { id?: string, jobReference?: { projectId?: string, location?: string, jobId?: string } } }): string | undefined {
    if (job.metadata?.id) {
        return job.metadata.id;
    }
    const { projectId, location, jobId } = job.metadata?.jobReference ?? {};
    return projectId && location && jobId ? `${projectId}:${location}.${jobId}` : job.id;
}

/** The job's page in the BigQuery console, from an id of the form `project:location.job_id` */
export function bigQueryJobUrl(jobId: string | undefined): string | undefined {
    const parts = jobId?.split(':') ?? [];
    if (parts.length < 2) {
        return undefined;
    }
    return `https://console.cloud.google.com/bigquery?project=${parts[0]}&j=bq:${parts[1].replace('.', ':')}&page=queryresults`;
}

/** The job's own id without project and location, cut in the middle when long: `job_Kq3v…4nYc` */
export function shortJobId(jobId: string): string {
    const afterProject = jobId.slice(jobId.indexOf(':') + 1);
    const id = afterProject.slice(afterProject.indexOf('.') + 1);
    return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

const count = (n: number) => n.toLocaleString('en-US');

/**
 * The items of the status line of a finished job, in the order shown: rows, duration, bytes billed, cache hit,
 * end time. An item the job has no value for is left out. `shownRows` is fewer than the job's rows when a filter
 * is on, and `viewBilled` is what sorting and filtering cost on top of the job.
 */
export function jobStatsParts(jobStats: JobStats | null | undefined, shownRows?: number, viewBilled?: string): string[] {
    const parts: string[] = [];
    if (shownRows !== undefined) {
        const total = jobStats?.totalRows;
        parts.push(total !== undefined && total > shownRows
            ? `${count(shownRows)} of ${count(total)} rows`
            : `${count(shownRows)} ${shownRows === 1 ? 'row' : 'rows'}`);
    }
    if (!jobStats) {
        return parts;
    }
    if (jobStats.durationMs !== undefined) {
        parts.push(formatDuration(jobStats.durationMs));
    }
    if (jobStats.jobCostMeta) {
        parts.push(`${jobStats.jobCostMeta} billed`);
    }
    if (viewBilled) {
        parts.push(`${viewBilled} billed to sort and filter`);
    }
    if (jobStats.cacheHit) {
        parts.push('cache hit');
    }
    if (jobStats.bigQueryJobEndTime) {
        const endTime = new Date(jobStats.bigQueryJobEndTime);
        if (!isNaN(endTime.getTime())) {
            parts.push(endTime.toLocaleTimeString());
        }
    }
    return parts;
}
