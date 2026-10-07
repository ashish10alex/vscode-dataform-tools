import type { BigQuerySlice, CompileStatus, DataformBlock, DbtBlock, FileSlice, HostMessage, ProjectSlice } from './panelContract';
import { fileModels } from './panelFileView';

/*
 * What the compiled-query panel knows: the last of each slice the host sent (see panelContract.ts), and a little it
 * has seen and still shows. The panel's components read this and nothing else.
 */

/** Whether a message from the host is a slice of the contract */
export function isSliceMessage(message: unknown): message is HostMessage {
    return typeof message === 'object' && message !== null && typeof (message as { slice?: unknown }).slice === 'string' && 'value' in message;
}

export interface PanelSlices {
    project?: ProjectSlice;
    file?: FileSlice;
    compile?: CompileStatus;
    /**
     * How the last compile that finished stands, kept while the next one runs: what was wrong before a compile
     * started is still wrong until it ends. Unset before any has finished.
     */
    settled?: CompileStatus;
    bigquery?: BigQuerySlice;
    /**
     * The dry-run results the columns on show come from, with the file they were for. The columns of the last dry
     * runs stay while the next ones are out, so that the Schema tab does not empty on every save. Unset when the
     * file on show has no action with columns.
     */
    columns?: { bigquery: BigQuerySlice; file: FileSlice };
    /** Always there, so that a component need not ask whether one has arrived */
    dataform: DataformBlock;
    dbt?: DbtBlock;
}

/** The `dataform` block before the host has said anything */
export const EMPTY_DATAFORM_BLOCK: DataformBlock = {
    compile: 0, compilerOptions: '', compilationMode: 'cli', snoozeEndTime: null, deferral: null, leftoverProxies: null,
    lastRun: null, propertyGraphs: null, propertyGraphValidations: null, propertyGraphElementSchemas: {},
};

/** The slices the panel starts with: those the host put in its first page, if any */
export function initialSlices(baked: Partial<PanelSlices> = {}): PanelSlices {
    const settled = baked.compile && baked.compile.status !== 'compiling' ? { settled: baked.compile } : {};
    return { ...baked, ...settled, dataform: baked.dataform ?? EMPTY_DATAFORM_BLOCK };
}

/** What of the `dataform` block belongs to the file on show, and is not to be shown for the next one */
const OF_THE_FILE = { deferral: null, leftoverProxies: null, propertyGraphs: null, propertyGraphValidations: null };

/** Where the columns on show come from, after a `bigquery` slice */
function columnsAfter(slices: PanelSlices, bigquery: BigQuerySlice): PanelSlices['columns'] {
    // Dry runs are out, or none was made: what is on show stays
    if (bigquery.dryRunning.length > 0) {
        return slices.columns;
    }
    if (!slices.file || fileModels(slices.file).length === 0) {
        return undefined;
    }
    return bigquery.results.length > 0 ? { bigquery, file: slices.file } : slices.columns;
}

/**
 * The file the panel names: the one a running compile was started for, else the one whose actions are on show.
 * Undefined before the host has named one.
 */
export function fileOnShow(slices: Pick<PanelSlices, 'compile' | 'file'>): string | undefined {
    if (slices.compile?.status === 'compiling' && slices.compile.file) {
        return slices.compile.file;
    }
    return slices.file?.file || undefined;
}

/**
 * The slices after a message from the host.
 *
 * A `dataform` block that says which fields it is about changes only those: the others keep the very values they
 * had, so that a component that acts on a field arriving (the polling of workflow statuses, the defer banner) sees
 * an arrival only when the host sent that field.
 *
 * When the file the panel names changes, what belonged to the last one is taken off the `dataform` block: its defer
 * banner and its property graphs are not shown under the next file's name while that file compiles.
 */
export function applyMessage(slices: PanelSlices, message: unknown): PanelSlices {
    const next = withSlice(slices, message);
    const named = fileOnShow(next);
    return named !== undefined && named !== fileOnShow(slices) ? { ...next, dataform: { ...next.dataform, ...OF_THE_FILE } } : next;
}

function withSlice(slices: PanelSlices, message: unknown): PanelSlices {
    if (!isSliceMessage(message)) {
        return slices;
    }
    const sent: HostMessage = message;
    switch (sent.slice) {
        case 'project':
            return { ...slices, project: sent.value ?? undefined };
        case 'file':
            return { ...slices, file: sent.value };
        case 'compile status':
            return sent.value.status === 'compiling' ? { ...slices, compile: sent.value } : { ...slices, compile: sent.value, settled: sent.value };
        case 'bigquery':
            return { ...slices, bigquery: sent.value, columns: columnsAfter(slices, sent.value) };
        case 'dbt':
            return { ...slices, dbt: sent.value };
        case 'dataform': {
            if (!sent.touched) {
                return { ...slices, dataform: sent.value };
            }
            const dataform: DataformBlock = { ...slices.dataform, compile: sent.value.compile };
            for (const field of sent.touched) {
                (dataform as unknown as Record<string, unknown>)[field] = sent.value[field];
            }
            return { ...slices, dataform };
        }
        default:
            return slices;
    }
}
