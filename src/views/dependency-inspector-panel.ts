import * as vscode from 'vscode';
import { Uri } from 'vscode';
import { getNonce, formatBytes, getWorkspaceFolder, getOrCompileDataformJson } from '../utils';
import { queryDryRun } from '../bigqueryDryRun';
import { queryBigQuery } from '../bigqueryRunQuery';
import { DataformCompiledJson, Target, Table, Assertion, Operation } from '../types';

function getFullTableId(target: Target): string {
    return `${target.database}.${target.schema}.${target.name}`;
}

function getAllNodes(compiledJson: DataformCompiledJson) {
    return [
        ...(compiledJson.tables ?? []),
        ...(compiledJson.assertions ?? []),
        ...(compiledJson.operations ?? []),
    ] as (Table | Assertion | Operation)[];
}

/** Resolve the full table ID for the given source file path using compiled JSON. */
function getModelIdForFile(filePath: string, compiledJson: DataformCompiledJson): string | undefined {
    const nodes = getAllNodes(compiledJson);
    // FILE_NODE_MAP keys use the relative path stored in node.fileName
    const match = nodes.find(n => n.fileName && filePath.endsWith(n.fileName.replace(/^\//, '')));
    return match ? getFullTableId(match.target) : undefined;
}

export function createDependencyInspectorPanel(context: vscode.ExtensionContext, initialFilePath?: string): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
        'dependencyInspectorPanel',
        'Dependency Inspector',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [Uri.joinPath(context.extensionUri, 'dist')],
        }
    );

    panel.webview.html = getHtmlForWebview(panel.webview, context);

    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case 'appLoaded':
            case 'getModels': {
                let compiledJson: DataformCompiledJson | undefined = globalThis.CACHED_COMPILED_DATAFORM_JSON;
                if (!compiledJson) {
                    panel.webview.postMessage({ type: 'compiling', value: true });
                    const workspaceFolder = await getWorkspaceFolder();
                    if (!workspaceFolder) {
                        panel.webview.postMessage({
                            type: 'error',
                            value: 'No Dataform workspace found. Open a Dataform project folder first.',
                        });
                        return;
                    }
                    compiledJson = await getOrCompileDataformJson(workspaceFolder);
                    if (!compiledJson) {
                        panel.webview.postMessage({
                            type: 'error',
                            value: 'Compilation failed. Check that your Dataform project is valid.',
                        });
                        return;
                    }
                    panel.webview.postMessage({ type: 'compiling', value: false });
                }
                const models = getAllNodes(compiledJson).map(node => ({
                    fullId: getFullTableId(node.target),
                    name: node.target.name,
                    type: (node as any).type ?? 'table',
                }));
                const initialModelId = initialFilePath
                    ? getModelIdForFile(initialFilePath, compiledJson)
                    : undefined;
                panel.webview.postMessage({ type: 'models', value: models, initialModelId });
                return;
            }

            case 'fetchDependencies': {
                const modelFullId: string = message.value?.modelFullId ?? '';
                const maxDepth: number = Math.max(1, Math.min(message.value?.depth ?? 5, 20));
                const compiledJson: DataformCompiledJson | undefined = globalThis.CACHED_COMPILED_DATAFORM_JSON;
                if (!compiledJson) {
                    panel.webview.postMessage({
                        type: 'error',
                        value: 'No compiled Dataform JSON found.',
                    });
                    return;
                }

                // Build a fast lookup map: fullId → node, and a set of assertion IDs to exclude
                const allNodes = getAllNodes(compiledJson);
                const assertionIds = new Set<string>(
                    (compiledJson.assertions ?? []).map(a => getFullTableId(a.target))
                );
                const nodeMap = new Map<string, Table | Assertion | Operation>();
                for (const n of allNodes) {
                    nodeMap.set(getFullTableId(n.target), n);
                }

                // BFS up to maxDepth levels, deduplicating by fullId, skipping assertions
                const visited = new Set<string>([modelFullId]);
                const deps: { fullId: string; name: string; type: string; depth: number }[] = [];
                const edges: { source: string; target: string }[] = [];
                const queue: { fullId: string; depth: number }[] = [{ fullId: modelFullId, depth: 0 }];

                while (queue.length > 0) {
                    const { fullId, depth } = queue.shift()!;
                    if (depth >= maxDepth) { continue; }
                    const node = nodeMap.get(fullId);
                    if (!node) { continue; }

                    for (const depTarget of node.dependencyTargets ?? []) {
                        const depFullId = getFullTableId(depTarget);
                        if (assertionIds.has(depFullId)) { continue; }
                        // Always record the edge even if we've visited the node
                        edges.push({ source: fullId, target: depFullId });
                        if (visited.has(depFullId)) { continue; }
                        visited.add(depFullId);
                        const depNode = nodeMap.get(depFullId);
                        deps.push({
                            fullId: depFullId,
                            name: depTarget.name,
                            type: (depNode as any)?.type ?? 'table',
                            depth: depth + 1,
                        });
                        queue.push({ fullId: depFullId, depth: depth + 1 });
                    }
                }

                panel.webview.postMessage({
                    type: 'dependencies',
                    value: deps,
                    edges,
                    selectedModelId: modelFullId,
                });
                return;
            }

            case 'dryRun': {
                const { tableId, filter }: { tableId: string; filter: string } = message.value ?? {};
                if (!tableId) { return; }
                const query = filter?.trim()
                    ? `SELECT * FROM \`${tableId}\` WHERE ${filter}`
                    : `SELECT * FROM \`${tableId}\``;
                try {
                    const result = await queryDryRun(query);
                    if (result.error.hasError) {
                        panel.webview.postMessage({
                            type: 'dryRunResult',
                            value: { tableId, query, error: result.error.message },
                        });
                    } else {
                        const bytes = result.statistics ? formatBytes(result.statistics.totalBytesProcessed) : undefined;
                        const cost = result.statistics?.cost
                            ? `${result.statistics.cost.value.toFixed(4)} ${result.statistics.cost.currency}`
                            : undefined;
                        panel.webview.postMessage({
                            type: 'dryRunResult',
                            value: { tableId, query, bytes, cost },
                        });
                    }
                } catch (err: any) {
                    panel.webview.postMessage({
                        type: 'dryRunResult',
                        value: { tableId, query, error: err?.message ?? 'Unknown error' },
                    });
                }
                return;
            }

            case 'runQuery': {
                const { tableId, filter }: { tableId: string; filter: string } = message.value ?? {};
                if (!tableId) { return; }
                const query = filter?.trim()
                    ? `SELECT * FROM \`${tableId}\` WHERE ${filter}`
                    : `SELECT * FROM \`${tableId}\``;
                // Notify webview that loading has started
                panel.webview.postMessage({ type: 'queryLoading', value: { tableId } });
                try {
                    const { results, columns, jobStats, errorMessage } = await queryBigQuery(query);
                    panel.webview.postMessage({
                        type: 'queryResult',
                        value: { tableId, query, results, columns, jobStats, errorMessage },
                    });
                } catch (err: any) {
                    panel.webview.postMessage({
                        type: 'queryResult',
                        value: { tableId, query, error: err?.message ?? 'Unknown error' },
                    });
                }
                return;
            }

            case 'openExternal': {
                const url: string = message.value ?? '';
                if (url.startsWith('https://') || url.startsWith('http://')) {
                    vscode.env.openExternal(vscode.Uri.parse(url));
                }
                return;
            }
        }
    });

    return panel;
}

function getHtmlForWebview(webview: vscode.Webview, context: vscode.ExtensionContext): string {
    const scriptUri = webview.asWebviewUri(Uri.joinPath(context.extensionUri, 'dist', 'dependency-inspector.js'));
    const styleUri = webview.asWebviewUri(Uri.joinPath(context.extensionUri, 'dist', 'dependency-inspector.css'));
    // StyledSelect.css is a shared Vite chunk that contains @xyflow/react styles
    const sharedStyleUri = webview.asWebviewUri(Uri.joinPath(context.extensionUri, 'dist', 'StyledSelect.css'));
    const nonce = getNonce();

    return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: data:;">
            <link href="${sharedStyleUri}" rel="stylesheet">
            <link href="${styleUri}" rel="stylesheet">
            <title>Dependency Inspector</title>
        </head>
        <body>
            <div id="root"></div>
            <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
        </body>
        </html>
    `;
}
