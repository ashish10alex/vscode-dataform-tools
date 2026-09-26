import type { Assertion, Column, DataformCompiledJson, Declarations, Notebook, Operation, ProjectConfig, Table, Target } from '../types';

/*
 * Converts a Dataform API compilation result into the shape of `dataform compile --json`,
 * so every consumer of the compiled JSON works unchanged when compiling remotely.
 *
 * The API returns proto defaults ("" / [] / 0 / false) for unset fields whereas the CLI omits them,
 * so empty values are dropped to keep the two outputs comparable.
 *
 * Structural input types are declared here (rather than importing the generated protos) to keep this
 * module free of runtime dependencies and easy to unit test.
 */

type ApiTarget = { database?: string | null; schema?: string | null; name?: string | null };

type ApiRelationDescriptor = {
    description?: string | null;
    columns?: { path?: string[] | null; description?: string | null }[] | null;
    bigqueryLabels?: { [k: string]: string } | null;
};

export type ApiCompilationResultAction = {
    target?: ApiTarget | null;
    canonicalTarget?: ApiTarget | null;
    filePath?: string | null;
    relation?: {
        dependencyTargets?: ApiTarget[] | null;
        disabled?: boolean | null;
        tags?: string[] | null;
        relationDescriptor?: ApiRelationDescriptor | null;
        relationType?: string | number | null;
        selectQuery?: string | null;
        preOperations?: string[] | null;
        postOperations?: string[] | null;
        incrementalTableConfig?: {
            incrementalSelectQuery?: string | null;
            refreshDisabled?: boolean | null;
            uniqueKeyParts?: string[] | null;
            updatePartitionFilter?: string | null;
            incrementalPreOperations?: string[] | null;
            incrementalPostOperations?: string[] | null;
        } | null;
        partitionExpression?: string | null;
        clusterExpressions?: string[] | null;
        partitionExpirationDays?: number | null;
        requirePartitionFilter?: boolean | null;
        additionalOptions?: { [k: string]: string } | null;
    } | null;
    operations?: {
        dependencyTargets?: ApiTarget[] | null;
        disabled?: boolean | null;
        tags?: string[] | null;
        relationDescriptor?: ApiRelationDescriptor | null;
        queries?: string[] | null;
        hasOutput?: boolean | null;
    } | null;
    assertion?: {
        dependencyTargets?: ApiTarget[] | null;
        parentAction?: ApiTarget | null;
        disabled?: boolean | null;
        tags?: string[] | null;
        selectQuery?: string | null;
        relationDescriptor?: ApiRelationDescriptor | null;
    } | null;
    declaration?: {
        relationDescriptor?: ApiRelationDescriptor | null;
    } | null;
    notebook?: {
        dependencyTargets?: ApiTarget[] | null;
        disabled?: boolean | null;
        contents?: string | null;
        tags?: string[] | null;
    } | null;
};

export type ApiCompilationResult = {
    name?: string | null;
    resolvedGitCommitSha?: string | null;
    dataformCoreVersion?: string | null;
    codeCompilationConfig?: {
        defaultDatabase?: string | null;
        defaultSchema?: string | null;
        defaultLocation?: string | null;
        assertionSchema?: string | null;
        vars?: { [k: string]: string } | null;
        databaseSuffix?: string | null;
        schemaSuffix?: string | null;
        tablePrefix?: string | null;
        builtinAssertionNamePrefix?: string | null;
        defaultNotebookRuntimeOptions?: { gcsOutputBucket?: string | null; aiPlatformNotebookRuntimeTemplate?: string | null } | null;
    } | null;
    compilationErrors?: { message?: string | null; stack?: string | null; path?: string | null; actionTarget?: ApiTarget | null }[] | null;
};

const RELATION_TYPES: { [k: string]: { type: string; materialized?: boolean } } = {
    TABLE: { type: 'table' },
    VIEW: { type: 'view' },
    INCREMENTAL_TABLE: { type: 'incremental' },
    MATERIALIZED_VIEW: { type: 'view', materialized: true },
    // The proto enum can arrive as a number depending on how the client is configured
    '1': { type: 'table' },
    '2': { type: 'view' },
    '3': { type: 'incremental' },
    '4': { type: 'view', materialized: true },
};

const nonEmpty = <T>(v: T[] | null | undefined): T[] | undefined => (v && v.length ? v : undefined);
const nonEmptyStr = (v: string | null | undefined): string | undefined => (v ? v : undefined);
const nonEmptyObj = <T extends object>(v: T | null | undefined): T | undefined => (v && Object.keys(v).length ? v : undefined);

function toTarget(t: ApiTarget | null | undefined): Target {
    return { database: t?.database ?? '', schema: t?.schema ?? '', name: t?.name ?? '' };
}

function toTargets(ts: ApiTarget[] | null | undefined): Target[] {
    return (ts ?? []).map(toTarget);
}

/** Drops keys whose value is undefined, so optional fields are absent (as in CLI output) rather than present-but-undefined. */
function compact<T extends object>(obj: T): T {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

function toActionDescriptor(d: ApiRelationDescriptor | null | undefined) {
    if (!d) { return undefined; }
    const columns: Column[] | undefined = nonEmpty(d.columns)?.map((c) => ({ path: c.path ?? [], description: c.description ?? '' }));
    const descriptor = compact({
        description: nonEmptyStr(d.description),
        columns,
        bigqueryLabels: nonEmptyObj(d.bigqueryLabels),
    });
    return Object.keys(descriptor).length ? descriptor : undefined;
}

function toTable(a: ApiCompilationResultAction): Table {
    const r = a.relation!;
    const inc = r.incrementalTableConfig;
    const relationType = RELATION_TYPES[String(r.relationType ?? 'TABLE')] ?? { type: 'table' };
    const isIncremental = relationType.type === 'incremental';

    const bigquery = compact({
        partitionBy: nonEmptyStr(r.partitionExpression),
        clusterBy: nonEmpty(r.clusterExpressions),
        updatePartitionFilter: isIncremental ? nonEmptyStr(inc?.updatePartitionFilter) : undefined,
        partitionExpirationDays: r.partitionExpirationDays || undefined,
        requirePartitionFilter: r.requirePartitionFilter || undefined,
        labels: nonEmptyObj(r.relationDescriptor?.bigqueryLabels),
        additionalOptions: nonEmptyObj(r.additionalOptions),
    });

    return compact({
        type: relationType.type,
        materialized: relationType.materialized,
        target: toTarget(a.target),
        canonicalTarget: toTarget(a.canonicalTarget),
        fileName: a.filePath ?? '',
        query: r.selectQuery ?? '',
        disabled: r.disabled ?? false,
        tags: r.tags ?? [],
        dependencyTargets: toTargets(r.dependencyTargets),
        preOps: nonEmpty(r.preOperations),
        postOps: nonEmpty(r.postOperations),
        incrementalQuery: isIncremental ? nonEmptyStr(inc?.incrementalSelectQuery) : undefined,
        incrementalPreOps: isIncremental ? nonEmpty(inc?.incrementalPreOperations) : undefined,
        incrementalPostOps: isIncremental ? nonEmpty(inc?.incrementalPostOperations) : undefined,
        uniqueKey: isIncremental ? nonEmpty(inc?.uniqueKeyParts) : undefined,
        protected: isIncremental ? (inc?.refreshDisabled ?? false) : undefined,
        bigquery: Object.keys(bigquery).length ? bigquery : undefined,
        actionDescriptor: toActionDescriptor(r.relationDescriptor),
    }) as unknown as Table;
}

function toAssertion(a: ApiCompilationResultAction): Assertion {
    const s = a.assertion!;
    return compact({
        target: toTarget(a.target),
        canonicalTarget: toTarget(a.canonicalTarget),
        fileName: a.filePath ?? '',
        query: s.selectQuery ?? '',
        tags: s.tags ?? [],
        dependencyTargets: toTargets(s.dependencyTargets),
        parentAction: s.parentAction ? toTarget(s.parentAction) : undefined,
        disabled: s.disabled || undefined,
        actionDescriptor: toActionDescriptor(s.relationDescriptor),
    }) as unknown as Assertion;
}

function toOperation(a: ApiCompilationResultAction): Operation {
    const o = a.operations!;
    return compact({
        target: toTarget(a.target),
        canonicalTarget: toTarget(a.canonicalTarget),
        fileName: a.filePath ?? '',
        queries: o.queries ?? [],
        hasOutput: o.hasOutput || undefined,
        tags: o.tags ?? [],
        dependencyTargets: toTargets(o.dependencyTargets),
        disabled: o.disabled || undefined,
        actionDescriptor: toActionDescriptor(o.relationDescriptor),
    }) as unknown as Operation;
}

function toDeclaration(a: ApiCompilationResultAction): Declarations {
    return compact({
        target: toTarget(a.target),
        canonicalTarget: toTarget(a.canonicalTarget),
        fileName: a.filePath ?? '',
        // The API does not expose declaration tags
        tags: [],
        dependencyTargets: [],
        actionDescriptor: toActionDescriptor(a.declaration?.relationDescriptor),
    }) as unknown as Declarations;
}

function toNotebook(a: ApiCompilationResultAction): Notebook {
    const n = a.notebook!;
    return {
        target: toTarget(a.target),
        canonicalTarget: toTarget(a.canonicalTarget),
        fileName: a.filePath ?? '',
        tags: n.tags ?? [],
        notebookContents: n.contents ?? '',
        dependencyTargets: toTargets(n.dependencyTargets),
    };
}

function toProjectConfig(result: ApiCompilationResult): ProjectConfig {
    const c = result.codeCompilationConfig ?? {};
    const notebookOptions = c.defaultNotebookRuntimeOptions;
    return compact({
        warehouse: 'bigquery',
        defaultDatabase: c.defaultDatabase ?? '',
        defaultSchema: c.defaultSchema ?? '',
        assertionSchema: c.assertionSchema ?? '',
        defaultLocation: c.defaultLocation ?? '',
        tablePrefix: c.tablePrefix ?? '',
        vars: c.vars ?? {},
        databaseSuffix: nonEmptyStr(c.databaseSuffix),
        schemaSuffix: nonEmptyStr(c.schemaSuffix),
        builtinAssertionNamePrefix: nonEmptyStr(c.builtinAssertionNamePrefix),
        defaultNotebookRuntimeOptions: notebookOptions ? compact({
            aiPlatformNotebookRuntimeTemplate: nonEmptyStr(notebookOptions.aiPlatformNotebookRuntimeTemplate),
            outputBucket: nonEmptyStr(notebookOptions.gcsOutputBucket),
        }) : undefined,
    });
}

export function toDataformCompiledJson(result: ApiCompilationResult, actions: ApiCompilationResultAction[]): DataformCompiledJson {
    const compiled: DataformCompiledJson = {
        tables: [],
        assertions: [],
        operations: [],
        declarations: [],
        notebooks: [],
        tests: [],
        targets: [],
        projectConfig: toProjectConfig(result),
        graphErrors: {
            compilationErrors: (result.compilationErrors ?? []).map((e) => ({
                fileName: e.path ?? '',
                message: e.message ?? '',
                stack: e.stack ?? '',
            })),
        },
        dataformCoreVersion: result.dataformCoreVersion ?? undefined,
    };

    for (const action of actions) {
        if (action.relation) {
            compiled.tables.push(toTable(action));
        } else if (action.assertion) {
            compiled.assertions.push(toAssertion(action));
        } else if (action.operations) {
            compiled.operations.push(toOperation(action));
        } else if (action.declaration) {
            compiled.declarations.push(toDeclaration(action));
        } else if (action.notebook) {
            compiled.notebooks.push(toNotebook(action));
        } else {
            continue; // e.g. data preparations, which the extension does not surface
        }
        compiled.targets.push(toTarget(action.target));
    }

    return compiled;
}
