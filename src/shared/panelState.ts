import type { BigQuerySlice, CompileStatus, DataformBlock, DbtBlock, FileSlice, HostMessage, ProjectSlice } from './panelContract';
import { DataformBlockMessage, isSliceMessage } from './panelLegacyState';

/*
 * What the compiled-query panel knows: the last of each slice the host sent (see panelContract.ts). The panel's
 * components read this. While some of them still read the flat state, the panel keeps both, and this file holds the
 * half that stays.
 */

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

/**
 * The slices after a message from the host.
 *
 * A `dataform` block that says which fields it is about changes only those: the others keep the very values they
 * had, so that a component that acts on a field arriving (the polling of workflow statuses, the defer banner) sees
 * an arrival only when the host sent that field.
 *
 * @param fileOnShow The file the panel is showing, as the flat state has it. A flat message that names another file
 * takes what belonged to the last one off the `dataform` block, as it does off the flat state
 */
export function applyMessage(slices: PanelSlices, message: unknown, fileOnShow: string | undefined): PanelSlices {
    if (!isSliceMessage(message)) {
        const named = (message as { relativeFilePath?: unknown } | null)?.relativeFilePath;
        return typeof named === 'string' && named !== '' && named !== fileOnShow ? { ...slices, dataform: { ...slices.dataform, ...OF_THE_FILE } } : slices;
    }
    const sent = message as HostMessage | DataformBlockMessage;
    switch (sent.slice) {
        case 'project':
            return { ...slices, project: sent.value };
        case 'file':
            return { ...slices, file: sent.value };
        case 'compile status':
            return sent.value.status === 'compiling' ? { ...slices, compile: sent.value } : { ...slices, compile: sent.value, settled: sent.value };
        case 'bigquery':
            return { ...slices, bigquery: sent.value };
        case 'dbt':
            return { ...slices, dbt: sent.value };
        case 'dataform': {
            if (!('touched' in sent)) {
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
