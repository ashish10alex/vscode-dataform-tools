import type { BackendPart, CompileError } from '../backend/backend';
import type { DryRunResult } from '../bigquery/dryRunService';
import type { BackendName } from '../project/detection';
import type { CompilationMode, Tool } from '../project/tools';
import type {
    ChangedActionsView,
    DeferToProdState,
    DeferralView,
    LastRunView,
    ProjectConfig,
    PropertyGraph,
    PropertyGraphElementSchema,
    PropertyGraphValidation,
    WorkflowUrlEntry,
} from '../types';
import type { CompilationInfo } from '../utils/compilationInfo';
import type { ApiRunGitState } from './apiRunGitState';
import type { ActionId, ColumnDescription, Kind, RunOptions, SqlSection, Target } from './compiledGraph';

/*
 * What the compiled-query panel and the extension host say to each other (decided in xf#51). Host and panel both
 * import this file and nothing else describes their messages. Types only: importing it pulls no code into either.
 *
 * The host sends the panel slices, and now and then an event. Each slice is built by one function, sent only when it
 * differs from what the panel has (the `dataform` block apart, see `HostMessage`), and names the
 * compile it belongs to. What both Backends have is in the neutral slices; what only one has is in its own block,
 * so that a component shared by both cannot reach into it by accident.
 *
 * The panel sends the host the messages of `PanelMessage`, which name an action by its Target.
 */

/**
 * Compiles of a Project are numbered from 1. A slice carries the number of the compile its content came from, and
 * the panel drops anything older than the SQL it is showing.
 */
export type CompileNumber = number;

interface Slice {
    compile: CompileNumber;
}

// ---- Project

/** The Project the panel's file belongs to */
export interface ProjectSlice extends Slice {
    /** Absolute path of the Project's root */
    root: string;
    backend: BackendName;
    /** Which optional parts the Backend has. The panel hides the controls of a part that is absent */
    parts: Record<BackendPart, boolean>;
    /** Every tag an action of the Project has, sorted */
    tags: string[];
}

// ---- File and actions

/** An action as a neighbour of another: enough to name it, link to it and open its file */
export interface ActionReference {
    target: Target;
    kind: Kind;
    /** Relative to the Project root with forward slashes; empty when the action has no file */
    fileName: string;
}

/** An action shown in the panel: one the file defines, or a test shown with one of those */
export interface PanelAction extends ActionReference {
    id: ActionId;
    /** The action builds nothing and its Target is made up: it is never shown as a BigQuery link */
    buildsNothing: boolean;
    /** The action builds a table or view at its Target. An operation does only when it says it has output */
    buildsTable: boolean;
    tags: string[];
    disabled: boolean;
    description?: string;
    columns?: ColumnDescription[];
    /** The action's SQL in execution order */
    sections: SqlSection[];
    /** False when this compile left the action's SQL out, which is not the same as an action with no SQL */
    sqlPresent: boolean;
    /** Whether a run can execute the action. The panel offers Run only then */
    runnable: boolean;
    dependencies: ActionReference[];
    dependents: ActionReference[];
}

/** What the file is to its Project */
export type FileRole =
    /** It defines the actions listed */
    | 'actions'
    /** It is the Project's settings file */
    | 'project settings'
    /** It affects a compile and defines no action: a Dataform include, a dbt macro file or YAML with no action */
    | 'helper'
    /** It is in the Project and nothing in the Compiled Graph comes from it */
    | 'not compiled';

/** Why a file has nothing to show, when that is not for the compile status to say */
export interface FileProblem {
    kind:
        /** The extension shows no file of this type */
        | 'unsupported file type'
        /** The file should define an action, and the Compiled Graph has none from it */
        | 'no action'
        /** An action of the file has no SQL where it must have */
        | 'no sql'
        | 'other';
    /** For the user; may hold HTML, which the panel sanitises. Absent where the panel has its own words for the kind */
    message?: string;
}

/** The file the panel is showing and the actions shown for it. Only these and their neighbours cross */
export interface FileSlice extends Slice {
    /** Relative to the Project root with forward slashes */
    file: string;
    role: FileRole;
    /** Set only with the role "not compiled" */
    problem?: FileProblem;
    /** In display order. A model's tests follow it, though they are defined in other files */
    actions: PanelAction[];
}

// ---- Compile status

/** Exactly one of seven. Each carries only its own details */
export type CompileStatus = Slice & (
    /** The file is in no Project */
    | { status: 'no project' }
    | { status: 'tool not found'; tool: Tool; /** Where it was looked for, in order */ lookedIn: string[] }
    | { status: 'version unsupported'; tool: Tool; version: string; message: string }
    | {
        status: 'compiling';
        /** The SQL of the last compile is still on show, marked outdated */
        showingPrevious: boolean;
        /** Epoch ms, for the elapsed time */
        startedAt: number;
        /** The command line of the compile, where there is one */
        command?: string;
        /**
         * The file the panel is for, relative to the Project root: the one whose save or opening started the
         * compile. The panel names it while the compile runs, though the SQL on show may still be another file's
         */
        file?: string;
    }
    /** Errors travel with a compiled Project: a compile can give a graph and errors together */
    | { status: 'compiled'; compiledAt: number; durationMs?: number; errors: CompileError[] }
    /** The Project was parsed and its SQL is as written, e.g. a dbt v2 Project with on-run hooks */
    | { status: 'parsed only'; compiledAt: number; notice: string; errors: CompileError[] }
    | { status: 'failed'; errors: CompileError[] }
);

// ---- BigQuery results

/** One dry-run script of an action, see `DryRunScript` */
export interface DryRunKey {
    action: ActionId;
    script: string;
    incremental: boolean;
}

/** What BigQuery knows of the table an action builds */
export interface TableState {
    /** As shown, already formatted in the user's time zone */
    lastModified?: string;
    modifiedToday?: boolean;
    /** BigQuery says there is no such table */
    missing?: boolean;
    error?: string;
}

/**
 * What BigQuery said of the actions on show. A result is keyed by its action, script and variant; it places an
 * error within a section.
 */
export interface BigQuerySlice extends Slice {
    results: DryRunResult[];
    /** The dry runs still out */
    dryRunning: DryRunKey[];
    /** By action, for the actions that build a table */
    tables: Record<ActionId, TableState>;
    /** For costs, e.g. "$" */
    currencySymbol: string;
}

// ---- Run status

/** The last run started from the extension through the Backend's runner */
export interface RunStatusSlice extends Slice {
    lastRun?: {
        request: RunOptions;
        /** The command line that was sent to the terminal */
        command: string;
        /** Epoch ms */
        startedAt: number;
    };
}

// ---- The Backends' own blocks

/** What only a Dataform Project has */
export interface DataformBlock extends Slice {
    projectConfig?: ProjectConfig;
    dataformCoreVersion?: string;
    packageJson?: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    /** The compiler options setting, as typed */
    compilerOptions: string;
    compilationMode: CompilationMode;
    /** Which CLI or commit the result on show came from, and how fresh it is */
    compilationInfo?: CompilationInfo;
    /** What the user can try after a compile that gave no result */
    possibleResolutions?: string[];
    /** When a pause of compile-on-save ends, epoch ms. Null when not paused */
    snoozeEndTime: number | null;

    /** Null when defer to prod is off */
    deferral: DeferralView | null;
    deferToProd?: DeferToProdState;
    /** With defer to prod off: upstream tables still read from prod through leftover Proxy Views */
    leftoverProxies: string[] | null;

    workflowUrls?: WorkflowUrlEntry[];
    /** The last run through the CLI or the Dataform API, for repeating */
    lastRun: LastRunView | null;
    /** What a run through the Dataform API leaves out, since it runs the branch as pushed */
    apiRunGitState?: ApiRunGitState;
    changedActions?: ChangedActionsView;

    propertyGraphs: PropertyGraph[] | null;
    propertyGraphValidations: PropertyGraphValidation[] | null;
    /** Keyed by `<graph target>::<element name>`, filled in as elements are expanded */
    propertyGraphElementSchemas: Record<string, PropertyGraphElementSchema>;
    /** Columns the last dry run drops or retypes against prod */
    columnImpact?: { file: string; changed?: number };
    /** The cost estimate across tags */
    tagCostEstimate?: { rows?: unknown[]; /** Why there are no rows, as the host has always sent it: text */ error?: string; /** The tags it was asked for */ tags?: string[] };
    /** What Dataplex says reads the file's first table, once asked for. Null before, and for the next file */
    lineage?: { dependencies?: string[]; error?: { message?: string } } | null;
}

/** What only a dbt Project has */
export interface DbtBlock extends Slice {
    /** The dbt found. Unset while it is being looked for, and when there is none */
    dbt?: {
        path: string;
        /** Which step of the search found it, e.g. "the dbtExecutablePath setting", "the Project's .venv" */
        foundBy: string;
        flavour: 'dbt-core' | 'dbt v2';
        version: string;
    };
    /** dbt is being looked for: the panel does not yet say that there is none */
    looking: boolean;
    target: {
        /** The active dbt target. Unset until dbt has reported it */
        name?: string;
        /** A private override of the `dbtTarget` setting is in force */
        overridden: boolean;
        /** The dbt targets of the Project's profile, where they could be read. Empty when not: the panel then takes a typed name */
        names: string[];
        /** The one the profile names as its default, where that could be read */
        profileDefault?: string;
        /** The `dbtTarget` setting, the team's default: what the way back from an override goes to. Unset when dbt chooses */
        setting?: string;
    };
    /** Shown read-only */
    vars?: string;
    profilesDir?: string;
    /** The Project has on-run hooks and was only parsed: the panel offers to compile with hooks */
    hooksNotice: boolean;
    /** The warehouse the Project's profile is for, as dbt names its adapter, e.g. "bigquery". Unset until a compile has said */
    warehouse?: string;
    /** False for a Project of another warehouse: no dry run, cost, schema, preview or run */
    bigQuery: boolean;
    /** What `dbt_project.yml` says, and what the last compile found. Unset before the first compile that left a graph */
    project?: {
        name: string;
        /** The profile the Project names, where `dbt_project.yml` could be read */
        profile?: string;
        /** How many actions the Project has of each Kind it has any of */
        actions: Partial<Record<Kind, number>>;
    };
    /** What dbt calls each action on show, where that is not its Target's name: a source is "<source>.<table>", a versioned model "<name> v<version>" */
    names: Record<ActionId, string>;
    /** The names of the macros and generic tests the file on show defines */
    macros: string[];
}

// ---- Host to panel

export type HostMessage =
    /** Null takes the Project back: the file now on show is not yet known to be in the one last sent */
    | { slice: 'project'; value: ProjectSlice | null }
    | { slice: 'file'; value: FileSlice }
    | { slice: 'compile status'; value: CompileStatus }
    | { slice: 'bigquery'; value: BigQuerySlice }
    | { slice: 'run status'; value: RunStatusSlice }
    /**
     * `touched` names the fields this send is about. The panel changes only those, and so sees a field arrive only
     * when the host sent it: a component may act on an arrival, as the polling of workflow statuses does on the
     * workflow links. Without `touched` the whole block is replaced.
     */
    | { slice: 'dataform'; value: DataformBlock; touched?: Array<Exclude<keyof DataformBlock, 'compile'>> }
    | { slice: 'dbt'; value: DbtBlock };

/** Something that happened once, which is not state: the panel acts on it and keeps nothing */
export type HostEvent =
    /** The user did not confirm a repeat of the last run */
    | { event: 'rerun aborted' }
    | { event: 'workflow cancel failed'; workflowInvocationId: string };

export type SliceName = HostMessage['slice'];

// ---- Panel to host

/** How a run reaches from an action */
export interface RunScope {
    includeDependencies: boolean;
    includeDependents: boolean;
    fullRefresh: boolean;
}

/** Messages either Backend's panel can send */
export type SharedPanelMessage =
    /**
     * The panel's page has loaded and listens: the host sends again what it has sent. A message posted before this
     * may have found nobody listening, and the host does not send a slice twice of itself
     */
    | { command: 'ready' }
    /** Open the file that defines the action */
    | { command: 'openAction'; action: Target }
    /** Open a file of the Project, relative to its root with forward slashes, at a 1-based line where one is given */
    | { command: 'openFile'; file: string; line?: number }
    /** Run a section's query and show its rows; `alone` leaves out what runs before it */
    | { command: 'preview'; action: Target; section: string; alone?: boolean }
    /** Run the actions with the Backend's runner, in the terminal */
    | ({ command: 'run'; actions: Target[] } & RunScope)
    | ({ command: 'runTags'; tags: string[] } & RunScope)
    | { command: 'repeatLastRun' }
    | { command: 'copyToClipboard'; text: string }
    /** Save an action's schema to a file */
    | { command: 'exportSchema'; fileName: string; content: string }
    | { command: 'selectProject' }
    | { command: 'showDependencyGraph' }
    | { command: 'formatFile' }
    | { command: 'lintFile' }
    | { command: 'showLogs' }
    | { command: 'openExternal'; url: string };

/** Messages only a Dataform Project's panel sends. Each is named as Dataform's */
export type DataformPanelMessage =
    | { command: 'dataform.updateCompilerOptions'; compilerOptions: string }
    | { command: 'dataform.switchCompilationMode'; compilationMode: CompilationMode }
    | { command: 'dataform.compileRemotely' }
    | { command: 'dataform.startSnooze' }
    | { command: 'dataform.stopSnooze' }
    | { command: 'dataform.runTests' }
    /** Run through the Dataform API, on the pushed branch or in a remote workspace */
    | ({ command: 'dataform.runApi'; actions: Target[]; workspace: boolean } & RunScope)
    | ({ command: 'dataform.runTagsApi'; tags: string[] } & RunScope)
    | { command: 'dataform.runWithOptions'; workspace: boolean }
    | { command: 'dataform.toggleDeferToProd'; on: boolean }
    | { command: 'dataform.deferToProdActions' }
    | { command: 'dataform.openDeferToProdSettings' }
    | { command: 'dataform.retryDeferral' }
    | { command: 'dataform.removeProxyViews'; targets?: string[] }
    | { command: 'dataform.computeChangedActions' }
    | ({ command: 'dataform.runChangedActions'; api: boolean; files?: string[] } & RunScope)
    | { command: 'dataform.estimateTagCost'; tags: string[]; includeDependencies: boolean; includeDependents: boolean }
    | { command: 'dataform.exportTagCostCsv'; fileName: string; content: string }
    | { command: 'dataform.loadWorkflowUrls' }
    | { command: 'dataform.clearWorkflowUrls' }
    | { command: 'dataform.refreshWorkflowStatuses' }
    | { command: 'dataform.cancelWorkflowInvocation'; workflowInvocationId: string }
    | { command: 'dataform.loadWorkflowJobStats'; workflowInvocationId: string }
    | { command: 'dataform.exportWorkflowActionsCsv'; workflowInvocationId: string }
    | { command: 'dataform.openExecutedSql'; workflowInvocationId: string; action: string }
    | { command: 'dataform.openBigQueryJob'; workflowInvocationId: string; action: string }
    | { command: 'dataform.showDependencyInspector' }
    | { command: 'dataform.showColumnLineage' }
    | { command: 'dataform.loadLineage' }
    /** `elementName` is the panel's key for the element, `<graph target>::<element name>`; `table` is what backs it */
    | { command: 'dataform.loadPropertyGraphElementSchema'; elementName: string; table: Target }
    | { command: 'dataform.runGeneratedQuery'; query: string; kind?: string };

/** Messages only a dbt Project's panel sends. Each is named as dbt's */
export type DbtPanelMessage =
    /** Use this dbt target for the workspace; null goes back to the `dbtTarget` setting */
    | { command: 'dbt.setTarget'; name: string | null }
    /** Compile with on-run hooks from now on, or stop */
    | { command: 'dbt.compileWithHooks'; on: boolean }
    | { command: 'dbt.chooseExecutable' }
    | { command: 'dbt.lookForDbtAgain' };

export type PanelMessage = SharedPanelMessage | DataformPanelMessage | DbtPanelMessage;

export type PanelCommand = PanelMessage['command'];
