import { logger } from '../logger';
import { DataformCompiledJson, Table, Assertion, Operation, Notebook, Target } from '../types';

export let declarationsAndTargets: string[] = [];

type CompiledNode = Table | Assertion | Operation | Notebook;

/** Lookups over a compiled graph, built once per compile */
export interface CompiledIndices {
    /** Actions by the file that defines them */
    fileNodeMap: Map<string, CompiledNode[]>;
    /** For a target (`database.schema.name`), the targets of the actions that depend on it */
    targetDependentsMap: Map<string, Target[]>;
    /** Actions by their target's name alone, for resolving a ref from its text */
    targetNameMap: Map<string, CompiledNode[]>;
}

export function emptyIndices(): CompiledIndices {
    return { fileNodeMap: new Map(), targetDependentsMap: new Map(), targetNameMap: new Map() };
}

/** Makes `indices` the ones the window-wide lookups read */
export function useIndices(indices: CompiledIndices) {
    global.FILE_NODE_MAP = indices.fileNodeMap;
    global.TARGET_DEPENDENTS_MAP = indices.targetDependentsMap;
    global.TARGET_NAME_MAP = indices.targetNameMap;
}

// Cache maps for O(1) lookups
useIndices(emptyIndices());

export function clearIndices() {
    declarationsAndTargets = [];
    useIndices(emptyIndices());
}

export function buildIndices(compiledJson: DataformCompiledJson) {
    useIndices(computeIndices(compiledJson));
    logger.debug(`Built indices: ${global.FILE_NODE_MAP.size} files, ${global.TARGET_DEPENDENTS_MAP.size} targets with dependents`);
}

/** Builds the lookups for a compiled graph. Fills in each action's `type` on the way, as the rest of the extension expects */
export function computeIndices(compiledJson: DataformCompiledJson): CompiledIndices {
    const newFileNodeMap = new Map<string, (Table | Assertion | Operation | Notebook)[]>();
    const newTargetDependentsMap = new Map<string, Target[]>();
    const newTargetNameMap = new Map<string, (Table | Assertion | Operation | Notebook)[]>();

    const { tables, assertions, operations, notebooks } = compiledJson;

    // Helper to add node to newFileNodeMap
    const addNodeToFileMap = (node: Table | Assertion | Operation | Notebook) => {
        const fileName = node.fileName;
        if (!newFileNodeMap.has(fileName)) {
            newFileNodeMap.set(fileName, []);
        }
        newFileNodeMap.get(fileName)?.push(node);
    };

    // Helper to add dependencies to newTargetDependentsMap
    // We map: DependencyTarget -> [DependentNodes]
    // The 'node' depends on 'dependencyTarget'.
    // So 'node.target' is a dependent of 'dependencyTarget'.
    const addDependenciesToMap = (node: Table | Assertion | Operation | Notebook) => {
        if (node.dependencyTargets) {
            node.dependencyTargets.forEach(depTarget => {
                const depKey = `${depTarget.database}.${depTarget.schema}.${depTarget.name}`;
                if (!newTargetDependentsMap.has(depKey)) {
                    newTargetDependentsMap.set(depKey, []);
                }
                // Avoid duplicates if possible, though strict set check might be overkill for now
                // We push the *node's target* as the dependent
                 newTargetDependentsMap.get(depKey)?.push(node.target);
            });
        }
    };

    // Helper to add nodes to newTargetNameMap for text-based ref/hover resolution
    const addNodeToTargetNameMap = (node: Table | Assertion | Operation | Notebook) => {
        if (node.target && node.target.name) {
            const tName = node.target.name;
            if (!newTargetNameMap.has(tName)) {
                newTargetNameMap.set(tName, []);
            }
            newTargetNameMap.get(tName)?.push(node);
        }
    };

    tables?.forEach(table => {
        if (!table.type) {
            table.type = 'table';
        }
        addNodeToFileMap(table);
        addDependenciesToMap(table);
        addNodeToTargetNameMap(table);
    });

    assertions?.forEach(assertion => {
        assertion.type = 'assertion';
        addNodeToFileMap(assertion);
        addDependenciesToMap(assertion);
        addNodeToTargetNameMap(assertion);
    });

    operations?.forEach(operation => {
        operation.type = 'operations';
        addNodeToFileMap(operation);
        addDependenciesToMap(operation);
        addNodeToTargetNameMap(operation);
    });

    notebooks?.forEach(notebook => {
        (notebook as any).type = 'notebook';
        addNodeToFileMap(notebook);
        addDependenciesToMap(notebook);
        addNodeToTargetNameMap(notebook);
    });

    compiledJson.tests?.forEach(test => {
        (test as any).type = 'test';
        addNodeToFileMap(test as any);
    });

    return { fileNodeMap: newFileNodeMap, targetDependentsMap: newTargetDependentsMap, targetNameMap: newTargetNameMap };
}
