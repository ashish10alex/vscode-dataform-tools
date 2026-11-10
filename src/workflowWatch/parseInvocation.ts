/*
 * What a user pastes to name a workflow invocation the extension did not start: its ID, the URL of its page in the
 * Cloud console, or its resource name. Every part is checked character by character here, before it goes into any
 * request or log line.
 */

/** A workflow invocation; what the paste leaves out is the current repository's */
export interface InvocationRef {
    projectId?: string;
    location?: string;
    repositoryName?: string;
    workflowInvocationId: string;
}

/** What Dataform allows in an invocation's ID: the ones it makes are a number and a UUID joined with a dash */
const INVOCATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const LOCATION = /^[a-z][a-z0-9-]{1,39}$/;
const REPOSITORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** The only host a pasted URL may name. It is only read for the parts of its path, never fetched */
export const CONSOLE_HOST = 'console.cloud.google.com';

/** The longest paste read */
const MAX_INPUT = 2048;

/** An absolute URL, or undefined for anything else (a bare ID, a resource name) */
function absoluteUrl(s: string): URL | undefined {
    try {
        return new URL(s);
    } catch {
        return undefined;
    }
}

/**
 * Reads a workflow ID, its page in the console (…/locations/L/repositories/R/workflows/ID?project=P) or its resource
 * name (projects/P/locations/L/repositories/R/workflowInvocations/ID). Throws with a message for the user otherwise.
 */
export function parseInvocation(input: string): InvocationRef {
    const s = input.trim();
    if (!s) {
        throw new Error('Paste a workflow ID, or the URL of its page in the Cloud console');
    }
    if (s.length > MAX_INPUT) {
        throw new Error('That is too long for a workflow ID or a console URL');
    }
    let projectId: string | undefined;
    let location: string | undefined;
    let repositoryName: string | undefined;
    let workflowInvocationId = '';
    if (s.includes('/') || s.includes(':')) {
        let path = s;
        const url = absoluteUrl(s);
        if (url) {
            if (url.protocol !== 'https:' || url.host !== CONSOLE_HOST) {
                throw new Error(`Only a page of ${CONSOLE_HOST} names a workflow: that URL is of ${url.host || url.protocol}`);
            }
            path = url.pathname;
            projectId = url.searchParams.get('project') || undefined;
        }
        const segments = path.replace(/^\/+|\/+$/g, '').split('/');
        for (let i = 0; i + 1 < segments.length; i++) {
            const value = segments[i + 1];
            switch (segments[i]) {
                case 'projects': projectId = value; break;
                case 'locations': location = value; break;
                case 'repositories': repositoryName = value; break;
                case 'workflows':
                case 'workflowInvocations': workflowInvocationId = value; break;
            }
        }
        if (!workflowInvocationId) {
            throw new Error(`"${s}" names no workflow: its URL ends in …/workflows/<ID>`);
        }
    } else {
        workflowInvocationId = s;
    }
    const checks: [string, string | undefined, RegExp][] = [
        ['workflow ID', workflowInvocationId, INVOCATION_ID],
        ['project', projectId, PROJECT_ID],
        ['location', location, LOCATION],
        ['repository name', repositoryName, REPOSITORY_NAME],
    ];
    for (const [what, value, pattern] of checks) {
        if (value !== undefined && !pattern.test(value)) {
            throw new Error(`"${value}" is not a ${what}`);
        }
    }
    return { projectId, location, repositoryName, workflowInvocationId };
}
