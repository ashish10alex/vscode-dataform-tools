import { ENDED_RUN_STATES } from '../../../src/shared/cliRunJobs';

/** The states a run does not leave. How often runs are asked about is the host's, in src/shared/runPolling.ts */
export const TERMINAL_WORKFLOW_STATES = ENDED_RUN_STATES;
