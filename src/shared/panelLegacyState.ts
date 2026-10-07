import type { CompileStatus, DataformBlock, HostMessage } from './panelContract';
import { legacyStateFromFileSlice } from './panelLegacyFile';

/*
 * While the compiled-query panel moves from one flat state to the slices of the contract (piece 4.4 of the build
 * plan), the host sends some things as slices and the rest as it always has. The panel's components still read the
 * flat state, so a slice is turned into the flat fields here, in one place that the panel and the recorded panel
 * output both use. This file shrinks as components read slices themselves, and goes when the last one does.
 */

/**
 * The fields of the `dataform` block that arrive only as a slice. A field joins this list when every place that
 * sent it the old way has been moved; until then the block's value for it is a placeholder and is not passed on.
 */
export const MIGRATED_DATAFORM_FIELDS = [
    'lastRun', 'workflowUrls', 'changedActions', 'apiRunGitState', 'columnImpact',
    'projectConfig', 'packageJson', 'possibleResolutions', 'snoozeEndTime', 'tagCostEstimate', 'compilationInfo',
    'compilerOptions', 'compilationMode', 'dataformCoreVersion',
] as const satisfies ReadonlyArray<keyof DataformBlock>;

type MigratedDataformField = (typeof MIGRATED_DATAFORM_FIELDS)[number];

/**
 * A `dataform` block as the host sends it for now: with the fields this send is about. The components act on a field
 * arriving, not only on its value: the polling of workflow statuses asks again each time the workflow links arrive,
 * and the defer banner stops waiting when a deferral does. So a send must look to them as the old flat message did,
 * carrying the fields it is about and no others, and it is sent every time, changed or not.
 */
export type DataformBlockMessage = Extract<HostMessage, { slice: 'dataform' }> & { touched: MigratedDataformField[] };

/** How each moved field is named and shaped in the flat state */
const FLAT_FIELD: { [Field in MigratedDataformField]: (block: DataformBlock) => Record<string, unknown> } = {
    lastRun: (block) => ({ lastRun: block.lastRun }),
    workflowUrls: (block) => ({ workflowUrls: block.workflowUrls }),
    changedActions: (block) => ({ changedActions: block.changedActions }),
    apiRunGitState: (block) => ({ apiRunGitState: block.apiRunGitState }),
    // The flat state names the file `relativeFilePath`
    columnImpact: (block) => ({ columnImpact: block.columnImpact && { relativeFilePath: block.columnImpact.file, changed: block.columnImpact.changed } }),
    // The flat state clears these two with null
    projectConfig: (block) => ({ projectConfig: block.projectConfig ?? null }),
    packageJson: (block) => ({ packageJsonContent: block.packageJson ?? null }),
    possibleResolutions: (block) => ({ possibleResolutions: block.possibleResolutions }),
    snoozeEndTime: (block) => ({ snoozeEndTime: block.snoozeEndTime }),
    tagCostEstimate: (block) => ({ tagDryRunStatsMeta: block.tagCostEstimate && { tagDryRunStatsList: block.tagCostEstimate.rows, error: block.tagCostEstimate.error } }),
    compilationInfo: (block) => ({ compilationInfo: block.compilationInfo }),
    compilerOptions: (block) => ({ compilerOptions: block.compilerOptions }),
    // The flat state calls the Compilation Mode the compilation backend, as the setting does
    compilationMode: (block) => ({ compilationBackend: block.compilationMode }),
    dataformCoreVersion: (block) => ({ dataformCoreVersion: block.dataformCoreVersion }),
};

/** The flat state's fields for a slice the host sent: what the panel merges into its state */
export function legacyStateFromSlice(message: HostMessage | DataformBlockMessage): Record<string, unknown> {
    if (message.slice === 'compile status') {
        return legacyStateFromCompileStatus(message.value);
    }
    if (message.slice === 'file') {
        return legacyStateFromFileSlice(message.value);
    }
    if (message.slice !== 'dataform') {
        // No component reads the other slices yet, and the host does not send them
        return {};
    }
    const touched: readonly MigratedDataformField[] = 'touched' in message ? message.touched : MIGRATED_DATAFORM_FIELDS;
    return Object.assign({}, ...touched.filter((field) => field in FLAT_FIELD).map((field) => FLAT_FIELD[field](message.value)));
}

/**
 * The flat fields that say how the compile stands. Each is given only by the status that used to set it, so that a
 * status with nothing to say of a field leaves the field as it is, as a flat message without it did:
 * - `recompiling`, by every status;
 * - `missingExecutables`, when the tool was not found;
 * - `compilationErrors`, when the compile left errors.
 * The flat state's `errorType` and `errorMessage` also carry problems with the file itself, which are not the
 * compile's; they stay flat for now.
 */
function legacyStateFromCompileStatus(status: CompileStatus): Record<string, unknown> {
    const flat: Record<string, unknown> = { recompiling: status.status === 'compiling' };
    if (status.status === 'tool not found') {
        flat.missingExecutables = [status.tool];
    }
    if ((status.status === 'compiled' || status.status === 'parsed only' || status.status === 'failed') && status.errors.length > 0) {
        flat.compilationErrors = status.errors.map((error) => ({ error: error.message, fileName: error.fileName ?? '', lineNumber: error.line, sourceContext: error.sourceContext }));
    }
    return flat;
}

/** Whether a message from the host is a slice of the contract, as opposed to flat fields */
export function isSliceMessage(message: unknown): message is HostMessage {
    return typeof message === 'object' && message !== null && typeof (message as { slice?: unknown }).slice === 'string' && 'value' in message;
}

/** A message from the host as flat fields, whichever way it was sent */
export function toLegacyState(message: Record<string, unknown>): Record<string, unknown> {
    return isSliceMessage(message) ? legacyStateFromSlice(message) : message;
}
