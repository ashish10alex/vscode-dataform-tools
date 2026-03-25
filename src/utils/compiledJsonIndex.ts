import { logger } from '../logger';
import { DataformCompiledJson, Table, Assertion, Operation, Notebook } from '../types';

export let declarationsAndTargets: string[] = [];

// Cache maps for O(1) lookups
global.FILE_NODE_MAP = new Map<string, (Table | Assertion | Operation | Notebook)[]>();
global.TARGET_DEPENDENTS_MAP = new Map<string, import('../types').Target[]>();
global.TARGET_NAME_MAP = new Map<string, (Table | Assertion | Operation | Notebook)[]>();

export function clearIndices() {
    FILE_NODE_MAP.clear();
    TARGET_DEPENDENTS_MAP.clear();
    TARGET_NAME_MAP.clear();
}

export function buildIndices(compiledJson: DataformCompiledJson) {
    clearIndices();

    const { tables, assertions, operations, notebooks } = compiledJson;

    // Helper to add node to FILE_NODE_MAP
    const addNodeToFileMap = (node: Table | Assertion | Operation | Notebook) => {
        const fileName = node.fileName;
        if (!FILE_NODE_MAP.has(fileName)) {
            FILE_NODE_MAP.set(fileName, []);
        }
        FILE_NODE_MAP.get(fileName)?.push(node);
    };

    // Helper to add dependencies to TARGET_DEPENDENTS_MAP
    // We map: DependencyTarget -> [DependentNodes]
    // The 'node' depends on 'dependencyTarget'.
    // So 'node.target' is a dependent of 'dependencyTarget'.
    const addDependenciesToMap = (node: Table | Assertion | Operation | Notebook) => {
        if (node.dependencyTargets) {
            node.dependencyTargets.forEach(depTarget => {
                const depKey = `${depTarget.database}.${depTarget.schema}.${depTarget.name}`;
                if (!TARGET_DEPENDENTS_MAP.has(depKey)) {
                    TARGET_DEPENDENTS_MAP.set(depKey, []);
                }
                // Avoid duplicates if possible, though strict set check might be overkill for now
                // We push the *node's target* as the dependent
                 TARGET_DEPENDENTS_MAP.get(depKey)?.push(node.target);
            });
        }
    };

    // Helper to add nodes to TARGET_NAME_MAP for text-based ref/hover resolution
    const addNodeToTargetNameMap = (node: Table | Assertion | Operation | Notebook) => {
        if (node.target && node.target.name) {
            const tName = node.target.name;
            if (!TARGET_NAME_MAP.has(tName)) {
                TARGET_NAME_MAP.set(tName, []);
            }
            TARGET_NAME_MAP.get(tName)?.push(node);
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

    logger.debug(`Built indices: ${FILE_NODE_MAP.size} files, ${TARGET_DEPENDENTS_MAP.size} targets with dependents`);
}
