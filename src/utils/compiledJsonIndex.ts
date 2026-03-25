import { logger } from '../logger';
import { DataformCompiledJson, Table, Assertion, Operation, Notebook } from '../types';

export let declarationsAndTargets: string[] = [];

// Cache maps for O(1) lookups
global.FILE_NODE_MAP = new Map<string, (Table | Assertion | Operation | Notebook)[]>();
global.TARGET_DEPENDENTS_MAP = new Map<string, import('../types').Target[]>();
global.TARGET_NAME_MAP = new Map<string, (Table | Assertion | Operation | Notebook)[]>();

export function clearIndices() {
    global.FILE_NODE_MAP = new Map<string, (Table | Assertion | Operation | Notebook)[]>();
    global.TARGET_DEPENDENTS_MAP = new Map<string, import('../types').Target[]>();
    global.TARGET_NAME_MAP = new Map<string, (Table | Assertion | Operation | Notebook)[]>();
}

export function buildIndices(compiledJson: DataformCompiledJson) {
    const newFileNodeMap = new Map<string, (Table | Assertion | Operation | Notebook)[]>();
    const newTargetDependentsMap = new Map<string, import('../types').Target[]>();
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

    // Atomic replacement of global cache maps
    global.FILE_NODE_MAP = newFileNodeMap;
    global.TARGET_DEPENDENTS_MAP = newTargetDependentsMap;
    global.TARGET_NAME_MAP = newTargetNameMap;

    logger.debug(`Built indices: ${global.FILE_NODE_MAP.size} files, ${global.TARGET_DEPENDENTS_MAP.size} targets with dependents`);
}
