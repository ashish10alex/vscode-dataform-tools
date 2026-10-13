import path from 'path';
import { Action, ActionId, CompiledGraph, Kind, Target, buildCompiledGraph, madeUpTarget, slashPath, targetId, titledSections } from '../../shared/compiledGraph';

/*
 * A dbt manifest as a Compiled Graph. dbt-core 1.8 and later and dbt v2 both write manifest schema v12, so there is
 * one reader. It is a port of xf's (internal/backend/dbt/manifest.go), with the Kinds, made-up Targets and SQL
 * sections of the extension's Compiled Graph. Nothing here imports `vscode`, and nothing here reads a file: see
 * manifest.ts for that.
 */

/** The part of a manifest's resource that is read. A resource type has only some of these; dbt writes null for the rest */
interface ManifestNode {
    unique_id: string;
    resource_type: string;
    name: string;
    package_name?: string | null;
    source_name?: string | null;
    /** A number or a string, as the YAML had it */
    version?: string | number | null;
    latest_version?: string | number | null;
    fqn?: string[] | null;
    database?: string | null;
    schema?: string | null;
    alias?: string | null;
    identifier?: string | null;
    original_file_path?: string | null;
    description?: string | null;
    tags?: string[] | null;
    raw_code?: string | null;
    compiled_code?: string | null;
    url?: string | null;
    attached_node?: string | null;
    /** Of a generic test: the column it was declared under, when it was declared under one */
    column_name?: string | null;
    /** Of a generic test: the test it is an instance of, e.g. `not_null` */
    test_metadata?: { name?: string | null } | null;
    /** In the order the YAML lists them */
    columns?: Record<string, { name: string; description?: string | null }> | null;
    depends_on?: { nodes?: string[] | null } | null;
    config?: {
        materialized?: string | null;
        'pre-hook'?: Array<{ sql: string }> | null;
        'post-hook'?: Array<{ sql: string }> | null;
        partition_by?: { field?: string | null; data_type?: string | null; granularity?: string | null } | null;
    } | null;
}

interface ManifestMacro {
    name: string;
    package_name: string;
    original_file_path: string;
    description?: string | null;
    arguments?: Array<{ name: string; type?: string | null; description?: string | null }> | null;
}

/** The part of dbt's `target/manifest.json` that is read */
export interface DbtManifest {
    metadata: { dbt_version?: string; project_name?: string | null; adapter_type?: string | null };
    nodes?: Record<string, ManifestNode> | null;
    sources?: Record<string, ManifestNode> | null;
    exposures?: Record<string, ManifestNode> | null;
    unit_tests?: Record<string, ManifestNode> | null;
    /** Each disabled resource, under its ID. dbt lists every disabled definition of it; the first is taken */
    disabled?: Record<string, ManifestNode[]> | null;
    macros?: Record<string, ManifestMacro> | null;
}

/** What dbt calls an action it can select, `ref()` or `source()` */
export interface DbtName {
    /** The name `dbt build --select` takes: its fqn joined with dots, which names exactly this action in both engines */
    qualifiedName: string;
    package: string;
    name: string;
    /** Of a versioned model */
    version?: string;
    /** The model is the latest of its versions: the one a `ref()` without a version gives. Set only with `version` */
    latest?: boolean;
    /** Of a source: the name of the group of tables it is in, the first argument of `source()` */
    sourceName?: string;
    /** Of a generic test: what its YAML file declares it by, since no entry there has its name */
    test?: DbtTestDeclaration;
}

/** How a YAML file declares a generic test: the test's own name, under a model or source table and maybe a column of it */
export interface DbtTestDeclaration {
    /** As the YAML writes it, e.g. `not_null` */
    name: string;
    /** The `name:` of the model, seed, snapshot or source table it is declared under */
    under?: string;
    column?: string;
}

/** A macro or generic test of the Project or of a package it installed */
export interface DbtMacro {
    name: string;
    package: string;
    /** Relative to the Project root with forward slashes */
    fileName: string;
    description?: string;
    arguments: Array<{ name: string; type?: string; description?: string }>;
}

/**
 * What the dbt Backend keeps of a manifest beside the Compiled Graph, private to it: nothing Backend-neutral reads
 * this. The run commands and the `editor` part (editor.ts) read the names and macros.
 */
export interface DbtProjectData {
    dbtVersion: string;
    projectName: string;
    /** The warehouse the Project's profile is for, e.g. "bigquery". Unset when the manifest does not say */
    adapterType?: string;
    /** By action. An exposure, an analysis and an on-run hook have none: dbt cannot select them */
    names: Record<ActionId, DbtName>;
    /** Sorted by package, then name. dbt's own macros are left out: hundreds that nobody edits */
    macros: DbtMacro[];
}

export interface DbtGraph {
    graph: CompiledGraph;
    dbt: DbtProjectData;
}

/** Where `dbt deps` installs packages, each in a directory named after it. A Project can move it (`packages-install-path`), which is not followed */
const PACKAGES_DIR = 'dbt_packages';

function kindOf(node: ManifestNode): Kind | undefined {
    switch (node.resource_type) {
        case 'model':
            switch (node.config?.materialized) {
                case 'view':
                    return 'view';
                case 'incremental':
                    return 'incremental';
                case 'ephemeral':
                    return 'ephemeral';
                case 'materialized_view':
                    return 'materialized view';
                default:
                    return 'table';
            }
        case 'seed':
            return 'seed';
        case 'snapshot':
            return 'snapshot';
        case 'test':
            return 'test';
        case 'unit_test':
            return 'unit test';
        case 'analysis':
            return 'analysis';
        // An on-run-start or on-run-end hook of the Project
        case 'operation':
            return 'operation';
        case 'source':
            return 'source';
        case 'exposure':
            return 'exposure';
        // What the panel does not show, such as a semantic model or a metric
        default:
            return undefined;
    }
}

/**
 * Where the action's table is. An exposure, a unit test and an analysis build nothing, so theirs is made up from
 * the Kind and the name. A data test keeps the place dbt gives it, where it stores failures when asked to.
 */
function targetOf(node: ManifestNode, kind: Kind): Target {
    if (kind === 'exposure' || kind === 'unit test' || kind === 'analysis') {
        return madeUpTarget(kind, node.name);
    }
    const name = (kind === 'source' ? node.identifier : node.alias) || node.name;
    return { database: node.database ?? '', schema: node.schema ?? '', name };
}

/** The Kinds whose compiled query is a SELECT that BigQuery can plan: all that have SQL but an on-run hook */
function isDryRun(kind: Kind): boolean {
    return kind !== 'operation';
}

/**
 * An action's SQL: its hooks as written, since the manifest never has them compiled, around its one query. The query
 * is the compiled one, and is dry-run, when this compile compiled the action; otherwise it is the query as written.
 * A seed, a source, an exposure and a unit test have no SQL.
 */
function sectionsOf(node: ManifestNode, kind: Kind): Action['sections'] {
    if (kind === 'seed' || kind === 'source' || kind === 'exposure' || kind === 'unit test') {
        return [];
    }
    const hooks = (title: string, list: Array<{ sql: string }> | null | undefined) =>
        titledSections(title, (list ?? []).map((hook) => hook.sql), { compiled: false, dryRun: [] });
    const title = kind === 'operation' ? 'operation' : 'query';
    const query = node.compiled_code
        ? titledSections(title, [node.compiled_code], { compiled: true, dryRun: isDryRun(kind) ? [title] : [] })
        : titledSections(title, [node.raw_code ?? ''], { compiled: false, dryRun: [] });
    return [...hooks('pre-hook', node.config?.['pre-hook']), ...query, ...hooks('post-hook', node.config?.['post-hook'])];
}

/** The reader of one manifest */
class Reader {
    private readonly projectName: string;

    constructor(private readonly manifest: DbtManifest) {
        this.projectName = manifest.metadata.project_name ?? '';
    }

    /** A resource's file relative to the Project root: dbt gives a package's relative to the package */
    fileName(packageName: string | null | undefined, file: string | null | undefined): string {
        if (!file) {
            return '';
        }
        const normal = path.posix.normalize(slashPath(file));
        if (!packageName || !this.projectName || packageName === this.projectName) {
            return normal;
        }
        return path.posix.join(PACKAGES_DIR, packageName, normal);
    }

    /** Each resource the panel shows, with the Target its action has. Sorted, so that which action wins a Target two of them share does not depend on the engine */
    entries(): Array<{ node: ManifestNode; kind: Kind; target: Target; disabled: boolean }> {
        const entries: Array<{ node: ManifestNode; kind: Kind; target: Target; disabled: boolean }> = [];
        const add = (nodes: Record<string, ManifestNode | undefined> | null | undefined, disabled: boolean) => {
            for (const id of Object.keys(nodes ?? {}).sort()) {
                const node = nodes![id];
                const kind = node && kindOf(node);
                if (node && kind) {
                    entries.push({ node, kind, target: targetOf(node, kind), disabled });
                }
            }
        };
        add(this.manifest.nodes, false);
        add(this.manifest.sources, false);
        add(this.manifest.exposures, false);
        add(this.manifest.unit_tests, false);
        add(Object.fromEntries(Object.entries(this.manifest.disabled ?? {}).map(([id, definitions]) => [id, definitions?.[0]])), true);
        return entries;
    }

    read(): DbtGraph {
        const entries = this.entries();
        // The first with an ID wins, as its action does: a disabled definition comes after the one dbt builds
        const targets = new Map<string, Target>();
        for (const { node, target } of entries) {
            if (!targets.has(node.unique_id)) {
                targets.set(node.unique_id, target);
            }
        }

        const names: Record<ActionId, DbtName> = {};
        const actions = entries.map(({ node, kind, target, disabled }) => {
            const action = this.action(node, kind, target, disabled, targets);
            const name = nameOf(node);
            if (name && node.test_metadata?.name) {
                const attached = node.attached_node ? (this.manifest.nodes?.[node.attached_node] ?? this.manifest.sources?.[node.attached_node]) : undefined;
                name.test = {
                    name: node.test_metadata.name,
                    ...(attached ? { under: attached.name } : {}),
                    ...(node.column_name ? { column: node.column_name } : {}),
                };
            }
            if (name && !Object.hasOwn(names, action.id)) {
                names[action.id] = name;
            }
            return action;
        });
        return {
            graph: buildCompiledGraph(actions),
            dbt: {
                dbtVersion: this.manifest.metadata.dbt_version ?? '',
                projectName: this.projectName,
                ...(this.manifest.metadata.adapter_type ? { adapterType: this.manifest.metadata.adapter_type } : {}),
                names,
                macros: this.macros(),
            },
        };
    }

    private action(node: ManifestNode, kind: Kind, target: Target, disabled: boolean, targets: Map<string, Target>): Action {
        const sections = sectionsOf(node, kind);
        const hasQuery = !(kind === 'seed' || kind === 'source' || kind === 'exposure' || kind === 'unit test');
        const action: Action = {
            id: targetId(target),
            target,
            kind,
            fileName: this.fileName(node.package_name, node.original_file_path),
            tags: node.tags ?? [],
            sections,
            // An action with a query has its SQL only when this compile compiled it: a parse compiles nothing, and
            // a compile compiles what it was asked to
            sqlPresent: !hasQuery || !!node.compiled_code,
            dependencyTargets: (node.depends_on?.nodes ?? []).flatMap((id) => targets.get(id) ?? []),
        };
        if (disabled) {
            action.disabled = true;
        }
        // dbt runs a hook with every run, and never on its own
        if (disabled || kind === 'operation') {
            action.noRun = true;
        }
        const description = node.description || node.url;
        if (description) {
            action.description = description;
        }
        const partition = node.config?.partition_by;
        if (partition?.field) {
            // As BigQuery says it of the built table: dbt partitions by day unless told otherwise
            action.partition = `${partition.field} (${partition.data_type === 'int64' ? 'range' : (partition.granularity ?? 'day').toLowerCase()})`;
        }
        // A column listed only to test it documents nothing
        const columns = Object.values(node.columns ?? {}).filter((column) => column.description);
        if (columns.length > 0) {
            action.columns = columns.map((column) => ({ path: [column.name], description: column.description! }));
        }
        // A data test names the model it is attached to; a unit test reads only the model it tests
        const parent = node.attached_node || (kind === 'unit test' ? node.depends_on?.nodes?.[0] : undefined);
        const parentTarget = parent ? targets.get(parent) : undefined;
        if (parentTarget) {
            action.parent = parentTarget;
        }
        return action;
    }

    private macros(): DbtMacro[] {
        const own = new Set(['dbt', `dbt_${this.manifest.metadata.adapter_type ?? 'bigquery'}`]);
        return Object.values(this.manifest.macros ?? {})
            .filter((macro) => !own.has(macro.package_name))
            .map((macro) => ({
                name: macro.name,
                package: macro.package_name,
                fileName: this.fileName(macro.package_name, macro.original_file_path),
                ...(macro.description ? { description: macro.description } : {}),
                arguments: (macro.arguments ?? []).map((argument) => ({
                    name: argument.name,
                    ...(argument.type ? { type: argument.type } : {}),
                    ...(argument.description ? { description: argument.description } : {}),
                })),
            }))
            .sort((a, b) => compare(a.package, b.package) || compare(a.name, b.name));
    }
}

// By code unit, not by locale, so the order is the same on every machine
function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** Set for what dbt can select: a model, seed, snapshot, source, data test or unit test */
function nameOf(node: ManifestNode): DbtName | undefined {
    switch (node.resource_type) {
        case 'model':
        case 'seed':
        case 'snapshot':
        case 'source':
        case 'test':
        case 'unit_test':
            break;
        default:
            return undefined;
    }
    const name: DbtName = { qualifiedName: (node.fqn ?? []).join('.'), package: node.package_name ?? '', name: node.name };
    if (node.version !== null && node.version !== undefined && node.version !== '') {
        name.version = String(node.version);
        name.latest = String(node.latest_version ?? '') === name.version;
    }
    if (node.source_name) {
        name.sourceName = node.source_name;
    }
    return name;
}

/** The Compiled Graph of a manifest, and what the dbt Backend keeps beside it */
export function buildDbtGraph(manifest: DbtManifest): DbtGraph {
    return new Reader(manifest).read();
}

/** The action `buildDbtGraph` gives each resource that is not disabled, by dbt's ID of the resource */
export function dbtActionIds(manifest: DbtManifest): Map<string, ActionId> {
    return new Map(new Reader(manifest).entries().filter((entry) => !entry.disabled).map(({ node, target }) => [node.unique_id, targetId(target)]));
}
