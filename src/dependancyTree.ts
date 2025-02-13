import {
    Table,
    Operation,
    Assertion,
    Declarations,
    Target,
    DependancyTreeMetadata,
    DeclarationsLegendMetadata
} from './types';

import { getWorkspaceFolder, runCompilation } from './utils';

interface NodeMap {
    [key: string]: DependencyNode;
}

interface DependencyNode {
    _name: string;
    _fileName: string;
    _schema: string;
    _schema_idx?: number;
    _tags?: string[];
    _deps: string[];
    _dependents: string[];
    _missing?: boolean;
    _cyclic?: boolean;
    _maxDepth?: boolean;
    target: Target;
    type?: string;
}

export class DependencyGraph {
    private upstream: NodeMap = {};
    private downstream: NodeMap = {};
    private missingNodes: Set<string> = new Set();
    private schemaDict: { [key: string]: number } = {};
    private schemaIdx: number = 1; // 0 reserved for dataform pipeline nodes

    constructor(
        tables: Table[] = [],
        operations: Operation[] = [],
        assertions: Assertion[] = [],
        declarations: Declarations[] = []
    ) {
        this.buildGraph(tables, operations, assertions, declarations);
    }

    private getNodeKey(target: Target): string {
        return `${target.database}.${target.schema}.${target.name}`;
    }

    private getTypeIndex(type: string | undefined): number {
        // Map Dataform types to indices
        switch (type) {
            case 'table': return 1;
            case 'view': return 2;
            case 'test': return 3;
            case 'incremental': return 4;
            case 'assertion': return 5;
            case 'operations': return 6;
            case 'declaration': return 7;
            default: return 0; // Generated/pipeline nodes
        }
    }

    private createNode(
        item: Table | Operation | Assertion | Declarations,
        isUpstream: boolean = true
    ): DependencyNode {
        const base = {
            _name: this.getNodeKey(item.target),
            _fileName: item.fileName,
            _schema: item.target.schema,
            target: item.target,
            type: 'type' in item ? item.type : undefined,
            _tags: 'tags' in item ? item.tags : undefined,
            _deps: [],
            _dependents: []
        };

        // For compatibility with existing visualization
        if (isUpstream) {
            return {
                ...base,
                _schema_idx: this.getTypeIndex(base.type)
            };
        }

        return base;
    }

    private createMissingNode(target: Target, isUpstream: boolean = true): DependencyNode {
        const base = {
            _name: this.getNodeKey(target),
            _fileName: "",
            _schema: target.schema,
            target: target,
            _missing: true,
            _deps: [],
            _dependents: []
        };

        if (isUpstream) {
            return {
                ...base,
                _schema_idx: 0  // Missing nodes are treated as generated/pipeline nodes
            };
        }

        return base;
    }

    private buildGraph(
        tables: Table[],
        operations: Operation[],
        assertions: Assertion[],
        declarations: Declarations[]
    ): void {
        const allItems = [...tables, ...operations, ...assertions, ...declarations];

        // First pass: Create all nodes in both directions
        for (const item of allItems) {
            const nodeKey = this.getNodeKey(item.target);
            if (!this.upstream[nodeKey]) {
                this.upstream[nodeKey] = this.createNode(item, true);
            }
            if (!this.downstream[nodeKey]) {
                this.downstream[nodeKey] = this.createNode(item, false);
            }
        }

        // Second pass: Build relationships
        for (const item of allItems) {
            const nodeKey = this.getNodeKey(item.target);

            if (item.dependencyTargets) {
                for (const depTarget of item.dependencyTargets) {
                    const depKey = this.getNodeKey(depTarget);

                    // Handle missing nodes
                    if (!this.upstream[depKey]) {
                        this.upstream[depKey] = this.createMissingNode(depTarget, true);
                        this.missingNodes.add(depKey);
                    }
                    if (!this.downstream[depKey]) {
                        this.downstream[depKey] = this.createMissingNode(depTarget, false);
                    }

                    // Build upstream relationships
                    if (!this.upstream[nodeKey]._deps.includes(depKey)) {
                        this.upstream[nodeKey]._deps.push(depKey);
                    }

                    // Build downstream relationships
                    if (!this.downstream[depKey]._dependents.includes(nodeKey)) {
                        this.downstream[depKey]._dependents.push(nodeKey);
                    }
                }
            }
        }
    }

    public generateMetadata(direction: 'upstream' | 'downstream' = 'upstream'): {
        metadata: DependancyTreeMetadata[],
        legendMetadata: DeclarationsLegendMetadata[]
    } {
        const nodeMap = direction === 'upstream' ? this.upstream : this.downstream;
        const metadata: DependancyTreeMetadata[] = [];

        // Create fixed legend for all Dataform types
        const legendMetadata: DeclarationsLegendMetadata[] = [
            { _schema: "Generated/Pipeline", _schema_idx: 0 },
            { _schema: "Table", _schema_idx: 1 },
            { _schema: "View", _schema_idx: 2 },
            { _schema: "Test", _schema_idx: 3 },
            { _schema: "Incremental", _schema_idx: 4 },
            { _schema: "Assertion", _schema_idx: 5 },
            { _schema: "Operations", _schema_idx: 6 },
            { _schema: "Declaration", _schema_idx: 7 }
        ];

        // Convert nodes to metadata format
        for (const [key, node] of Object.entries(nodeMap)) {
            const metadataNode: DependancyTreeMetadata = {
                _name: node._name,
                _fileName: node._fileName,
                _schema: node._schema,
                _schema_idx: node._schema_idx || 0,
                _tags: node._tags || []
            };

            const relationships = direction === 'upstream' ? node._deps : node._dependents;
            if (relationships.length > 0) {
                metadataNode._deps = relationships;
            }

            metadata.push(metadataNode);
        }

        return { metadata, legendMetadata };
    }
}

export async function generateDependancyTreeMetadata(): Promise<{
    dependancyTreeMetadata: DependancyTreeMetadata[],
    declarationsLegendMetadata: DeclarationsLegendMetadata[]
} | undefined> {
    if (!CACHED_COMPILED_DATAFORM_JSON) {
        const workspaceFolder = getWorkspaceFolder();
        if (!workspaceFolder) return;

        const { dataformCompiledJson, errors } = await runCompilation(workspaceFolder);
        if (dataformCompiledJson) {
            CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
        }
    }

    if (!CACHED_COMPILED_DATAFORM_JSON) {
        return {
            dependancyTreeMetadata: [],
            declarationsLegendMetadata: []
        };
    }

    const graph = new DependencyGraph(
        CACHED_COMPILED_DATAFORM_JSON.tables || [],
        CACHED_COMPILED_DATAFORM_JSON.operations || [],
        CACHED_COMPILED_DATAFORM_JSON.assertions || [],
        CACHED_COMPILED_DATAFORM_JSON.declarations || []
    );

    const { metadata, legendMetadata } = graph.generateMetadata('upstream');

    return {
        dependancyTreeMetadata: metadata,
        declarationsLegendMetadata: legendMetadata
    };
}

export function populateDependencyTree(
    type: string,
    structs: (Table | Operation | Assertion | Declarations)[],
    dependancyTreeMetadata: DependancyTreeMetadata[],
    schemaDict: any,
    schemaIdx: number
): {
    dependancyTreeMetadata: DependancyTreeMetadata[],
    schemaIdx: number,
    declarationsLegendMetadata: DeclarationsLegendMetadata[]
} {
    const graph = new DependencyGraph(
        type === 'tables' ? structs as Table[] : [],
        type === 'operations' ? structs as Operation[] : [],
        type === 'assertions' ? structs as Assertion[] : [],
        type === 'declarations' ? structs as Declarations[] : []
    );

    const { metadata, legendMetadata } = graph.generateMetadata('upstream');

    return {
        dependancyTreeMetadata: metadata,
        schemaIdx: legendMetadata.length - 1, // Adjust for 0-based index
        declarationsLegendMetadata: legendMetadata
    };
}