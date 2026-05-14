import { Assertion, DataformCompiledJson, Declarations, DependancyModelMetadata, Operation, Table } from "../types";

export interface GraphEdge {
    id: string;
    source: string;
    target: string;
    tags: string[];
}

export interface BuildDependencyGraphOptions {
    /**
     * Optional identifier used to locate a focus node. Matched against
     * `struct.fileName` (relative path used by the VS Code extension),
     * then the fully-qualified `database.schema.name`, then `target.name`.
     */
    focusIdentifier?: string;
}

export interface BuildDependencyGraphResult {
    nodes: DependancyModelMetadata[];
    edges: GraphEdge[];
    datasetColorMap: Map<string, string>;
    /** Id of the focus node, or null when no match (or no identifier supplied). */
    focusNodeId: string | null;
}

const datasetColors = [
    "#3B82F6", // Blue
    "#EF4444", // Soft Red
    "#10B981", // Emerald
    "#F59E0B", // Amber
    "#8B5CF6", // Violet
    "#EC4899", // Pink
    "#06B6D4", // Cyan
    "#F97316", // Orange
    "#6366F1", // Indigo
    "#14B8A6", // Teal
    "#84CC16", // Lime
    "#F43F5E", // Rose
    "#64748B", // Slate
    "#D946EF", // Fuchsia
    "#0EA5E9", // Sky Blue
    "#22C55E", // Green
    "#EAB308", // Yellow
    "#A855F7", // Purple
    "#FB923C", // Light Orange
    "#38BDF8"  // Light Sky Blue
];

type StructType = "tables" | "assertions" | "operations" | "declarations";
type AnyStruct = Table | Operation | Assertion | Declarations;

interface PopulateState {
    nodes: DependancyModelMetadata[];
    edges: GraphEdge[];
    modelNameToIdx: Map<string, number>;
    datasetColorMap: Map<string, string>;
    modelIdx: number;
    focusNodeId: string | null;
}

function matchesFocus(struct: AnyStruct, fullTableName: string, focusIdentifier: string): boolean {
    return (
        struct.fileName === focusIdentifier ||
        fullTableName === focusIdentifier ||
        struct.target.name === focusIdentifier
    );
}

function populate(type: StructType, structs: AnyStruct[], state: PopulateState, focusIdentifier: string | undefined) {
    const isExternalSource = type === "declarations";

    for (let i = 0; i < structs.length; i++) {
        const struct = structs[i];
        const fullTableName = `${struct.target.database}.${struct.target.schema}.${struct.target.name}`;
        const dataset = struct.target.schema;

        // Only seed dataset colors from declarations, matching prior behavior.
        if (type === "declarations" && !state.datasetColorMap.has(dataset)) {
            state.datasetColorMap.set(dataset, datasetColors[i % datasetColors.length]);
        }

        let targetIdx: number;
        if (state.modelNameToIdx.has(fullTableName)) {
            targetIdx = state.modelNameToIdx.get(fullTableName)!;
        } else {
            targetIdx = state.modelIdx;
            state.modelNameToIdx.set(fullTableName, targetIdx);
            state.modelIdx++;
        }

        if (focusIdentifier && state.focusNodeId === null && matchesFocus(struct, fullTableName, focusIdentifier)) {
            state.focusNodeId = String(targetIdx);
        }

        const dependencies = struct.dependencyTargets;
        if (dependencies) {
            for (const dep of dependencies) {
                const depFullName = `${dep.database}.${dep.schema}.${dep.name}`;
                if (!state.modelNameToIdx.has(depFullName)) {
                    state.modelNameToIdx.set(depFullName, state.modelIdx);
                    state.modelIdx++;
                }
                const sourceIdx = state.modelNameToIdx.get(depFullName)!;
                state.edges.push({
                    id: `e${sourceIdx}-${targetIdx}`,
                    source: String(sourceIdx),
                    target: String(targetIdx),
                    tags: struct.tags,
                });
            }
        }

        state.nodes.push({
            id: String(targetIdx),
            type: "tableNode",
            data: {
                modelName: struct.target.name,
                datasetId: struct.target.schema,
                projectId: struct.target.database,
                type: (struct as Table | Assertion | Operation).type || type,
                tags: struct.tags,
                datasetColor: state.datasetColorMap.get(dataset) || "grey",
                fileName: struct.fileName,
                isExternalSource,
                fullTableName,
            },
        });
    }
}

/**
 * Pure transformation from a `dataform compile --json` payload into the
 * node/edge representation consumed by the dependency graph webview.
 *
 * No I/O, no VS Code APIs — safe to call from the extension, the CLI, or tests.
 */
export function buildDependencyGraph(
    compiled: DataformCompiledJson,
    options: BuildDependencyGraphOptions = {}
): BuildDependencyGraphResult {
    const state: PopulateState = {
        nodes: [],
        edges: [],
        modelNameToIdx: new Map(),
        datasetColorMap: new Map(),
        modelIdx: 0,
        focusNodeId: null,
    };

    const focusIdentifier = options.focusIdentifier || undefined;

    if (compiled.tables) { populate("tables", compiled.tables, state, focusIdentifier); }
    if (compiled.assertions) { populate("assertions", compiled.assertions, state, focusIdentifier); }
    if (compiled.operations) { populate("operations", compiled.operations, state, focusIdentifier); }
    if (compiled.declarations) { populate("declarations", compiled.declarations, state, focusIdentifier); }

    return {
        nodes: state.nodes,
        edges: state.edges,
        datasetColorMap: state.datasetColorMap,
        focusNodeId: state.focusNodeId,
    };
}
